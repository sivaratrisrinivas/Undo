import { randomUUID } from "node:crypto";

import {
  extractPoliciesWithOpenAi,
  openAiApiKeyFrom,
  parsePolicyEvidenceInput,
} from "../adapters/openai-policy-extraction-server.js";
import {
  createPravaPaymentSession,
  pollPravaPaymentCredential,
  reportPravaPaymentStatus,
} from "../adapters/prava-payment-server.js";
import {
  checkoutWithPrava,
  parsePravaCheckoutRequest,
  parsePravaQuoteRequest,
  quoteOffersWithPrava,
} from "../adapters/prava-shopping-server.js";
import {
  parseKbNodeIds,
  retrievePolicyEvidenceFromSenso,
  type SensoOfficialSource,
} from "../adapters/senso-evidence-server.js";
import {
  OFFICIAL_EVIDENCE_SOURCES,
  SUPPORTED_PRODUCT,
  type PravaCheckoutRequest,
  type PravaCheckoutResult,
  type Product,
} from "../domain.js";
import {
  createPipelineLogger,
  errorLogDetails,
  PIPELINE_TRACE_HEADER,
  pipelineTraceIdFrom,
} from "../pipeline-logging.js";
import type {
  CheckoutStateStore,
  PersistedPaymentSessionState,
} from "./checkout-state.js";

export type UndoApiRoute =
  | "policy-evidence"
  | "policy-extraction"
  | "checkout-quotes"
  | "checkout-authorizations"
  | "checkout"
  | "checkout-result";

export type UndoApiOptions = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly state: CheckoutStateStore;
};

const AUTHORIZATION_TOMBSTONE_TTL_SECONDS = 60 * 60;
const PAYMENT_STATE_TTL_SECONDS = 60 * 60;
const PAYMENT_LOCK_TTL_MILLISECONDS = 2 * 60 * 1000;

function loggerFor(request: Request) {
  const traceId = pipelineTraceIdFrom(request.headers.get(PIPELINE_TRACE_HEADER), randomUUID);
  return createPipelineLogger({ traceId, scope: "server" });
}

function json(value: unknown, status = 200, headers?: Readonly<Record<string, string>>): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function boundaryRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
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
  ) throw new Error("Unsupported Product");
  return SUPPORTED_PRODUCT;
}

async function requestJson(request: Request, maximumCharacters: number): Promise<unknown> {
  const body = await request.text();
  if (body.length > maximumCharacters) throw new RangeError("Request is too large");
  return JSON.parse(body);
}

function methodNotAllowed(): Response {
  return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
}

async function handlePolicyEvidence(request: Request, options: UndoApiOptions): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const logger = loggerFor(request);
  const kbNodeIdsByOffer = {
    "headphone-zone": parseKbNodeIds(options.env.SENSO_HEADPHONE_ZONE_KB_NODE_IDS),
    "concept-kart": parseKbNodeIds(options.env.SENSO_CONCEPT_KART_KB_NODE_IDS),
    flipkart: parseKbNodeIds(options.env.SENSO_FLIPKART_KB_NODE_IDS),
  } as const;
  const sources: ReadonlyArray<SensoOfficialSource> = OFFICIAL_EVIDENCE_SOURCES.map((source) => ({
    ...source,
    kbNodeIds: kbNodeIdsByOffer[source.offerId],
  }));
  logger.log("senso.route", "started", {
    apiKeyConfigured: (options.env.SENSO_API_KEY ?? "").trim() !== "",
    configuredOfferCount: sources.filter((source) => source.kbNodeIds.length > 0).length,
  });
  try {
    const payload = boundaryRecord(await requestJson(request, 1_000_000));
    const product = parseProduct(payload.product);
    logger.log("senso.request_validation", "succeeded", { productModel: product.model });
    const result = await retrievePolicyEvidenceFromSenso(product, {
      apiKey: options.env.SENSO_API_KEY ?? "",
      sources,
      logger,
    });
    logger.log("senso.route", "succeeded", { documentCount: result.documents.length });
    return json(result);
  } catch (cause: unknown) {
    logger.log("senso.route", "failed", errorLogDetails(cause));
    return json(
      { error: cause instanceof RangeError ? "Request is too large" : "Policy evidence unavailable" },
      cause instanceof RangeError ? 413 : 503,
    );
  }
}

