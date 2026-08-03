import { describe, expect, it } from "vitest";

import {
  parsePremiumLimitInr,
  OFFICIAL_EVIDENCE_SOURCES,
  SUPPORTED_OFFERS,
  SUPPORTED_PRODUCT,
  type CheckoutQuote,
  type EvidenceSnapshot,
  type Offer,
  type PolicyAssessment,
} from "./domain";
import { AssessmentWorkflow, type AssessmentAdapters } from "./workflow";
import { createInMemoryPurchaseAuthorizationRepository } from "./adapters/fake-adapters";

const snapshots: ReadonlyArray<EvidenceSnapshot> = SUPPORTED_OFFERS.map((offer) => {
  const source = OFFICIAL_EVIDENCE_SOURCES.find((candidate) => candidate.offerId === offer.id);
  if (source === undefined) throw new Error(`Missing official source fixture for ${offer.id}`);
  return {
  offerId: offer.id,
  merchant: offer.merchant,
  sourceUrl: source.sourceUrl,
  scope: source.scope,
  collectedAt: "2026-08-01T10:30:00.000Z",
  exactText: "Deterministic ranking test evidence.",
  fingerprint: `sha256:${offer.id}`,
  retrievedVia: "senso",
  retrievalState: "current",
  };
});

function makePolicy(offerId: Offer["id"]): PolicyAssessment {
  const sourceUrl = OFFICIAL_EVIDENCE_SOURCES.find((source) => source.offerId === offerId)?.sourceUrl ?? "";
  return {
    offerId,
    changeOfMind: "money_back",
    defect: "none",
    productCondition: "opened_unused",
    remedyWindow: { kind: "known", days: 7, startsAt: "delivered", requiredAction: "request_submitted" },
    returnTransport: "self_ship",
    reversalCost: { kind: "known", amountInr: 100 },
    materialConditions: [],
    supplementaryRemedies: [],
    quote: "Deterministic ranking test evidence.",
    citations: ["remedy", "window", "product_condition", "return_transport", "buyer_paid_fees"].map(
      (fact) => ({
        fact: fact as PolicyAssessment["citations"][number]["fact"],
        quote: "Deterministic ranking test evidence.",
        sourceUrl,
      }),
    ),
  };
}

function makeAdapters(
  policies: ReadonlyArray<PolicyAssessment>,
  quotes: ReadonlyArray<CheckoutQuote>,
): AssessmentAdapters {
  const policyFor = (offerId: PolicyAssessment["offerId"]) => {
    const policy = policies.find((candidate) => candidate.offerId === offerId);
    if (policy === undefined) throw new Error(`Missing policy fixture for ${offerId}`);
    return policy;
  };
  const reviews = new Map(
    snapshots.map((snapshot) => [
      snapshot.fingerprint,
      {
        fingerprint: snapshot.fingerprint,
        approvedAt: "2026-08-01T11:00:00.000Z",
        policy: policyFor(snapshot.offerId),
      },
    ]),
  );
  return {
    policyContract: { purchaseEnabled: () => true },
    evidenceApplicability: { appliesToProduct: () => true },
    senso: { retrieveEvidence: () => Promise.resolve({ _tag: "ok", value: snapshots }) },
    openAi: {
      modelVersion: () => "fake-openai/test",
      extractPolicies: () => Promise.resolve({ _tag: "ok", value: policies }),
    },
    prava: {
      registerCheckout: () => Promise.resolve("registered"),
      quoteOffers: (_offers, destinationReference) =>
        Promise.resolve({
          _tag: "ok",
          value: quotes.map((quote) => ({ ...quote, destinationReference })),
        }),
      submitCheckout: () =>
        Promise.resolve({
          _tag: "submitted",
          paymentStatus: "unknown",
          merchantOrderIdentifier: null,
          confirmedTotalInr: null,
          failureReason: "not used",
        }),
    },
    evidence: {
      findReview: (fingerprint) => Promise.resolve(reviews.get(fingerprint)),
      saveReview: (review) => { reviews.set(review.fingerprint, review); return Promise.resolve(); },
      loadCache: () => Promise.resolve(undefined),
      saveCache: () => Promise.resolve(),
    },
    authorization: createInMemoryPurchaseAuthorizationRepository(),
    records: { save: () => Promise.resolve("saved"), find: () => Promise.resolve(undefined), latestCompletedPurchase: () => Promise.resolve(undefined) },
    now: () => "2026-08-01T12:00:00.000Z",
    nextAuthorizationId: () => "ranking-authorization",
    nextRecordId: () => "ranking-test",
  };
}

