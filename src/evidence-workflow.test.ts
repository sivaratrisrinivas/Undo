import { describe, expect, it } from "vitest";

import {
  parsePremiumLimitInr,
  OFFICIAL_EVIDENCE_SOURCES,
  SUPPORTED_OFFERS,
  SUPPORTED_PRODUCT,
  type CheckoutQuote,
  type EvidenceReview,
  type EvidenceSnapshot,
  type Offer,
  type PolicyAssessment,
  type ReviewedEvidenceCache,
} from "./domain";
import { AssessmentWorkflow, type AssessmentAdapters } from "./workflow";

const collectedAt = "2026-08-02T08:00:00.000Z";

function policyFor(offerId: Offer["id"]): PolicyAssessment {
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
    quote: "Returns are accepted within 7 days of delivery.",
    citations: ["remedy", "window", "product_condition", "return_transport", "buyer_paid_fees"].map(
      (fact) => ({
        fact: fact as PolicyAssessment["citations"][number]["fact"],
        quote: "Returns are accepted within 7 days of delivery.",
        sourceUrl,
      }),
    ),
  };
}

function snapshotFor(offer: Offer, fingerprint = `sha256:${offer.id}`): EvidenceSnapshot {
  const source = OFFICIAL_EVIDENCE_SOURCES.find((candidate) => candidate.offerId === offer.id)!;
  return {
    offerId: offer.id,
    merchant: offer.merchant,
    sourceUrl: source.sourceUrl,
    scope: source.scope,
    collectedAt,
    exactText: "Returns are accepted within 7 days of delivery.",
    fingerprint,
    retrievedVia: "senso",
    retrievalState: "current",
  };
}

function premiumLimit() {
  const result = parsePremiumLimitInr("2000");
  if (result._tag === "err") throw new Error(result.message);
  return result.value;
}

