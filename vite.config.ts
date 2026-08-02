import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { parseKbNodeIds, retrievePolicyEvidenceFromSenso, type SensoOfficialSource } from "./src/adapters/senso-evidence-server.ts";
import {
  extractPoliciesWithOpenAi,
  openAiApiKeyFrom,
  parsePolicyEvidenceInput,
} from "./src/adapters/openai-policy-extraction-server.ts";
import {
  checkoutWithPrava,
  parsePravaQuoteRequest,
  parsePravaCheckoutRequest,
  pravaCheckoutCredentialsFrom,
  quoteOffersWithPrava,
} from "./src/adapters/prava-shopping-server.ts";
import { OFFICIAL_EVIDENCE_SOURCES, SUPPORTED_PRODUCT, type Product } from "./src/domain.ts";
import {
  createPipelineLogger,
  errorLogDetails,
  PIPELINE_TRACE_HEADER,
  pipelineTraceIdFrom,
} from "./src/pipeline-logging.ts";

function loggerFor(request: IncomingMessage) {
  const traceId = pipelineTraceIdFrom(
    request.headers[PIPELINE_TRACE_HEADER.toLowerCase()],
    randomUUID,
  );
  return createPipelineLogger({ traceId, scope: "server" });
}

function boundaryRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  // SAFETY: The object/null/array checks above establish a plain JSON object boundary.
  return value as Record<string, unknown>;
}

function hasExactBoundaryKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseProduct(value: unknown): Product {
  const product = boundaryRecord(value);
  if (
    product.manufacturer !== SUPPORTED_PRODUCT.manufacturer ||
    product.model !== SUPPORTED_PRODUCT.model ||
    product.variant !== SUPPORTED_PRODUCT.variant ||
    product.condition !== SUPPORTED_PRODUCT.condition ||
    product.bundleContents !== SUPPORTED_PRODUCT.bundleContents ||
    product.warrantyRegion !== SUPPORTED_PRODUCT.warrantyRegion
  ) {
    throw new Error("Unsupported Product");
  }
  return SUPPORTED_PRODUCT;
}

function sensoEvidencePlugin(env: Record<string, string>): Plugin {
  const kbNodeIdsByOffer = {
    "headphone-zone": parseKbNodeIds(env.SENSO_HEADPHONE_ZONE_KB_NODE_IDS),
    "concept-kart": parseKbNodeIds(env.SENSO_CONCEPT_KART_KB_NODE_IDS),
    flipkart: parseKbNodeIds(env.SENSO_FLIPKART_KB_NODE_IDS),
  } as const;
  const sources: ReadonlyArray<SensoOfficialSource> = OFFICIAL_EVIDENCE_SOURCES.map((source) => ({
    ...source,
    kbNodeIds: kbNodeIdsByOffer[source.offerId],
  }));
  return {
    name: "undo-senso-policy-evidence",
    configureServer(server) {
      server.middlewares.use("/api/policy-evidence", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        const logger = loggerFor(request);
        logger.log("senso.route", "started", {
          apiKeyConfigured: (env.SENSO_API_KEY ?? "").trim() !== "",
          configuredOfferCount: sources.filter((source) => source.kbNodeIds.length > 0).length,
        });
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          const handleRequest = async () => {
            try {
              if (body.length > 1_000_000) throw new Error("Request is too large");
              const payload: unknown = JSON.parse(body);
              const product = parseProduct(boundaryRecord(payload).product);
              logger.log("senso.request_validation", "succeeded", { productModel: product.model });
              const result = await retrievePolicyEvidenceFromSenso(product, {
                apiKey: env.SENSO_API_KEY ?? "",
                sources,
                logger,
              });
              response.statusCode = 200;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify(result));
              logger.log("senso.route", "succeeded", { documentCount: result.documents.length });
            } catch (cause: unknown) {
              logger.log("senso.route", "failed", errorLogDetails(cause));
              response.statusCode = 503;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Policy evidence unavailable" }));
            }
          };
          handleRequest().catch((cause: unknown) => {
            logger.log("senso.route", "failed", errorLogDetails(cause));
            response.statusCode = cause instanceof Error ? 503 : 500;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Policy evidence unavailable" }));
          });
        });
      });
    },
  };
}

