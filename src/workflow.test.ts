import { describe, expect, it } from "vitest";

import {
  parsePremiumLimitInr,
  SUPPORTED_OFFERS,
  SUPPORTED_PRODUCT,
  type CheckoutQuote,
  type EvidenceSnapshot,
  type Offer,
  type PolicyAssessment,
} from "./domain";
import { AssessmentWorkflow, type AssessmentAdapters } from "./workflow";

const snapshots: ReadonlyArray<EvidenceSnapshot> = SUPPORTED_OFFERS.map((offer) => ({
  offerId: offer.id,
  sourceUrl: offer.url,
  collectedAt: "2026-08-01T10:30:00.000Z",
  exactText: "Deterministic ranking test evidence.",
  fingerprint: `sha256:${offer.id}`,
}));

function makePolicy(offerId: Offer["id"]): PolicyAssessment {
  return {
    offerId,
    changeOfMind: "money_back",
    defect: "none",
    productCondition: "opened_unused",
    remedyWindow: { days: 7, startsAt: "delivered", requiredAction: "request_submitted" },
    returnTransport: "self_ship",
    reversalCost: { kind: "known", amountInr: 100 },
    materialConditions: [],
    quote: "Deterministic ranking test evidence.",
  };
}

function makeAdapters(
  policies: ReadonlyArray<PolicyAssessment>,
  quotes: ReadonlyArray<CheckoutQuote>,
): AssessmentAdapters {
  return {
    senso: { retrieveEvidence: () => Promise.resolve({ _tag: "ok", value: snapshots }) },
    openAi: { extractPolicies: () => Promise.resolve({ _tag: "ok", value: policies }) },
    prava: {
      quoteOffers: () => Promise.resolve({ _tag: "ok", value: quotes }),
      submitCheckout: () =>
        Promise.resolve({
          _tag: "err",
          error: { _tag: "DependencyUnavailable", dependency: "prava", cause: "not used" },
        }),
    },
    now: () => "2026-08-01T12:00:00.000Z",
    nextRecordId: () => "ranking-test",
  };
}

function premiumLimit(value: string) {
  const result = parsePremiumLimitInr(value);
  if (result._tag === "err") throw new Error("Invalid test Premium Limit");
  return result.value;
}

const baseQuotes: ReadonlyArray<CheckoutQuote> = [
  { offerId: "headphone-zone", totalInr: 10_000, purchaseAvailable: true },
  { offerId: "concept-kart", totalInr: 10_000, purchaseAvailable: true },
  { offerId: "flipkart", totalInr: 10_000, purchaseAvailable: false },
];

describe("Remedy Ranking", () => {
  it.each([
    {
      rule: "Trial Permission",
      left: { productCondition: "trial_allowed" as const },
      right: { productCondition: "opened_unused" as const },
    },
    {
      rule: "money back over store credit",
      left: { changeOfMind: "money_back" as const },
      right: { changeOfMind: "store_credit" as const },
    },
    {
      rule: "longer Remedy Window",
      left: { remedyWindow: { days: 8, startsAt: "delivered" as const, requiredAction: "request_submitted" as const } },
      right: { remedyWindow: { days: 7, startsAt: "delivered" as const, requiredAction: "request_submitted" as const } },
    },
    {
      rule: "doorstep pickup over self-shipping",
      left: { returnTransport: "doorstep_pickup" as const },
      right: { returnTransport: "self_ship" as const },
    },
    {
      rule: "lower evidenced Reversal Cost",
      left: { reversalCost: { kind: "explicit_none" as const } },
      right: { reversalCost: { kind: "unstated" as const } },
    },
  ])("applies $rule before purchase price", async ({ left, right }) => {
    const policies = [
      { ...makePolicy("headphone-zone"), ...left },
      { ...makePolicy("concept-kart"), ...right },
      { ...makePolicy("flipkart"), changeOfMind: "none" as const },
    ];
    const workflow = new AssessmentWorkflow(makeAdapters(policies, baseQuotes));

    const result = await workflow.assess(
      SUPPORTED_PRODUCT,
      premiumLimit("2000"),
      "destination-ref-test",
    );

    expect(result._tag).toBe("ok");
    if (result._tag === "ok") {
      expect(result.value.ranking).toMatchObject({
        _tag: "winner",
        offer: { offer: { id: "headphone-zone" } },
      });
    }
  });

  it("uses lower purchase price only after the remedy rules", async () => {
    const policies = SUPPORTED_OFFERS.map((offer) => makePolicy(offer.id));
    const quotes: ReadonlyArray<CheckoutQuote> = [
      { offerId: "headphone-zone", totalInr: 10_000, purchaseAvailable: true },
      { offerId: "concept-kart", totalInr: 10_001, purchaseAvailable: true },
      { offerId: "flipkart", totalInr: 10_002, purchaseAvailable: false },
    ];
    const result = await new AssessmentWorkflow(makeAdapters(policies, quotes)).assess(
      SUPPORTED_PRODUCT,
      premiumLimit("2000"),
      "destination-ref-test",
    );

    expect(result).toMatchObject({
      _tag: "ok",
      value: { ranking: { _tag: "winner", offer: { offer: { id: "headphone-zone" } } } },
    });
  });

  it("reports Purchase Unavailable when no Offer can set a baseline", async () => {
    const policies = SUPPORTED_OFFERS.map((offer) => makePolicy(offer.id));
    const quotes = baseQuotes.map((quote) => ({ ...quote, purchaseAvailable: false }));
    const result = await new AssessmentWorkflow(makeAdapters(policies, quotes)).assess(
      SUPPORTED_PRODUCT,
      premiumLimit("2000"),
      "destination-ref-test",
    );

    expect(result).toMatchObject({ _tag: "err", error: { reason: "purchase_unavailable" } });
  });

  it("blocks when evidence supports no Reversible Offer", async () => {
    const policies = SUPPORTED_OFFERS.map((offer) => ({
      ...makePolicy(offer.id),
      changeOfMind: "none" as const,
    }));
    const result = await new AssessmentWorkflow(makeAdapters(policies, baseQuotes)).assess(
      SUPPORTED_PRODUCT,
      premiumLimit("2000"),
      "destination-ref-test",
    );

    expect(result).toMatchObject({ _tag: "err", error: { reason: "blocked_by_policy" } });
  });
});
