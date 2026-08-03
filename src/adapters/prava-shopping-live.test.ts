import { describe, expect, it } from "vitest";

import { SUPPORTED_OFFERS, SUPPORTED_PRODUCT } from "../domain";
import { quoteOffersWithPrava } from "./prava-shopping-server";

const runLive = process.env.RUN_PRAVA_LIVE_TESTS === "1";

describe.skipIf(!runLive)("Prava live shopping boundary", () => {
  it("verifies the current Product, seller, price, and orderability for every curated Offer", async () => {
    const result = await quoteOffersWithPrava(
      SUPPORTED_OFFERS,
      "destination-ref-prava-default",
    );

    expect(result._tag).toBe("ok");
    if (result._tag === "err") return;
    expect(result.value).toHaveLength(SUPPORTED_OFFERS.length);
    for (const offer of SUPPORTED_OFFERS) {
      const quote = result.value.find((candidate) => candidate.offerId === offer.id);
      expect(quote).toBeDefined();
      expect(quote).toMatchObject({
        offerId: offer.id,
        merchant: offer.merchant,
        seller: offer.seller,
        destinationReference: "destination-ref-prava-default",
      });
      if (quote === undefined) continue;
      const monetaryValues = [
        quote.itemTotalInr,
        quote.deliveryInr,
        quote.taxesInr,
        quote.cashbackInr,
        quote.rewardPoints,
        quote.totalInr,
      ];
      expect(monetaryValues.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
      if (quote.purchaseAvailable) {
        expect(quote.product).toEqual(SUPPORTED_PRODUCT);
        expect(quote.totalInr).toBeGreaterThan(0);
      } else {
        expect(quote.unavailableReason).toEqual(expect.any(String));
        expect(quote.unavailableReason).not.toBe("");
      }
    }
    expect(result.value.find((quote) => quote.offerId === "headphone-zone")).toMatchObject({ purchaseAvailable: true });
    expect(result.value.find((quote) => quote.offerId === "concept-kart")).toMatchObject({ purchaseAvailable: false });
    expect(result.value.find((quote) => quote.offerId === "flipkart")).toMatchObject({ purchaseAvailable: false });
  }, 60_000);
});
