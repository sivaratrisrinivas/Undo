import { SUPPORTED_OFFERS, type CheckoutQuote, type Offer } from "../domain";
import type { AdapterResult, AssessmentAdapters } from "../workflow";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isOfferId(value: unknown): value is Offer["id"] {
  return SUPPORTED_OFFERS.some((offer) => offer.id === value);
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

/** Creates the browser-side Prava quote adapter; all agent credentials remain on the server. */
export function createPravaShoppingAdapter(options?: {
  readonly endpoint?: string;
  readonly fetcher?: typeof fetch;
}): AssessmentAdapters["prava"] {
  const endpoint = options?.endpoint ?? "/api/checkout-quotes";
  const fetcher = options?.fetcher ?? fetch;
  return {
    async quoteOffers(offers, destinationReference): Promise<AdapterResult<ReadonlyArray<CheckoutQuote>>> {
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
    submitCheckout() {
      return Promise.resolve({
        _tag: "err" as const,
        error: {
          _tag: "DependencyUnavailable" as const,
          dependency: "prava" as const,
          cause: new Error("Checkout submission is outside issue #5"),
        },
      });
    },
  };
}