async function handlePolicyExtraction(request: Request, options: UndoApiOptions): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const logger = loggerFor(request);
  const apiKey = openAiApiKeyFrom(options.env.OPENAI_API_KEY);
  const model = options.env.OPENAI_POLICY_MODEL || "gpt-5.6-sol";
  logger.log("openai.route", "started", { apiKeyConfigured: apiKey !== undefined, model });
  let evidence;
  try {
    const payload = boundaryRecord(await requestJson(request, 1_000_000));
    evidence = parsePolicyEvidenceInput(payload.evidence);
    logger.log("openai.request_validation", "succeeded", {
      snapshotCount: evidence.length,
      offers: evidence.map((snapshot) => snapshot.offerId),
    });
  } catch (cause: unknown) {
    logger.log("openai.request_validation", "failed", errorLogDetails(cause));
    logger.log("openai.route", "blocked", {
      reason: cause instanceof RangeError ? "request_too_large" : "invalid_policy_evidence_request",
    });
    return json(
      { error: cause instanceof RangeError ? "Request is too large" : "Invalid Policy Evidence request" },
      cause instanceof RangeError ? 413 : cause instanceof SyntaxError ? 400 : 422,
    );
  }
  try {
    const result = await extractPoliciesWithOpenAi(evidence, {
      apiKey,
      model,
      signal: request.signal,
      logger,
    });
    if (result._tag === "err") {
      logger.log("openai.route", "failed", {
        errorKind: result.error.kind,
        ...errorLogDetails(result.error.cause),
      });
      return json({ error: "Policy extraction unavailable" }, 503);
    }
    logger.log("openai.route", "succeeded", { policyCount: result.value.length, model });
    return json({ policies: result.value, model });
  } catch (cause: unknown) {
    logger.log("openai.route", "failed", errorLogDetails(cause));
    return json({ error: "Policy extraction unavailable" }, 503);
  }
}

async function handleCheckoutQuotes(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const logger = loggerFor(request);
  logger.log("prava.quotes_route", "started", {});
  try {
    const input = parsePravaQuoteRequest(await requestJson(request, 100_000));
    logger.log("prava.quote_request_validation", "succeeded", {
      offerCount: input.offers.length,
      destination: input.destinationReference === "destination-ref-prava-default"
        ? "default"
        : "opaque_custom",
    });
    const result = await quoteOffersWithPrava(
      input.offers,
      input.destinationReference,
      undefined,
      logger,
    );
    if (result._tag === "err") {
      logger.log("prava.quotes_route", "failed", errorLogDetails(result.error.cause));
      return json({ error: "Checkout quotes unavailable" }, 503);
    }
    logger.log("prava.quotes_route", "succeeded", {
      quoteCount: result.value.length,
      purchaseAvailableCount: result.value.filter((quote) => quote.purchaseAvailable).length,
    });
    return json({ quotes: result.value });
  } catch (cause: unknown) {
    const tooLarge = cause instanceof RangeError;
    logger.log("prava.quote_request_validation", "failed", errorLogDetails(cause));
    logger.log("prava.quotes_route", "blocked", {
      reason: tooLarge ? "request_too_large" : "invalid_quote_request",
    });
    return json(
      { error: tooLarge ? "Request is too large" : "Invalid Prava quote request" },
      tooLarge ? 413 : cause instanceof SyntaxError ? 400 : 422,
    );
  }
}

function authorizationTtlSeconds(input: PravaCheckoutRequest): number {
  return Math.max(1, Math.ceil((Date.parse(input.expiresAt) - Date.now()) / 1000));
}