function adapters(
  snapshots: ReadonlyArray<EvidenceSnapshot>,
  policies: ReadonlyArray<PolicyAssessment>,
  reviews: ReadonlyArray<EvidenceReview>,
  options?: {
    readonly failSenso?: boolean;
    readonly failOpenAi?: boolean;
    readonly cache?: ReviewedEvidenceCache;
  },
): AssessmentAdapters {
  const reviewByFingerprint = new Map(reviews.map((review) => [review.fingerprint, review]));
  return {
    senso: {
      retrieveEvidence: () =>
        options?.failSenso === true
          ? Promise.resolve({
              _tag: "err",
              error: {
                _tag: "DependencyUnavailable",
                dependency: "senso",
                cause: "outage",
              },
            })
          : Promise.resolve({ _tag: "ok", value: snapshots }),
    },
    openAi: {
      modelVersion: () => "fake-openai/test",
      extractPolicies: () =>
        options?.failOpenAi === true
          ? Promise.resolve({
              _tag: "err",
              error: {
                _tag: "DependencyUnavailable",
                dependency: "openai",
                cause: "outage",
              },
            })
          : Promise.resolve({ _tag: "ok", value: policies }),
    },
    prava: {
      quoteOffers: () =>
        Promise.resolve({
          _tag: "ok",
          value: SUPPORTED_OFFERS.map(
            (offer, index): CheckoutQuote => ({
              offerId: offer.id,
              totalInr: 14_000 + index * 100,
              purchaseAvailable: true,
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
      findReview: (fingerprint) => Promise.resolve(reviewByFingerprint.get(fingerprint)),
      saveReview: (review) => {
        reviewByFingerprint.set(review.fingerprint, review);
        return Promise.resolve();
      },
      loadCache: () => Promise.resolve(options?.cache),
      saveCache: () => Promise.resolve(),
    },
    now: () => "2026-08-02T09:00:00.000Z",
    nextRecordId: () => "evidence-record",
  };
}

describe("Policy Evidence workflow", () => {
  it("creates a blocked Undo Record naming OpenAI when extraction fails without a valid cache", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => snapshotFor(offer));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));

    const result = await new AssessmentWorkflow(
      adapters(snapshots, policies, [], { failOpenAi: true }),
    ).assess(SUPPORTED_PRODUCT, premiumLimit(), "destination-ref-test");

    expect(result).toMatchObject({
      _tag: "err",
      error: {
        reason: "blocked_by_policy",
        message:
          "Policy check unavailable: OpenAI extraction failed and no valid Reviewed Evidence cache exists",
        record: {
          outcome: "blocked_by_policy",
          evidence: snapshots,
          blockingReason:
            "Policy check unavailable: OpenAI extraction failed and no valid Reviewed Evidence cache exists",
        },
      },
    });
  });

  it("uses only a matching Reviewed Evidence cache when OpenAI extraction is unavailable", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => snapshotFor(offer));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));
    const reviews = snapshots.map((snapshot, index): EvidenceReview => {
      const policy = policies[index];
      if (policy === undefined) throw new Error("Expected policy fixture");
      return {
        fingerprint: snapshot.fingerprint,
        approvedAt: "2026-08-01T12:00:00.000Z",
        policy,
      };
    });

    const result = await new AssessmentWorkflow(
      adapters(snapshots, policies, [], {
        failOpenAi: true,
        cache: { snapshots, reviews },
      }),
    ).assess(SUPPORTED_PRODUCT, premiumLimit(), "destination-ref-test");

    expect(result).toMatchObject({
      _tag: "ok",
      value: {
        offers: [
          { evidenceReview: { state: "reviewed", reused: true } },
          { evidenceReview: { state: "reviewed", reused: true } },
          { evidenceReview: { state: "reviewed", reused: true } },
        ],
      },
    });
  });

  it("reuses human review for a fresh Senso retrieval with the same fingerprint", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => snapshotFor(offer));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));
    const reviews = snapshots.map(
      (snapshot, index): EvidenceReview => ({
        fingerprint: snapshot.fingerprint,
        approvedAt: "2026-08-01T12:00:00.000Z",
        policy: policies[index]!,
      }),
    );

    const result = await new AssessmentWorkflow(adapters(snapshots, policies, reviews)).assess(
      SUPPORTED_PRODUCT,
      premiumLimit(),
      "destination-ref-test",
    );

    expect(result._tag).toBe("ok");
    if (result._tag === "ok") {
      expect(result.value.offers[0]).toMatchObject({
        evidence: {
          merchant: "Headphone Zone",
          scope: { kind: "product", value: "Sennheiser HD 560S" },
          retrievedVia: "senso",
          retrievalState: "current",
        },
        evidenceReview: { state: "reviewed", reused: true },
      });
    }
  });

  it("blocks a changed fingerprint pending human review and creates an Undo Record", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => snapshotFor(offer));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));
    const reviews = snapshots.map(
      (snapshot, index): EvidenceReview => ({
        fingerprint:
          snapshot.offerId === "headphone-zone" ? "sha256:headphone-zone-old" : snapshot.fingerprint,
        approvedAt: "2026-08-01T12:00:00.000Z",
        policy: policies[index]!,
      }),
    );

    const result = await new AssessmentWorkflow(adapters(snapshots, policies, reviews)).assess(
      SUPPORTED_PRODUCT,
      premiumLimit(),
      "destination-ref-test",
    );

    expect(result).toMatchObject({
      _tag: "err",
      error: {
        reason: "blocked_by_policy",
        message: "Policy Evidence changed and requires human review",
        record: { outcome: "blocked_by_policy", evidence: snapshots },
      },
    });
    if (result._tag === "err" && result.error._tag === "NoEligibleOffer") {
      expect(result.error.reviewCandidates?.map((candidate) => candidate.snapshot.offerId)).toEqual([
        "headphone-zone",
      ]);
    }
  });

  it("blocks Stale Evidence older than 24 hours and creates an Undo Record", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => ({
      ...snapshotFor(offer),
      collectedAt: "2026-08-01T08:59:59.999Z",
    }));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));
    const reviews = snapshots.map(
      (snapshot, index): EvidenceReview => ({
        fingerprint: snapshot.fingerprint,
        approvedAt: "2026-08-01T12:00:00.000Z",
        policy: policies[index]!,
      }),
    );

    const result = await new AssessmentWorkflow(adapters(snapshots, policies, reviews)).assess(
      SUPPORTED_PRODUCT,
      premiumLimit(),
      "destination-ref-test",
    );

    expect(result).toMatchObject({
      _tag: "err",
      error: {
        reason: "blocked_by_policy",
        message: "Stale Evidence must be refreshed before purchase",
        record: { outcome: "blocked_by_policy" },
      },
    });
    if (result._tag === "err" && result.error._tag === "NoEligibleOffer") {
      expect(result.error.record?.evidence.every((snapshot) => snapshot.retrievalState === "stale")).toBe(true);
    }
  });

  it("uses a fresh complete Reviewed Evidence cache during a Senso outage", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => snapshotFor(offer));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));
    const reviews = snapshots.map(
      (snapshot, index): EvidenceReview => ({
        fingerprint: snapshot.fingerprint,
        approvedAt: "2026-08-01T12:00:00.000Z",
        policy: policies[index]!,
      }),
    );
    const cache = { snapshots, reviews };

    const result = await new AssessmentWorkflow(
      adapters(snapshots, policies, reviews, { failSenso: true, cache }),
    ).assess(SUPPORTED_PRODUCT, premiumLimit(), "destination-ref-test");

    expect(result._tag).toBe("ok");
    if (result._tag === "ok") {
      expect(result.value.offers.every((offer) => offer.evidence.retrievalState === "cached")).toBe(
        true,
      );
      expect(result.value.offers.every((offer) => offer.evidenceReview.state === "reviewed")).toBe(
        true,
      );
    }
  });

  it("blocks unavailable evidence and creates an Undo Record when no valid cache exists", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => snapshotFor(offer));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));

    const result = await new AssessmentWorkflow(
      adapters(snapshots, policies, [], { failSenso: true }),
    ).assess(SUPPORTED_PRODUCT, premiumLimit(), "destination-ref-test");

    expect(result).toMatchObject({
      _tag: "err",
      error: {
        message: "Policy check unavailable: Senso retrieval failed and no valid cache exists",
        reason: "blocked_by_policy",
        record: { outcome: "blocked_by_policy", evidence: [] },
      },
    });
  });

  it("blocks incomplete live evidence and creates an Undo Record", async () => {
    const snapshots = SUPPORTED_OFFERS.slice(0, 2).map((offer) => snapshotFor(offer));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));

    const result = await new AssessmentWorkflow(adapters(snapshots, policies, [])).assess(
      SUPPORTED_PRODUCT,
      premiumLimit(),
      "destination-ref-test",
    );

    expect(result).toMatchObject({
      _tag: "err",
      error: {
        message: "Policy Evidence is incomplete for one or more Offers",
        reason: "blocked_by_policy",
        record: { outcome: "blocked_by_policy", evidence: snapshots },
      },
    });
  });

  it("lets a human approve extracted facts for one exact fingerprint", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => snapshotFor(offer));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));
    const reviews = snapshots.slice(1).map(
      (snapshot, index): EvidenceReview => ({
        fingerprint: snapshot.fingerprint,
        approvedAt: "2026-08-01T12:00:00.000Z",
        policy: policies[index + 1]!,
      }),
    );
    const workflow = new AssessmentWorkflow(adapters(snapshots, policies, reviews));

    await workflow.approveEvidence(snapshots[0]!, policies[0]!);
    const result = await workflow.assess(
      SUPPORTED_PRODUCT,
      premiumLimit(),
      "destination-ref-test",
    );

    expect(result._tag).toBe("ok");
    if (result._tag === "ok") {
      expect(result.value.offers[0]?.evidenceReview).toEqual({ state: "reviewed", reused: true });
    }
  });

  it("refuses human approval when the supporting quote is not exact snapshot text", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => snapshotFor(offer));
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));
    const workflow = new AssessmentWorkflow(adapters(snapshots, policies, []));

    await expect(
      workflow.approveEvidence(snapshots[0]!, {
        ...policies[0]!,
        citations: policies[0]!.citations.map((citation, index) =>
          index === 0
            ? { ...citation, quote: "A claim that the official wording does not support." }
            : citation,
        ),
      }),
    ).rejects.toThrow("Every extracted policy fact needs an exact quote");
  });

  it("blocks evidence whose merchant provenance does not match its Offer", async () => {
    const snapshots = SUPPORTED_OFFERS.map((offer) => snapshotFor(offer));
    const mismatched = snapshots.map((snapshot) =>
      snapshot.offerId === "headphone-zone"
        ? { ...snapshot, merchant: "Different Merchant" }
        : snapshot,
    );
    const policies = SUPPORTED_OFFERS.map((offer) => policyFor(offer.id));

    const result = await new AssessmentWorkflow(adapters(mismatched, policies, [])).assess(
      SUPPORTED_PRODUCT,
      premiumLimit(),
      "destination-ref-test",
    );

    expect(result).toMatchObject({
      _tag: "err",
      error: {
        message: "Policy Evidence is incomplete for one or more Offers",
        reason: "blocked_by_policy",
      },
    });
  });
});
