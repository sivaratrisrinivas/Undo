import { describe, expect, it } from "vitest";

import { createFakeAdapters } from "./adapters/fake-adapters";
import {
  parsePremiumLimitInr,
  SUPPORTED_PRODUCT,
  type Product,
} from "./domain";
import { AssessmentWorkflow } from "./workflow";

function premiumLimit(value: string) {
  const parsed = parsePremiumLimitInr(value);
  if (parsed._tag === "err") throw new Error(parsed.message);
  return parsed.value;
}

async function assess(
  adapters = createFakeAdapters(),
  premium = "2000",
  destination = "Bengaluru · destination-ref-test",
) {
  return new AssessmentWorkflow(adapters).assess(
    SUPPORTED_PRODUCT,
    premiumLimit(premium),
    destination,
  );
}

describe("Product equivalence and Prava checkout quotes", () => {
  it.each([
    "manufacturer",
    "model",
    "variant",
    "condition",
    "bundleContents",
    "warrantyRegion",
  ] as const)("rejects an Offer when %s does not match", async (field) => {
    const mismatchedProduct: Product = { ...SUPPORTED_PRODUCT, [field]: "different" };
    const result = await assess(
      createFakeAdapters({
        quoteOverrides: {
          "concept-kart": { product: mismatchedProduct },
        },
      }),
    );

    expect(result._tag).toBe("ok");
    if (result._tag === "ok") {
      const conceptKart = result.value.offers.find((offer) => offer.offer.id === "concept-kart");
      expect(conceptKart).toMatchObject({
        offerEquivalent: false,
        productEquivalence: {
          equivalent: false,
          mismatches: [{ field }],
        },
        eligible: false,
      });
      expect(conceptKart?.explanation).toContain(`${field}: expected`);
    }
  });

  it("keeps a seller change visible but out of comparison and the Premium baseline", async () => {
    const result = await assess(
      createFakeAdapters({
        quoteOverrides: {
          "concept-kart": { seller: "Different seller" },
        },
      }),
    );

    expect(result._tag).toBe("ok");
    if (result._tag === "ok") {
      const conceptKart = result.value.offers.find((offer) => offer.offer.id === "concept-kart");
      expect(conceptKart).toMatchObject({ offerEquivalent: false, eligible: false });
      expect(conceptKart?.explanation).toBe("Seller changed: expected Concept Kart, received Different seller");
    }
  });

  it("retains delivery, taxes, applied discounts, and excluded discount signals from Prava", async () => {
    const result = await assess(
      createFakeAdapters({
        quoteOverrides: {
          "headphone-zone": {
            itemTotalInr: 15_000,
            deliveryInr: 300,
            taxesInr: 200,
            appliedDiscounts: [{ label: "Applied card offer", amountInr: 500 }],
            advertisedDiscounts: [{ label: "Advertised bank offer", amountInr: 5_000 }],
            cashbackInr: 1_000,
            rewardPoints: 250,
            totalInr: 15_000,
          },
        },
      }),
    );

    expect(result).toMatchObject({ _tag: "ok" });
    if (result._tag === "ok") {
      expect(result.value.offers.find((offer) => offer.offer.id === "headphone-zone")?.checkoutQuote).toEqual(
        expect.objectContaining({
          itemTotalInr: 15_000,
          deliveryInr: 300,
          taxesInr: 200,
          appliedDiscounts: [{ label: "Applied card offer", amountInr: 500 }],
          advertisedDiscounts: [{ label: "Advertised bank offer", amountInr: 5_000 }],
          cashbackInr: 1_000,
          rewardPoints: 250,
          totalInr: 15_000,
        }),
      );
    }
  });

  it("uses only equivalent Purchase Available Offers for the baseline", async () => {
    const mismatchedProduct: Product = { ...SUPPORTED_PRODUCT, variant: "White" };
    const result = await assess(
      createFakeAdapters({
        quoteOverrides: {
          "headphone-zone": { product: mismatchedProduct },
          "concept-kart": { product: mismatchedProduct },
          flipkart: { product: mismatchedProduct },
        },
      }),
    );

    expect(result).toMatchObject({
      _tag: "err",
      error: {
        reason: "purchase_unavailable",
        record: { outcome: "purchase_unavailable" },
      },
    });
  });

  it("records the exact Premium Limit boundary and blocks one rupee below it", async () => {
    const withinLimit = await assess(createFakeAdapters(), "500");
    expect(withinLimit._tag).toBe("ok");

    const belowLimit = await assess(createFakeAdapters(), "499");
    expect(belowLimit).toMatchObject({
      _tag: "err",
      error: {
        reason: "blocked_by_price",
        record: {
          outcome: "blocked_by_price",
          blockingReason: "No reversible Offer is within this Premium Limit",
        },
      },
    });
  });

  it("passes only an opaque destination reference to Prava and records that reference", async () => {
    const base = createFakeAdapters();
    const destinations: string[] = [];
    const adapters = {
      ...base,
      prava: {
        ...base.prava,
        quoteOffers: async (offers: Parameters<typeof base.prava.quoteOffers>[0], destination: string) => {
          destinations.push(destination);
          return base.prava.quoteOffers(offers, destination);
        },
      },
    };

    const result = await assess(adapters, "2000", "12 Example Street, Bengaluru, 560001");

    expect(destinations[0]).toMatch(/^destination-ref-[a-f0-9]{8}$/);
    expect(destinations[0]).not.toContain("Example Street");
    expect(result).toMatchObject({
      _tag: "ok",
      value: { destinationReference: destinations[0] },
    });
  });
});
