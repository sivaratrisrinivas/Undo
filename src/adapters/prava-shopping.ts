import {
  SUPPORTED_OFFERS,
  type CheckoutQuote,
  type Offer,
  type PravaCheckoutResult,
} from "../domain";
import type { AdapterResult, AssessmentAdapters } from "../workflow";
import { pipelineTraceHeaders } from "../pipeline-logging";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isOfferId(value: unknown): value is Offer["id"] {
  return SUPPORTED_OFFERS.some((offer) => offer.id === value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isConfirmedTotal(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseQuote(value: unknown): CheckoutQuote | undefined {
  const quote = record(value);
  const product = record(quote?.product);
  const discounts = (candidate: unknown) => Array.isArray(candidate) && candidate.every((item) => {
    const discount = record(item);
    return typeof discount?.label === "string" && typeof discount.amountInr === "number";
  });
  if (
    quote === undefined ||
    product === undefined ||
    !isOfferId(quote.offerId) ||
    typeof quote.merchant !== "string" ||
    typeof quote.seller !== "string" ||
    typeof quote.destinationReference !== "string" ||
    typeof product.manufacturer !== "string" ||
    typeof product.model !== "string" ||
    typeof product.variant !== "string" ||
    typeof product.condition !== "string" ||
    typeof product.bundleContents !== "string" ||
    typeof product.warrantyRegion !== "string" ||
    typeof quote.itemTotalInr !== "number" ||
    typeof quote.deliveryInr !== "number" ||
    typeof quote.taxesInr !== "number" ||
    !discounts(quote.appliedDiscounts) ||
    !discounts(quote.advertisedDiscounts) ||
    typeof quote.cashbackInr !== "number" ||
    typeof quote.rewardPoints !== "number" ||
    typeof quote.totalInr !== "number" ||
    typeof quote.purchaseAvailable !== "boolean" ||
    (quote.unavailableReason !== undefined && typeof quote.unavailableReason !== "string")
  ) {
    return undefined;
  }
  // SAFETY: Every field in CheckoutQuote, including nested arrays and Product, is checked above.
  return quote as CheckoutQuote;
}

function parseCheckoutResult(value: unknown): PravaCheckoutResult | undefined {
  const result = record(value);
  if (result === undefined) return undefined;
  if (result._tag === "not_submitted") {
    if (
      !hasExactKeys(result, ["_tag", "reason", "confirmedTotalInr", "explanation"]) ||
      (result.reason !== "blocked_by_price" && result.reason !== "purchase_unavailable") ||
      (result.confirmedTotalInr !== null && !isConfirmedTotal(result.confirmedTotalInr)) ||
      typeof result.explanation !== "string" || result.explanation.trim() === ""
    ) {
      return undefined;
    }
    return {
      _tag: "not_submitted",
      reason: result.reason,
      confirmedTotalInr: result.confirmedTotalInr,
      explanation: result.explanation,
    };
  }
  if (result._tag !== "submitted" || typeof result.paymentStatus !== "string") return undefined;
  if (result.paymentStatus === "successful") {
    if (
      !hasExactKeys(result, ["_tag", "paymentStatus", "merchantOrderIdentifier", "confirmedTotalInr"]) ||
      typeof result.merchantOrderIdentifier !== "string" ||
      result.merchantOrderIdentifier.trim() === "" ||
      !isConfirmedTotal(result.confirmedTotalInr)
    ) return undefined;
    return {
      _tag: "submitted",
      paymentStatus: "successful",
      merchantOrderIdentifier: result.merchantOrderIdentifier,
      confirmedTotalInr: result.confirmedTotalInr,
    };
  }
  if (result.paymentStatus === "failed") {
    if (
      !hasExactKeys(result, ["_tag", "paymentStatus", "merchantOrderIdentifier", "confirmedTotalInr", "failureReason"]) ||
      result.merchantOrderIdentifier !== null ||
      !isConfirmedTotal(result.confirmedTotalInr) ||
      typeof result.failureReason !== "string" || result.failureReason.trim() === ""
    ) return undefined;
    return {
      _tag: "submitted",
      paymentStatus: "failed",
      merchantOrderIdentifier: null,
      confirmedTotalInr: result.confirmedTotalInr,
      failureReason: result.failureReason,
    };
  }
  if (
    result.paymentStatus !== "unknown" ||
    !hasExactKeys(result, ["_tag", "paymentStatus", "merchantOrderIdentifier", "confirmedTotalInr", "failureReason"]) ||
    (result.merchantOrderIdentifier !== null && (
      typeof result.merchantOrderIdentifier !== "string" || result.merchantOrderIdentifier.trim() === ""
    )) ||
    (result.confirmedTotalInr !== null && !isConfirmedTotal(result.confirmedTotalInr)) ||
    typeof result.failureReason !== "string" || result.failureReason.trim() === ""
  ) return undefined;
  return {
    _tag: "submitted",
    paymentStatus: "unknown",
    merchantOrderIdentifier: result.merchantOrderIdentifier,
    confirmedTotalInr: result.confirmedTotalInr,
    failureReason: result.failureReason,
  };
}

/** Creates the browser-side Prava quote adapter; all agent credentials remain on the server. */
export function createPravaShoppingAdapter(options?: {
  readonly endpoint?: string;
  readonly authorizationEndpoint?: string;
  readonly checkoutEndpoint?: string;
  readonly paymentResultEndpoint?: string;
  readonly fetcher?: typeof fetch;
  readonly openPaymentWindow?: () => PaymentWindow | null;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}): AssessmentAdapters["prava"] {
  const endpoint = options?.endpoint ?? "/api/checkout-quotes";
  const authorizationEndpoint = options?.authorizationEndpoint ?? "/api/checkout-authorizations";
  const checkoutEndpoint = options?.checkoutEndpoint ?? "/api/checkout";
  const paymentResultEndpoint = options?.paymentResultEndpoint ?? "/api/checkout-result";
  const fetcher = options?.fetcher ?? fetch;
  const openPaymentWindow = options?.openPaymentWindow ?? (() => window.open("about:blank", "undo-prava-payment"));
  const wait = options?.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => { window.setTimeout(resolve, milliseconds); }));
  const now = options?.now ?? Date.now;
  const checkoutGrants = new Map<string, string>();
  let paymentWindow: PaymentWindow | null | undefined;
  return {
    prepareCheckout() {
      paymentWindow = openPaymentWindow();
    },
    cancelPreparedCheckout() {
      if (paymentWindow !== undefined && paymentWindow !== null && !paymentWindow.closed) {
        paymentWindow.close();
      }
      paymentWindow = undefined;
    },
    async quoteOffers(
      offers,
      destinationReference,
      traceId,
    ): Promise<AdapterResult<ReadonlyArray<CheckoutQuote>>> {
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...pipelineTraceHeaders(traceId) },
          body: JSON.stringify({ offers, destinationReference }),
        });
        if (!response.ok) throw new Error(`Prava quote endpoint returned ${response.status}`);
        const payload: unknown = await response.json();
        const values = record(payload)?.quotes;
        if (!Array.isArray(values)) throw new Error("Prava quote endpoint returned no quotes");
        const quotes = values.map(parseQuote);
        if (quotes.some((quote) => quote === undefined)) {
          throw new Error("Prava quote endpoint returned an invalid quote");
        }
        return { _tag: "ok", value: quotes.filter((quote) => quote !== undefined) };
      } catch (cause: unknown) {
        return {
          _tag: "err",
          error: { _tag: "DependencyUnavailable", dependency: "prava", cause },
        };
      }
    },
    async registerCheckout(request, traceId) {
      try {
        const response = await fetcher(authorizationEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...pipelineTraceHeaders(traceId) },
          body: JSON.stringify(request),
        });
        if (response.status !== 201) return "unavailable";
        const payload: unknown = await response.json();
        const checkoutGrant = record(payload)?.checkoutGrant;
        if (typeof checkoutGrant !== "string" || checkoutGrant.trim() === "") return "unavailable";
        checkoutGrants.set(request.authorizationId, checkoutGrant);
        return "registered";
      } catch {
        return "unavailable";
      }
    },
    async submitCheckout(request, traceId) {
      let merchantCheckoutMayHaveStarted = false;
      const checkoutGrant = checkoutGrants.get(request.authorizationId);
      if (checkoutGrant === undefined) {
        return {
          _tag: "not_submitted",
          reason: "purchase_unavailable",
          confirmedTotalInr: null,
          explanation: "No server-issued checkout grant is available",
        };
      }
      checkoutGrants.delete(request.authorizationId);
      try {
        const response = await fetcher(checkoutEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...pipelineTraceHeaders(traceId) },
          body: JSON.stringify({ request, checkoutGrant }),
        });
        if (response.status >= 400 && response.status < 500) {
          return {
            _tag: "not_submitted",
            reason: "purchase_unavailable",
            confirmedTotalInr: null,
            explanation: "The server rejected checkout before submission",
          };
        }
        if (!response.ok) throw new Error(`Prava checkout endpoint returned ${response.status}`);
        const payload: unknown = await response.json();
        const envelope = record(payload);
        const immediateResult = parseCheckoutResult(envelope?.result);
        if (immediateResult !== undefined) {
          if (paymentWindow !== undefined && paymentWindow !== null && !paymentWindow.closed) {
            paymentWindow.close();
          }
          paymentWindow = undefined;
          return immediateResult;
        }
        const paymentSession = parsePaymentSession(envelope?.paymentSession);
        if (paymentSession === undefined) {
          throw new Error("Prava checkout endpoint returned an invalid result");
        }
        if (paymentWindow === undefined || paymentWindow === null || paymentWindow.closed) {
          return {
            _tag: "not_submitted",
            reason: "purchase_unavailable",
            confirmedTotalInr: null,
            explanation: "The browser blocked the Prava payment window",
          };
        }
        paymentWindow.location.href = paymentSession.iframeUrl;
        const approvalDeadline = Math.min(Date.parse(paymentSession.expiresAt), now() + 10 * 60 * 1_000);
        // The merchant CLI may run for 120s; keep a separate report-only grace period beyond that.
        const completionDeadline = approvalDeadline + 180_000;
        while (
          now() < approvalDeadline ||
          (merchantCheckoutMayHaveStarted && now() < completionDeadline)
        ) {
          let pollResponse: Response;
          try {
            pollResponse = await fetcher(paymentResultEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...pipelineTraceHeaders(traceId) },
              body: JSON.stringify({
                sessionId: paymentSession.sessionId,
                paymentGrant: paymentSession.paymentGrant,
              }),
            });
          } catch (cause: unknown) {
            // The request may have reached the server even when its response was lost.
            merchantCheckoutMayHaveStarted = true;
            if (now() < completionDeadline) {
              await wait(2_000);
              continue;
            }
            throw cause;
          }
          if (pollResponse.status === 202) {
            await wait(2_000);
            continue;
          }
          if (pollResponse.status >= 500) {
            const failurePayload: unknown = await pollResponse.json().catch(() => undefined);
            merchantCheckoutMayHaveStarted ||=
              record(failurePayload)?.merchantCheckoutMayHaveStarted === true;
            await wait(2_000);
            continue;
          }
          merchantCheckoutMayHaveStarted = true;
          if (!pollResponse.ok) throw new Error(`Prava payment result endpoint returned ${pollResponse.status}`);
          const pollPayload: unknown = await pollResponse.json();
          const result = parseCheckoutResult(record(pollPayload)?.result);
          if (result === undefined) throw new Error("Prava payment result endpoint returned an invalid result");
          try {
            paymentWindow.close();
            window.focus();
          } catch {
            // The result is authoritative even if the cross-origin payment window cannot be closed.
          }
          paymentWindow = undefined;
          return result;
        }
        if (!merchantCheckoutMayHaveStarted) {
          if (!paymentWindow.closed) paymentWindow.close();
          paymentWindow = undefined;
          return {
            _tag: "not_submitted",
            reason: "purchase_unavailable",
            confirmedTotalInr: null,
            explanation: "Prava card approval expired before merchant checkout began",
          };
        }
        throw new Error("Prava payment session expired after merchant checkout may have begun");
      } catch {
        if (!merchantCheckoutMayHaveStarted) {
          if (paymentWindow !== undefined && paymentWindow !== null && !paymentWindow.closed) {
            paymentWindow.close();
          }
          paymentWindow = undefined;
          return {
            _tag: "not_submitted",
            reason: "purchase_unavailable",
            confirmedTotalInr: null,
            explanation: "Prava payment approval did not reach merchant checkout",
          };
        }
        return {
          _tag: "submitted",
          paymentStatus: "unknown",
          merchantOrderIdentifier: null,
          confirmedTotalInr: null,
          failureReason: "Prava did not confirm whether the merchant accepted the order",
        };
      }
    },
  };
}