async function handleCheckoutAuthorization(
  request: Request,
  options: UndoApiOptions,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const logger = loggerFor(request);
  logger.log("prava.authorization_route", "started", {});
  try {
    const input = parsePravaCheckoutRequest(await requestJson(request, 100_000));
    logger.log("prava.authorization_validation", "succeeded", { offerId: input.offer.id });
    if (Date.parse(input.expiresAt) <= Date.now()) {
      throw new Error("Purchase Authorization is expired");
    }
    const checkoutGrant = randomUUID();
    const created = await options.state.createAuthorization(
      input.authorizationId,
      { request: JSON.stringify(input), grant: checkoutGrant },
      authorizationTtlSeconds(input),
    );
    if (!created) throw new Error("Purchase Authorization is already registered");
    logger.log("prava.authorization_route", "succeeded", { offerId: input.offer.id });
    return json({ checkoutGrant }, 201);
  } catch (cause: unknown) {
    const tooLarge = cause instanceof RangeError;
    logger.log("prava.authorization_validation", "failed", errorLogDetails(cause));
    logger.log("prava.authorization_route", "blocked", {
      reason: tooLarge ? "request_too_large" : "invalid_authorization",
    });
    return json(
      { error: tooLarge ? "Request is too large" : "Invalid Purchase Authorization" },
      tooLarge ? 413 : 422,
    );
  }
}

async function handleCheckout(request: Request, options: UndoApiOptions): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const logger = loggerFor(request);
  logger.log("prava.checkout_route", "started", { paymentMode: "hosted_sandbox_session" });
  let input: PravaCheckoutRequest;
  try {
    const envelope = boundaryRecord(await requestJson(request, 100_000));
    if (
      !hasExactBoundaryKeys(envelope, ["request", "checkoutGrant"]) ||
      typeof envelope.checkoutGrant !== "string" || envelope.checkoutGrant.trim() === ""
    ) throw new Error("Invalid checkout grant");
    input = parsePravaCheckoutRequest(envelope.request);
    if (Date.parse(input.expiresAt) <= Date.now()) throw new Error("Purchase Authorization expired");
    const authorization = {
      request: JSON.stringify(input),
      grant: envelope.checkoutGrant,
    };
    const consumed = await options.state.consumeAuthorization(
      input.authorizationId,
      authorization,
      AUTHORIZATION_TOMBSTONE_TTL_SECONDS,
    );
    if (consumed !== "consumed") throw new Error("Purchase Authorization unavailable");
    logger.log("prava.checkout_request_validation", "succeeded", { offerId: input.offer.id });
  } catch (cause: unknown) {
    const tooLarge = cause instanceof RangeError;
    logger.log("prava.checkout_request_validation", "failed", errorLogDetails(cause));
    logger.log("prava.checkout_route", "blocked", {
      reason: tooLarge ? "request_too_large" : "invalid_checkout_request",
    });
    return json(
      { error: tooLarge ? "Request is too large" : "Invalid Prava checkout request" },
      tooLarge ? 413 : cause instanceof SyntaxError ? 400 : 409,
    );
  }
  logger.log("prava.payment_session", "started", { offerId: input.offer.id });
  try {
    const session = await createPravaPaymentSession(input, options.env);
    const paymentGrant = randomUUID();
    await options.state.savePaymentSession(session.sessionId, {
      request: input,
      paymentGrant,
      expiresAt: session.expiresAt,
      merchantCheckoutMayHaveStarted: false,
    }, PAYMENT_STATE_TTL_SECONDS);
    logger.log("prava.payment_session", "succeeded", { offerId: input.offer.id });
    logger.log("prava.checkout_route", "succeeded", { result: "payment_session_created" });
    return json({
      paymentSession: {
        sessionId: session.sessionId,
        iframeUrl: session.iframeUrl,
        expiresAt: session.expiresAt,
        paymentGrant,
      },
    });
  } catch (cause: unknown) {
    const result: PravaCheckoutResult = {
      _tag: "not_submitted",
      reason: "purchase_unavailable",
      confirmedTotalInr: null,
      explanation: "Prava could not create the hosted sandbox payment session",
    };
    logger.log("prava.payment_session", "failed", errorLogDetails(cause));
    logger.log("prava.checkout_route", "blocked", { result: result._tag });
    return json({ result });
  }
}

