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
  readonly fetcher?: typeof fetch;
}): AssessmentAdapters["prava"] {
  const endpoint = options?.endpoint ?? "/api/checkout-quotes";
  const authorizationEndpoint = options?.authorizationEndpoint ?? "/api/checkout-authorizations";
  const checkoutEndpoint = options?.checkoutEndpoint ?? "/api/checkout";
  const fetcher = options?.fetcher ?? fetch;
  const checkoutGrants = new Map<string, string>();
  return {
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
        const result = parseCheckoutResult(record(payload)?.result);
        if (result === undefined) throw new Error("Prava checkout endpoint returned an invalid result");
        return result;
      } catch {
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