function openAiPolicyExtractionPlugin(env: Record<string, string>): Plugin {
  const apiKey = openAiApiKeyFrom(env.OPENAI_API_KEY);
  return {
    name: "undo-openai-policy-extraction",
    configureServer(server) {
      server.middlewares.use("/api/policy-extraction", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        const logger = loggerFor(request);
        const model = env.OPENAI_POLICY_MODEL || "gpt-5.6-sol";
        logger.log("openai.route", "started", {
          apiKeyConfigured: apiKey !== undefined,
          model,
        });
        let body = "";
        const abortController = new AbortController();
        request.on("aborted", () => abortController.abort());
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          const handleRequest = async () => {
            if (body.length > 1_000_000) {
              logger.log("openai.request_validation", "blocked", {
                reason: "request_too_large",
                maximumBytes: 1_000_000,
              });
              logger.log("openai.route", "blocked", { reason: "request_too_large" });
              response.statusCode = 413;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Request is too large" }));
              return;
            }
            let evidence;
            try {
              const payload: unknown = JSON.parse(body);
              evidence = parsePolicyEvidenceInput(boundaryRecord(payload).evidence);
              logger.log("openai.request_validation", "succeeded", {
                snapshotCount: evidence.length,
                offers: evidence.map((snapshot) => snapshot.offerId),
              });
            } catch (cause: unknown) {
              logger.log("openai.request_validation", "failed", errorLogDetails(cause));
              logger.log("openai.route", "blocked", { reason: "invalid_policy_evidence_request" });
              response.statusCode = cause instanceof SyntaxError ? 400 : 422;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Invalid Policy Evidence request" }));
              return;
            }
            const result = await extractPoliciesWithOpenAi(evidence, {
              apiKey,
              model,
              signal: abortController.signal,
              logger,
            });
            response.setHeader("Content-Type", "application/json");
            if (result._tag === "err") {
              logger.log("openai.route", "failed", {
                errorKind: result.error.kind,
                ...errorLogDetails(result.error.cause),
              });
              response.statusCode = 503;
              response.end(JSON.stringify({ error: "Policy extraction unavailable" }));
              return;
            }
            response.statusCode = 200;
            response.end(JSON.stringify({ policies: result.value, model }));
            logger.log("openai.route", "succeeded", { policyCount: result.value.length, model });
          };
          handleRequest().catch((cause: unknown) => {
            logger.log("openai.route", "failed", errorLogDetails(cause));
            response.statusCode = cause instanceof Error ? 503 : 500;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Policy extraction unavailable" }));
          });
        });
      });
    },
  };
}

function pravaCheckoutQuotesPlugin(): Plugin {
  return {
    name: "undo-prava-checkout-quotes",
    configureServer(server) {
      server.middlewares.use("/api/checkout-quotes", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        const logger = loggerFor(request);
        logger.log("prava.quotes_route", "started", {});
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          const handleRequest = async () => {
            if (body.length > 100_000) {
              logger.log("prava.quote_request_validation", "blocked", {
                reason: "request_too_large",
                maximumBytes: 100_000,
              });
              logger.log("prava.quotes_route", "blocked", { reason: "request_too_large" });
              response.statusCode = 413;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Request is too large" }));
              return;
            }
            let input;
            try {
              const payload: unknown = JSON.parse(body);
              input = parsePravaQuoteRequest(payload);
              logger.log("prava.quote_request_validation", "succeeded", {
                offerCount: input.offers.length,
                destination: input.destinationReference === "destination-ref-prava-default"
                  ? "default"
                  : "opaque_custom",
              });
            } catch (cause: unknown) {
              logger.log("prava.quote_request_validation", "failed", errorLogDetails(cause));
              logger.log("prava.quotes_route", "blocked", { reason: "invalid_quote_request" });
              response.statusCode = cause instanceof SyntaxError ? 400 : 422;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Invalid Prava quote request" }));
              return;
            }
            const result = await quoteOffersWithPrava(input.offers, input.destinationReference, undefined, logger);
            response.setHeader("Content-Type", "application/json");
            if (result._tag === "err") {
              logger.log("prava.quotes_route", "failed", errorLogDetails(result.error.cause));
              response.statusCode = 503;
              response.end(JSON.stringify({ error: "Checkout quotes unavailable" }));
              return;
            }
            response.statusCode = 200;
            response.end(JSON.stringify({ quotes: result.value }));
            logger.log("prava.quotes_route", "succeeded", {
              quoteCount: result.value.length,
              purchaseAvailableCount: result.value.filter((quote) => quote.purchaseAvailable).length,
            });
          };
          handleRequest().catch((cause: unknown) => {
            logger.log("prava.quotes_route", "failed", errorLogDetails(cause));
            response.statusCode = 503;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Checkout quotes unavailable" }));
          });
        });
      });
    },
  };
}

