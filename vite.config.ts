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
  quoteOffersWithPrava,
} from "./src/adapters/prava-shopping-server.ts";
import {
  createPravaPaymentSession,
  pollPravaPaymentCredential,
  reportPravaPaymentStatus,
} from "./src/adapters/prava-payment-server.ts";
import type { PravaCheckoutRequest, PravaCheckoutResult } from "./src/domain.ts";
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
  const checkoutAuthorizations = new Map<string, { readonly request: string; readonly grant: string }>();
  const consumedAuthorizationIds = new Set<string>();
  type PaymentSessionState = {
    readonly request: PravaCheckoutRequest;
    readonly paymentGrant: string;
    readonly expiresAt: string;
    merchantCheckoutMayHaveStarted: boolean;
    finalResult?: PravaCheckoutResult;
    pendingReport?: {
      readonly transactionReference: string;
      readonly result: PravaCheckoutResult;
    };
    processing?: Promise<
      | { readonly _tag: "pending" }
      | { readonly _tag: "completed"; readonly result: PravaCheckoutResult }
    >;
  };
  const paymentSessions = new Map<string, PaymentSessionState>();
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
        logger.log("prava.checkout_route", "started", { paymentMode: "hosted_sandbox_session" });
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
            logger.log("prava.payment_session", "started", { offerId: input.offer.id });
            try {
              const session = await createPravaPaymentSession(input, env);
              const paymentGrant = randomUUID();
              paymentSessions.set(session.sessionId, {
                request: input,
                paymentGrant,
                expiresAt: session.expiresAt,
                merchantCheckoutMayHaveStarted: false,
              });
              response.statusCode = 200;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({
                paymentSession: {
                  sessionId: session.sessionId,
                  iframeUrl: session.iframeUrl,
                  expiresAt: session.expiresAt,
                  paymentGrant,
                },
              }));
              logger.log("prava.payment_session", "succeeded", { offerId: input.offer.id });
              logger.log("prava.checkout_route", "succeeded", { result: "payment_session_created" });
            } catch (cause: unknown) {
              const result: PravaCheckoutResult = {
                _tag: "not_submitted",
                reason: "purchase_unavailable",
                confirmedTotalInr: null,
                explanation: "Prava could not create the hosted sandbox payment session",
              };
              response.statusCode = 200;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ result }));
              logger.log("prava.payment_session", "failed", errorLogDetails(cause));
              logger.log("prava.checkout_route", "blocked", { result: result._tag });
            }
          };
          handleRequest().catch((cause: unknown) => {
            logger.log("prava.checkout_route", "failed", errorLogDetails(cause));
            response.statusCode = 503;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Checkout outcome unavailable" }));
          });
        });
      });
      server.middlewares.use("/api/checkout-result", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        const logger = loggerFor(request);
        logger.log("prava.payment_poll_route", "started", {});
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          const handleRequest = async () => {
            let sessionId: string;
            let state: PaymentSessionState;
            try {
              if (body.length > 10_000) throw new Error("Request is too large");
              const envelope = boundaryRecord(JSON.parse(body));
              if (
                !hasExactBoundaryKeys(envelope, ["sessionId", "paymentGrant"]) ||
                typeof envelope.sessionId !== "string" ||
                typeof envelope.paymentGrant !== "string"
              ) throw new Error("Invalid payment session request");
              sessionId = envelope.sessionId;
              const found = paymentSessions.get(sessionId);
              if (
                found === undefined || found.paymentGrant !== envelope.paymentGrant ||
                (Date.parse(found.expiresAt) <= Date.now() &&
                  found.processing === undefined &&
                  found.pendingReport === undefined && found.finalResult === undefined)
              ) throw new Error("Payment session unavailable");
              state = found;
              logger.log("prava.payment_poll_validation", "succeeded", {
                offerId: state.request.offer.id,
              });
            } catch (cause: unknown) {
              logger.log("prava.payment_poll_validation", "failed", errorLogDetails(cause));
              logger.log("prava.payment_poll_route", "blocked", { reason: "invalid_payment_session" });
              response.statusCode = 409;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Invalid Prava payment session" }));
              return;
            }

            if (state.finalResult !== undefined) {
              response.statusCode = 200;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ status: "completed", result: state.finalResult }));
              logger.log("prava.payment_poll_route", "succeeded", { state: "completed_cached" });
              return;
            }
            state.processing ??= (async () => {
              if (state.pendingReport !== undefined) {
                logger.log("prava.payment_report", "started", {
                  offerId: state.request.offer.id,
                  retry: true,
                });
                await reportPravaPaymentStatus(
                  sessionId,
                  state.pendingReport.transactionReference,
                  state.pendingReport.result,
                  env,
                );
                const result = state.pendingReport.result;
                state.pendingReport = undefined;
                state.finalResult = result;
                logger.log("prava.payment_report", "succeeded", { reported: true, retry: true });
                return { _tag: "completed", result } as const;
              }
              logger.log("prava.payment_credentials", "started", { offerId: state.request.offer.id });
              const credentialResult = await pollPravaPaymentCredential(sessionId, state.request, env);
              if (credentialResult._tag === "pending") {
                logger.log("prava.payment_credentials", "info", {
                  state: "pending",
                  offerId: state.request.offer.id,
                });
                return { _tag: "pending" } as const;
              }
              if (credentialResult._tag === "failed") {
                logger.log("prava.payment_credentials", "failed", { reason: "payment_approval_failed" });
                const result: PravaCheckoutResult = {
                  _tag: "not_submitted",
                  reason: "purchase_unavailable",
                  confirmedTotalInr: null,
                  explanation: credentialResult.explanation,
                };
                state.finalResult = result;
                return { _tag: "completed", result } as const;
              }
              logger.log("prava.payment_credentials", "succeeded", { offerId: state.request.offer.id });
              logger.log("prava.merchant_checkout", "started", { offerId: state.request.offer.id });
              state.merchantCheckoutMayHaveStarted = true;
              const result = await checkoutWithPrava(
                state.request,
                credentialResult.credential,
                undefined,
                Date.now,
                logger,
              );
              logger.log(
                "prava.merchant_checkout",
                result._tag === "not_submitted"
                  ? "blocked"
                  : result.paymentStatus === "successful"
                    ? "succeeded"
                    : "failed",
                result._tag === "not_submitted"
                  ? { reason: result.reason }
                  : { paymentStatus: result.paymentStatus },
              );
              logger.log("prava.payment_report", "started", { offerId: state.request.offer.id });
              if (result._tag === "submitted" && result.paymentStatus === "unknown") {
                logger.log("prava.payment_report", "info", {
                  reported: false,
                  reason: "merchant_outcome_unknown",
                });
                state.finalResult = result;
              } else {
                state.pendingReport = {
                  transactionReference: credentialResult.transactionReference,
                  result,
                };
                try {
                  await reportPravaPaymentStatus(
                    sessionId,
                    credentialResult.transactionReference,
                    result,
                    env,
                  );
                  state.pendingReport = undefined;
                  state.finalResult = result;
                  logger.log("prava.payment_report", "succeeded", { reported: true });
                } catch (cause: unknown) {
                  logger.log("prava.payment_report", "failed", errorLogDetails(cause));
                  throw cause;
                }
              }
              return { _tag: "completed", result } as const;
            })();
            try {
              const resolution = await state.processing;
              if (resolution._tag === "pending") state.processing = undefined;
              response.statusCode = resolution._tag === "pending" ? 202 : 200;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify(
                resolution._tag === "pending"
                  ? { status: "pending" }
                  : { status: "completed", result: resolution.result },
              ));
              logger.log("prava.payment_poll_route", "succeeded", { state: resolution._tag });
            } catch (cause: unknown) {
              if (
                state.merchantCheckoutMayHaveStarted &&
                state.pendingReport === undefined && state.finalResult === undefined
              ) {
                state.finalResult = {
                  _tag: "submitted",
                  paymentStatus: "unknown",
                  merchantOrderIdentifier: null,
                  confirmedTotalInr: null,
                  failureReason: "Prava did not confirm whether the merchant accepted the order",
                };
              }
              state.processing = undefined;
              logger.log("prava.payment_poll_route", "failed", errorLogDetails(cause));
              response.statusCode = 503;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({
                error: "Prava payment status unavailable",
                merchantCheckoutMayHaveStarted: state.merchantCheckoutMayHaveStarted,
              }));
            }
          };
          handleRequest().catch((cause: unknown) => {
            logger.log("prava.payment_poll_route", "failed", errorLogDetails(cause));
            response.statusCode = 503;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Prava payment status unavailable" }));
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
