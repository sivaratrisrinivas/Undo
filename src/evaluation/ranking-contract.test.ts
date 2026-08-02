import { describe, expect, it } from "vitest";

import {
  OFFICIAL_EVIDENCE_SOURCES,
  POLICY_FACTS,
  parsePremiumLimitInr,
  SUPPORTED_OFFERS,
  SUPPORTED_PRODUCT,
  type CheckoutQuote,
  type EvidenceReview,
  type EvidenceSnapshot,
  type Offer,
  type PolicyAssessment,
} from "../domain";
import { AssessmentWorkflow, type AssessmentAdapters } from "../workflow";
import {
  FROZEN_RANKING_SCENARIOS,
  type FrozenRankingOffer,
  type FrozenRankingScenario,
} from "./frozen-ranking-scenarios";

const NOW = "2026-08-01T12:00:00.000Z";
const EVIDENCE_TEXT = "Frozen deterministic ranking evidence.";

function configuredOffer(
  scenario: FrozenRankingScenario,
  offer: Offer,
): FrozenRankingOffer {
  return scenario.offers?.[offer.id] ?? {};
}

function policyFor(offer: Offer, overrides: FrozenRankingOffer): PolicyAssessment {
  const source = OFFICIAL_EVIDENCE_SOURCES.find((candidate) => candidate.offerId === offer.id);
  if (source === undefined) throw new Error(`Missing source fixture for ${offer.id}`);
  const ordinaryCitations: PolicyAssessment["citations"] = POLICY_FACTS.map((fact) => ({
    fact,
    quote: EVIDENCE_TEXT,
    sourceUrl: source.sourceUrl,
  }));
  const citations =
    overrides.evidenceProblem === "missing_required_citation"
      ? ordinaryCitations.filter((citation) => citation.fact !== "product_condition")
      : overrides.evidenceProblem === "conflicting_required_evidence"
        ? ordinaryCitations.flatMap((citation) =>
            citation.fact === "product_condition"
              ? [
                  { ...citation, quote: "Policy says the Product must remain sealed." },
                  { ...citation, quote: "Policy says ordinary trials are allowed." },
                ]
              : [citation],
          )
        : ordinaryCitations;
  const evidenceDerivedProductCondition =
    overrides.evidenceProblem === "conflicting_required_evidence"
      ? "unclear" as const
      : "opened_unused" as const;
  return {
    offerId: offer.id,
    changeOfMind: offer.id === "flipkart" ? "none" : "money_back",
    defect: "none",
    productCondition: evidenceDerivedProductCondition,
    remedyWindow: {
      kind: "known",
      days: 7,
      startsAt: "delivered",
      requiredAction: "request_submitted",
    },
    returnTransport: "self_ship",
    reversalCost: { kind: "known", amountInr: 100 },
    materialConditions: [],
    supplementaryRemedies: [],
    quote: EVIDENCE_TEXT,
    citations,
    ...overrides.policy,
  };
}

function snapshotFor(offer: Offer, overrides: FrozenRankingOffer): EvidenceSnapshot {
  const source = OFFICIAL_EVIDENCE_SOURCES.find((candidate) => candidate.offerId === offer.id);
  if (source === undefined) throw new Error(`Missing source fixture for ${offer.id}`);
  return {
    offerId: offer.id,
    merchant: offer.merchant,
    sourceUrl: source.sourceUrl,
    scope: source.scope,
    collectedAt: overrides.collectedAt ?? "2026-08-01T11:00:00.000Z",
    exactText:
      overrides.evidenceProblem === "conflicting_required_evidence"
        ? `${EVIDENCE_TEXT} Policy says the Product must remain sealed. Policy says ordinary trials are allowed.`
        : EVIDENCE_TEXT,
    fingerprint: `sha256:frozen-${offer.id}`,
    retrievedVia: "senso",
    retrievalState: overrides.retrievalState ?? "current",
  };
}

function quoteFor(offer: Offer, overrides: FrozenRankingOffer): CheckoutQuote {
  const totalInr = overrides.totalInr ?? (offer.id === "concept-kart" ? 10_100 : 10_000);
  return {
    offerId: offer.id,
    merchant: overrides.merchant ?? offer.merchant,
    seller: overrides.seller ?? offer.seller,
    destinationReference: "destination-ref-ranking-contract",
    product: { ...SUPPORTED_PRODUCT, ...overrides.product },
    itemTotalInr: totalInr - 500,
    deliveryInr: 300,
    taxesInr: 200,
    appliedDiscounts: [],
    advertisedDiscounts: [],
    cashbackInr: 0,
    rewardPoints: 0,
    totalInr,
    purchaseAvailable: overrides.purchaseAvailable ?? offer.id !== "flipkart",
  };
}