type PaymentWindow = {
  readonly closed: boolean;
  readonly location: { href: string };
  close(): void;
};

type PaymentSession = {
  readonly sessionId: string;
  readonly iframeUrl: string;
  readonly expiresAt: string;
  readonly paymentGrant: string;
};

function parsePaymentSession(value: unknown): PaymentSession | undefined {
  const session = record(value);
  if (session === undefined || !hasExactKeys(session, ["sessionId", "iframeUrl", "expiresAt", "paymentGrant"])) {
    return undefined;
  }
  const sessionId = session.sessionId;
  const iframeUrl = session.iframeUrl;
  const expiresAt = session.expiresAt;
  const paymentGrant = session.paymentGrant;
  if (
    typeof sessionId !== "string" || !/^ses{1,2}_[A-Za-z0-9_-]+$/.test(sessionId) ||
    typeof iframeUrl !== "string" || typeof expiresAt !== "string" ||
    typeof paymentGrant !== "string" || paymentGrant.trim() === "" ||
    !Number.isFinite(Date.parse(expiresAt))
  ) return undefined;
  const url = new URL(iframeUrl);
  if (url.protocol !== "https:" || (url.hostname !== "prava.space" && !url.hostname.endsWith(".prava.space"))) {
    return undefined;
  }
  return { sessionId, iframeUrl, expiresAt, paymentGrant };
}