function pravaCheckoutPlugin(env: Record<string, string>): Plugin {
  const credentials = pravaCheckoutCredentialsFrom(env);
  const checkoutAuthorizations = new Map<string, { readonly request: string; readonly grant: string }>();
  const consumedAuthorizationIds = new Set<string>();
  return {
    name: "undo-prava-checkout",
    configureServer(server) {
      server.middlewares.use("/api/checkout-authorizations", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        const logger = loggerFor(request);
        logger.log("prava.authorization_route", "started", {});
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          try {
            if (body.length > 100_000) {
              logger.log("prava.authorization_validation", "blocked", {
                reason: "request_too_large",
                maximumBytes: 100_000,
              });
              logger.log("prava.authorization_route", "blocked", { reason: "request_too_large" });
              response.statusCode = 413;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Request is too large" }));
              return;
            }
            const payload: unknown = JSON.parse(body);
            const input = parsePravaCheckoutRequest(payload);
            logger.log("prava.authorization_validation", "succeeded", { offerId: input.offer.id });
            if (
              Date.parse(input.expiresAt) <= Date.now() ||
              checkoutAuthorizations.has(input.authorizationId) ||
              consumedAuthorizationIds.has(input.authorizationId)
            ) {
              throw new Error("Purchase Authorization is expired or already registered");
            }
            const checkoutGrant = randomUUID();
            checkoutAuthorizations.set(input.authorizationId, {
              request: JSON.stringify(input),
              grant: checkoutGrant,
            });
            response.statusCode = 201;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ checkoutGrant }));
            logger.log("prava.authorization_route", "succeeded", { offerId: input.offer.id });
          } catch (cause: unknown) {
            logger.log("prava.authorization_validation", "failed", errorLogDetails(cause));
            logger.log("prava.authorization_route", "blocked", { reason: "invalid_authorization" });
            response.statusCode = 422;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Invalid Purchase Authorization" }));
          }
        });
      });
      server.middlewares.use("/api/checkout", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        const logger = loggerFor(request);
        logger.log("prava.checkout_route", "started", {
          credentialConfigured: credentials !== undefined,
        });
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          const handleRequest = async () => {
            if (body.length > 100_000) {
              logger.log("prava.checkout_request_validation", "blocked", {
                reason: "request_too_large",
                maximumBytes: 100_000,
              });
              logger.log("prava.checkout_route", "blocked", { reason: "request_too_large" });
              response.statusCode = 413;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Request is too large" }));
              return;
            }
            let input;
            try {
              const payload: unknown = JSON.parse(body);
              const envelope = boundaryRecord(payload);
              if (
                !hasExactBoundaryKeys(envelope, ["request", "checkoutGrant"]) ||
                typeof envelope.checkoutGrant !== "string" || envelope.checkoutGrant.trim() === ""
              ) throw new Error("Invalid checkout grant");
              input = parsePravaCheckoutRequest(envelope.request);
              const storedAuthorization = checkoutAuthorizations.get(input.authorizationId);
              if (
                storedAuthorization === undefined ||
                storedAuthorization.request !== JSON.stringify(input) ||
                storedAuthorization.grant !== envelope.checkoutGrant ||
                Date.parse(input.expiresAt) <= Date.now()
              ) throw new Error("Purchase Authorization unavailable");
              logger.log("prava.checkout_request_validation", "succeeded", { offerId: input.offer.id });
            } catch (cause: unknown) {
              logger.log("prava.checkout_request_validation", "failed", errorLogDetails(cause));
              logger.log("prava.checkout_route", "blocked", { reason: "invalid_checkout_request" });
              response.statusCode = cause instanceof SyntaxError ? 400 : 409;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Invalid Prava checkout request" }));
              return;
            }
            checkoutAuthorizations.delete(input.authorizationId);
            consumedAuthorizationIds.add(input.authorizationId);
            const result = await checkoutWithPrava(input, credentials, undefined, Date.now, logger);
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ result }));
            const routeStatus = result._tag === "not_submitted"
              ? "blocked"
              : result.paymentStatus === "successful" && result.merchantOrderIdentifier !== null
                ? "succeeded"
                : "failed";
            logger.log("prava.checkout_route", routeStatus, {
              result: result._tag,
              paymentStatus: result._tag === "submitted" ? result.paymentStatus : "not_submitted",
            });
          };
          handleRequest().catch((cause: unknown) => {
            logger.log("prava.checkout_route", "failed", errorLogDetails(cause));
            response.statusCode = 503;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Checkout outcome unavailable" }));
          });
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      sensoEvidencePlugin(env),
      openAiPolicyExtractionPlugin(env),
      pravaCheckoutQuotesPlugin(),
      pravaCheckoutPlugin(env),
    ],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
    },
  };
});
