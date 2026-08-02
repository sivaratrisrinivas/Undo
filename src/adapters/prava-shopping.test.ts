import { describe, expect, it } from "vitest";

import { SUPPORTED_OFFERS, SUPPORTED_PRODUCT, type CheckoutQuote } from "../domain";
import { createPravaShoppingAdapter } from "./prava-shopping";

const quote: CheckoutQuote = {
  offerId: "headphone-zone",
  merchant: "Headphone Zone",
  seller: "Headphone Zone",
  product: SUPPORTED_PRODUCT,
  itemTotalInr: 12_990,
  deliveryInr: 0,
  taxesInr: 0,
  appliedDiscounts: [],
  advertisedDiscounts: [],
  cashbackInr: 0,
  rewardPoints: 0,
  totalInr: 12_990,
  purchaseAvailable: true,
};

describe("Prava shopping browser boundary", () => {
  it("sends only curated offers and an opaque destination to the server", async () => {
    const requests: Array<RequestInit> = [];
    const fetcher: typeof fetch = (_url, init) => {
      requests.push(init ?? {});
      return Promise.resolve(new Response(JSON.stringify({ quotes: [quote] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    };

    const result = await createPravaShoppingAdapter({ fetcher }).quoteOffers(
      SUPPORTED_OFFERS,
      "addr_home1",
    );

    expect(result).toEqual({ _tag: "ok", value: [quote] });
    const body = requests[0]?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(body)).toEqual({ offers: SUPPORTED_OFFERS, destinationReference: "addr_home1" });
    expect(body).not.toMatch(/secretKey|publishableKey|"street"|"phone"|"card"/i);
  });

  it("rejects malformed quote responses instead of trusting decoded JSON", async () => {
    const fetcher: typeof fetch = () => Promise.resolve(
      new Response(JSON.stringify({ quotes: [{ ...quote, totalInr: "12990" }] }), { status: 200 }),
    );

    const result = await createPravaShoppingAdapter({ fetcher }).quoteOffers(
      SUPPORTED_OFFERS,
      "addr_home1",
    );

    expect(result).toMatchObject({
      _tag: "err",
      error: { dependency: "prava" },
    });
  });
});
