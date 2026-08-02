import { describe, expect, it } from "vitest";

import { SUPPORTED_OFFERS } from "../domain";
import { quoteOffersWithPrava } from "./prava-shopping-server";

const runLive = process.env.RUN_PRAVA_LIVE_TESTS === "1";

describe.skipIf(!runLive)("Prava live shopping boundary", () => {
  it("obtains a binding quote for a verified Offer and keeps unsupported sellers unavailable", async () => {
    const result = await quoteOffersWithPrava(
      SUPPORTED_OFFERS,
      "destination-ref-prava-default",
    );

    expect(result._tag).toBe("ok");
    if (result._tag === "err") return;
    const headphoneZone = result.value.find((quote) => quote.offerId === "headphone-zone");
    const flipkart = result.value.find((quote) => quote.offerId === "flipkart");
    expect(headphoneZone).toMatchObject({
      purchaseAvailable: true,
      merchant: "Headphone Zone",
      seller: "Headphone Zone",
    });
    expect(headphoneZone?.totalInr).toBeGreaterThan(0);
    expect(flipkart).toMatchObject({ purchaseAvailable: false });
  }, 60_000);
});