function withoutPendingReport(state: PersistedPaymentSessionState): PersistedPaymentSessionState {
  return {
    request: state.request,
    paymentGrant: state.paymentGrant,
    expiresAt: state.expiresAt,
    merchantCheckoutMayHaveStarted: state.merchantCheckoutMayHaveStarted,
    ...(state.finalResult === undefined ? {} : { finalResult: state.finalResult }),
  };
}

function paymentRequestValid(
  state: PersistedPaymentSessionState | undefined,
  paymentGrant: string,
): state is PersistedPaymentSessionState {
  return state !== undefined && state.paymentGrant === paymentGrant && !(
    Date.parse(state.expiresAt) <= Date.now() &&
    state.pendingReport === undefined && state.finalResult === undefined
  );
}

async function handleCheckoutResult(request: Request, options: UndoApiOptions): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const logger = loggerFor(request);
  logger.log("prava.payment_poll_route", "started", {});
  let sessionId: string;
  let paymentGrant: string;
  try {
    const envelope = boundaryRecord(await requestJson(request, 10_000));
    if (
      !hasExactBoundaryKeys(envelope, ["sessionId", "paymentGrant"]) ||
      typeof envelope.sessionId !== "string" ||
      typeof envelope.paymentGrant !== "string" ||
      !/^ses{1,2}_[A-Za-z0-9_-]+$/.test(envelope.sessionId)
    ) throw new Error("Invalid payment session request");
    sessionId = envelope.sessionId;
    paymentGrant = envelope.paymentGrant;
    const found = await options.state.getPaymentSession(sessionId);
    if (!paymentRequestValid(found, paymentGrant)) throw new Error("Payment session unavailable");
    logger.log("prava.payment_poll_validation", "succeeded", { offerId: found.request.offer.id });
    if (found.finalResult !== undefined) {
      logger.log("prava.payment_poll_route", "succeeded", { state: "completed_cached" });
      return json({ status: "completed", result: found.finalResult });
    }
  } catch (cause: unknown) {
    logger.log("prava.payment_poll_validation", "failed", errorLogDetails(cause));
    logger.log("prava.payment_poll_route", "blocked", { reason: "invalid_payment_session" });
    return json({ error: "Invalid Prava payment session" }, 409);
  }

  const lockOwner = randomUUID();
  const acquired = await options.state.acquirePaymentLock(
    sessionId,
    lockOwner,
    PAYMENT_LOCK_TTL_MILLISECONDS,
  );
  if (!acquired) {
    logger.log("prava.payment_poll_route", "info", { state: "processing" });
    return json({ status: "pending" }, 202);
  }

  let state: PersistedPaymentSessionState | undefined;
  try {
    state = await options.state.getPaymentSession(sessionId);
    if (!paymentRequestValid(state, paymentGrant)) throw new Error("Payment session unavailable");
    if (state.finalResult !== undefined) {
      logger.log("prava.payment_poll_route", "succeeded", { state: "completed_cached" });
      return json({ status: "completed", result: state.finalResult });
    }
    if (state.pendingReport !== undefined) {
      logger.log("prava.payment_report", "started", { offerId: state.request.offer.id, retry: true });
      await reportPravaPaymentStatus(
        sessionId,
        state.pendingReport.transactionReference,
        state.pendingReport.result,
        options.env,
      );
      const result = state.pendingReport.result;
      state = {
        ...withoutPendingReport(state),
        finalResult: result,
      };
      await options.state.savePaymentSession(sessionId, state, PAYMENT_STATE_TTL_SECONDS);
      logger.log("prava.payment_report", "succeeded", { reported: true, retry: true });
      logger.log("prava.payment_poll_route", "succeeded", { state: "completed" });
      return json({ status: "completed", result });
    }

    logger.log("prava.payment_credentials", "started", { offerId: state.request.offer.id });
    const credentialResult = await pollPravaPaymentCredential(
      sessionId,
      state.request,
      options.env,
    );
    if (credentialResult._tag === "pending") {
      logger.log("prava.payment_credentials", "info", { state: "pending", offerId: state.request.offer.id });
      logger.log("prava.payment_poll_route", "succeeded", { state: "pending" });
      return json({ status: "pending" }, 202);
    }
    if (credentialResult._tag === "failed") {
      const result: PravaCheckoutResult = {
        _tag: "not_submitted",
        reason: "purchase_unavailable",
        confirmedTotalInr: null,
        explanation: credentialResult.explanation,
      };
      state = { ...state, finalResult: result };
      await options.state.savePaymentSession(sessionId, state, PAYMENT_STATE_TTL_SECONDS);
      logger.log("prava.payment_credentials", "failed", { reason: "payment_approval_failed" });
      logger.log("prava.payment_poll_route", "succeeded", { state: "completed" });
      return json({ status: "completed", result });
    }

    logger.log("prava.payment_credentials", "succeeded", { offerId: state.request.offer.id });
    logger.log("prava.merchant_checkout", "started", { offerId: state.request.offer.id });
    state = { ...state, merchantCheckoutMayHaveStarted: true };
    await options.state.savePaymentSession(sessionId, state, PAYMENT_STATE_TTL_SECONDS);
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
        : result.paymentStatus === "successful" ? "succeeded" : "failed",
      result._tag === "not_submitted" ? { reason: result.reason } : { paymentStatus: result.paymentStatus },
    );
    if (result._tag === "submitted" && result.paymentStatus === "unknown") {
      state = { ...state, finalResult: result };
      await options.state.savePaymentSession(sessionId, state, PAYMENT_STATE_TTL_SECONDS);
      logger.log("prava.payment_report", "info", { reported: false, reason: "merchant_outcome_unknown" });
    } else {
      state = {
        ...state,
        pendingReport: {
          transactionReference: credentialResult.transactionReference,
          result,
        },
      };
      await options.state.savePaymentSession(sessionId, state, PAYMENT_STATE_TTL_SECONDS);
      logger.log("prava.payment_report", "started", { offerId: state.request.offer.id });
      await reportPravaPaymentStatus(
        sessionId,
        credentialResult.transactionReference,
        result,
        options.env,
      );
      state = { ...withoutPendingReport(state), finalResult: result };
      await options.state.savePaymentSession(sessionId, state, PAYMENT_STATE_TTL_SECONDS);
      logger.log("prava.payment_report", "succeeded", { reported: true });
    }
    logger.log("prava.payment_poll_route", "succeeded", { state: "completed" });
    return json({ status: "completed", result });
  } catch (cause: unknown) {
    if (
      state !== undefined && state.merchantCheckoutMayHaveStarted &&
      state.pendingReport === undefined && state.finalResult === undefined
    ) {
      state = {
        ...state,
        finalResult: {
          _tag: "submitted",
          paymentStatus: "unknown",
          merchantOrderIdentifier: null,
          confirmedTotalInr: null,
          failureReason: "Prava did not confirm whether the merchant accepted the order",
        },
      };
      await options.state.savePaymentSession(sessionId, state, PAYMENT_STATE_TTL_SECONDS).catch(() => undefined);
    }
    logger.log("prava.payment_poll_route", "failed", errorLogDetails(cause));
    return json({
      error: "Prava payment status unavailable",
      merchantCheckoutMayHaveStarted: state?.merchantCheckoutMayHaveStarted === true,
    }, 503);
  } finally {
    await options.state.releasePaymentLock(sessionId, lockOwner).catch(() => undefined);
  }
}

/** Shared handler used by both local Vite middleware and deployed Vercel Functions. */
export async function handleUndoApi(
  route: UndoApiRoute,
  request: Request,
  options: UndoApiOptions,
): Promise<Response> {
  switch (route) {
    case "policy-evidence": return handlePolicyEvidence(request, options);
    case "policy-extraction": return handlePolicyExtraction(request, options);
    case "checkout-quotes": return handleCheckoutQuotes(request);
    case "checkout-authorizations": return handleCheckoutAuthorization(request, options);
    case "checkout": return handleCheckout(request, options);
    case "checkout-result": return handleCheckoutResult(request, options);
  }
}