function premiumLimit(value: string) {
  const result = parsePremiumLimitInr(value);
  if (result._tag === "err") throw new Error("Invalid test Premium Limit");
  return result.value;
}

const baseQuotes: ReadonlyArray<CheckoutQuote> = [
  quoteFor("headphone-zone", 10_000, true),
  quoteFor("concept-kart", 10_000, true),
  quoteFor("flipkart", 10_000, false),
];

function quoteFor(offerId: Offer["id"], totalInr: number, purchaseAvailable: boolean): CheckoutQuote {
  const offer = SUPPORTED_OFFERS.find((candidate) => candidate.id === offerId);
  if (offer === undefined) throw new Error(`Missing quote fixture for ${offerId}`);
  return {
    offerId,
    merchant: offer.merchant,
    seller: offer.seller,
    destinationReference: "destination-ref-test",
    product: SUPPORTED_PRODUCT,
    itemTotalInr: totalInr - 500,
    deliveryInr: 300,
    taxesInr: 200,
    appliedDiscounts: [],
    advertisedDiscounts: [],
    cashbackInr: 0,
    rewardPoints: 0,
    totalInr,
    purchaseAvailable,
  };
}

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
      left: { remedyWindow: { kind: "known" as const, days: 8, startsAt: "delivered" as const, requiredAction: "request_submitted" as const } },
      right: { remedyWindow: { kind: "known" as const, days: 7, startsAt: "delivered" as const, requiredAction: "request_submitted" as const } },
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
      quoteFor("headphone-zone", 10_000, true),
      quoteFor("concept-kart", 10_001, true),
      quoteFor("flipkart", 10_002, false),
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

  it("names the exact required policy fact that blocks the only purchasable Offer", async () => {
    const policies = SUPPORTED_OFFERS.map((offer) =>
      offer.id === "headphone-zone"
        ? { ...makePolicy(offer.id), remedyWindow: { kind: "unclear" as const } }
        : { ...makePolicy(offer.id), changeOfMind: "none" as const },
    );
    const quotes: ReadonlyArray<CheckoutQuote> = [
      quoteFor("headphone-zone", 10_000, true),
      quoteFor("concept-kart", 10_000, false),
      quoteFor("flipkart", 10_000, false),
    ];
    const pipelineEntries: Array<{
      readonly stage: string;
      readonly details: Readonly<Record<string, unknown>> | undefined;
    }> = [];
    const adapters: AssessmentAdapters = {
      ...makeAdapters(policies, quotes),
      pipeline: {
        nextTraceId: () => "trace-policy-block",
        logger: (traceId) => ({
          traceId,
          log: (stage, _status, details) => { pipelineEntries.push({ stage, details }); },
        }),
      },
    };

    const result = await new AssessmentWorkflow(adapters).assess(
      SUPPORTED_PRODUCT,
      premiumLimit("2000"),
      "destination-ref-test",
    );

    expect(result._tag).toBe("err");
    if (result._tag === "err") {
      expect(result.error).toMatchObject({ reason: "blocked_by_policy" });
      expect(result.error.message).toContain(
        "Headphone Zone: Policy Unclear (Remedy Window missing duration, start event, or deadline action)",
      );
    }
    const offerValidation = pipelineEntries.find((entry) => entry.stage === "offer.validation");
    expect(offerValidation?.details?.policyBlocks).toContain(
      "headphone-zone:Policy Unclear (Remedy Window missing duration, start event, or deadline action)",
    );
  });
});