function adaptersFor(scenario: FrozenRankingScenario): AssessmentAdapters {
  const snapshots = SUPPORTED_OFFERS.map((offer) =>
    snapshotFor(offer, configuredOffer(scenario, offer)),
  );
  const policies = SUPPORTED_OFFERS.map((offer) =>
    policyFor(offer, configuredOffer(scenario, offer)),
  );
  const reviews = new Map<string, EvidenceReview>(
    snapshots.flatMap((snapshot, index) => {
      const offer = SUPPORTED_OFFERS[index];
      const policy = policies[index];
      if (offer === undefined || policy === undefined) return [];
      return configuredOffer(scenario, offer).reviewed === false
        ? []
        : [[
            snapshot.fingerprint,
            {
              fingerprint: configuredOffer(scenario, offer).reviewFingerprint ?? snapshot.fingerprint,
              approvedAt: NOW,
              policy,
            },
          ]];
    }),
  );
  const cache = { snapshots, reviews: [...reviews.values()] };
  return {
    policyContract: { purchaseEnabled: () => true },
    evidenceApplicability: { appliesToProduct: () => true },
    senso: {
      retrieveEvidence: () =>
        Promise.resolve(
          scenario.useReviewedCache
            ? {
                _tag: "err" as const,
                error: {
                  _tag: "DependencyUnavailable" as const,
                  dependency: "senso" as const,
                  cause: "frozen cache scenario",
                },
              }
            : { _tag: "ok" as const, value: snapshots },
        ),
    },
    openAi: {
      modelVersion: () => "fake-openai/frozen-ranking",
      extractPolicies: () => Promise.resolve({ _tag: "ok", value: policies }),
    },
    prava: {
      quoteOffers: (_offers, destinationReference) =>
        Promise.resolve({
          _tag: "ok",
          value: SUPPORTED_OFFERS.map((offer) =>
            ({
              ...quoteFor(offer, configuredOffer(scenario, offer)),
              destinationReference,
            }),
          ),
        }),
      submitCheckout: () =>
        Promise.resolve({
          _tag: "err",
          error: { _tag: "DependencyUnavailable", dependency: "prava", cause: "not used" },
        }),
    },
    evidence: {
      findReview: (fingerprint) => Promise.resolve(reviews.get(fingerprint)),
      saveReview: () => Promise.resolve(),
      loadCache: () => Promise.resolve(scenario.useReviewedCache ? cache : undefined),
      saveCache: () => Promise.resolve(),
    },
    now: () => NOW,
    nextAuthorizationId: () => "frozen-ranking-authorization",
    nextRecordId: () => "frozen-ranking-record",
  };
}

function premiumLimit(value: number) {
  const result = parsePremiumLimitInr(String(value));
  if (result._tag === "err") throw new Error(result.message);
  return result.value;
}

describe("frozen Remedy Ranking contract", () => {
  it("contains exactly the 30 human-authored scenarios required by the release gate", () => {
    expect(FROZEN_RANKING_SCENARIOS).toHaveLength(30);
  });

  it.each(FROZEN_RANKING_SCENARIOS)("$name", async (scenario) => {
    const workflow = new AssessmentWorkflow(adaptersFor(scenario));
    const result = await workflow.assess(
      SUPPORTED_PRODUCT,
      premiumLimit(scenario.premiumLimitInr ?? 2_000),
      "destination-ref-frozen-ranking",
    );

    if (scenario.expected._tag === "blocked") {
      expect(result).toMatchObject({
        _tag: "err",
        error: { _tag: "NoEligibleOffer", reason: scenario.expected.reason },
      });
      return;
    }

    expect(result._tag).toBe("ok");
    if (result._tag === "err") return;
    if (scenario.expected._tag === "winner") {
      expect(result.value.ranking).toMatchObject({
        _tag: "winner",
        offer: { offer: { id: scenario.expected.offerId } },
      });
    } else {
      expect(result.value.ranking._tag).toBe("tied");
      if (result.value.ranking._tag === "tied") {
        expect(result.value.ranking.offers.map((offer) => offer.offer.id)).toEqual(
          scenario.expected.offerIds,
        );
      }
    }

    if (scenario.buyerSelection !== undefined) {
      const selection = workflow.selectOffer(result.value, scenario.buyerSelection.offerId);
      const actual = selection._tag === "ok" ? selection.value.selection : selection.reason;
      expect(actual).toBe(scenario.buyerSelection.expected);
    }
  });

  it.each([
    {
      name: "future-dated evidence is not fresh",
      offer: { collectedAt: "2026-08-01T12:00:00.001Z" },
      expected: "winner" as const,
    },
    {
      name: "a review for a different fingerprint is not Reviewed Evidence",
      offer: { reviewFingerprint: "sha256:different-content" },
      expected: "blocked" as const,
    },
  ])("rejects $name", async ({ offer, expected }) => {
    const scenario: FrozenRankingScenario = {
      name: "safety regression",
      offers: { "headphone-zone": offer },
      expected: { _tag: "winner", offerId: "concept-kart" },
    };
    const result = await new AssessmentWorkflow(adaptersFor(scenario)).assess(
      SUPPORTED_PRODUCT,
      premiumLimit(2_000),
      "destination-ref-safety-regression",
    );

    expect(result).toMatchObject(
      expected === "winner"
        ? {
            _tag: "ok",
            value: { ranking: { _tag: "winner", offer: { offer: { id: "concept-kart" } } } },
          }
        : { _tag: "err", error: { reason: "blocked_by_policy" } },
    );
  });
});
