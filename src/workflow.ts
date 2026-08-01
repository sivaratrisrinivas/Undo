import type {
  AssessedOffer,
  CheckoutQuote,
  EvidenceSnapshot,
  EvidenceReview,
  Offer,
  PolicyAssessment,
  PremiumLimitInr,
  Product,
  ReversibilityAssessment,
  ReviewedEvidenceCache,
  UndoRecord,
} from "./domain";
import { OFFICIAL_EVIDENCE_SOURCES, POLICY_FACTS, SUPPORTED_OFFERS } from "./domain";

/** External capabilities required to perform a Reversibility Assessment. */
export type AssessmentAdapters = {
  readonly policyContract: { purchaseEnabled(): boolean };
  readonly senso: {
    retrieveEvidence(product: Product): Promise<AdapterResult<ReadonlyArray<EvidenceSnapshot>>>;
  };
  readonly openAi: {
    modelVersion(): string;
    extractPolicies(
      evidence: ReadonlyArray<EvidenceSnapshot>,
    ): Promise<AdapterResult<ReadonlyArray<PolicyAssessment>>>;
  };
  readonly prava: {
    quoteOffers(
      offers: ReadonlyArray<Offer>,
      destinationReference: string,
    ): Promise<AdapterResult<ReadonlyArray<CheckoutQuote>>>;
    submitCheckout(offer: Offer, maximumTotalInr: number): Promise<AdapterResult<never>>;
  };
  readonly evidence: {
    findReview(fingerprint: string): Promise<EvidenceReview | undefined>;
    saveReview(review: EvidenceReview): Promise<void>;
    loadCache(product: Product): Promise<ReviewedEvidenceCache | undefined>;
    saveCache(cache: ReviewedEvidenceCache): Promise<void>;
  };
  readonly now: () => string;
  readonly nextRecordId: () => string;
};

/** Typed failure returned by an external adapter instead of rejecting. */
export type AdapterFailure = {
  readonly _tag: "DependencyUnavailable";
  readonly dependency: "senso" | "openai" | "prava";
  readonly cause: unknown;
};

/** Result contract used at each external adapter seam. */
export type AdapterResult<T> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: AdapterFailure };

/** Typed expected failures callers must render before authorization. */
export type AssessmentFailure =
  | {
      readonly _tag: "AssessmentUnavailable";
      readonly message: "Policy check unavailable";
      readonly cause: unknown;
    }
  | {
      readonly _tag: "NoEligibleOffer";
      readonly message: string;
      readonly reason: "purchase_unavailable" | "blocked_by_policy" | "blocked_by_price";
      readonly record?: UndoRecord;
      readonly reviewCandidates?: ReadonlyArray<{
        readonly snapshot: EvidenceSnapshot;
        readonly policy: PolicyAssessment;
      }>;
    };

type AssessmentResult =
  | { readonly _tag: "ok"; readonly value: ReversibilityAssessment }
  | { readonly _tag: "err"; readonly error: AssessmentFailure };

function isPolicyEligible(policy: PolicyAssessment): boolean {
  return (
    policy.changeOfMind !== "none" &&
    policy.changeOfMind !== "unclear" &&
    policy.remedyWindow.kind === "known" &&
    policy.productCondition !== "unclear" &&
    policy.returnTransport !== "unclear" &&
    policy.reversalCost.kind !== "unclear" &&
    policy.reversalCost.kind !== "unpriced_required"
  );
}

function reversalCostOrder(policy: PolicyAssessment): number {
  if (policy.reversalCost.kind === "explicit_none") {
    return 0;
  }
  if (policy.reversalCost.kind === "known") {
    return policy.reversalCost.amountInr;
  }
  return Number.MAX_SAFE_INTEGER;
}

function compareEligibleOffers(
  left: { readonly policy: PolicyAssessment; readonly checkoutQuote: CheckoutQuote },
  right: { readonly policy: PolicyAssessment; readonly checkoutQuote: CheckoutQuote },
): number {
  const trialDifference =
    Number(right.policy.productCondition === "trial_allowed") -
    Number(left.policy.productCondition === "trial_allowed");
  if (trialDifference !== 0) return trialDifference;

  const remedyOrder = { money_back: 2, store_credit: 1, none: 0, unclear: 0 } as const;
  const remedyDifference =
    remedyOrder[right.policy.changeOfMind] - remedyOrder[left.policy.changeOfMind];
  if (remedyDifference !== 0) return remedyDifference;

  const leftWindowDays = left.policy.remedyWindow.kind === "known" ? left.policy.remedyWindow.days : 0;
  const rightWindowDays = right.policy.remedyWindow.kind === "known" ? right.policy.remedyWindow.days : 0;
  const windowDifference = rightWindowDays - leftWindowDays;
  if (windowDifference !== 0) return windowDifference;

  const transportOrder = { doorstep_pickup: 2, self_ship: 1, unclear: 0 } as const;
  const transportDifference =
    transportOrder[right.policy.returnTransport] - transportOrder[left.policy.returnTransport];
  if (transportDifference !== 0) return transportDifference;

  const costDifference = reversalCostOrder(left.policy) - reversalCostOrder(right.policy);
  if (costDifference !== 0) return costDifference;

  return left.checkoutQuote.totalInr - right.checkoutQuote.totalInr;
}

/** Coordinates the high-level assessment while keeping external behavior injectable. */
export class AssessmentWorkflow {
  constructor(private readonly adapters: AssessmentAdapters) {}

  /** Saves a human approval for the extracted facts tied to one exact fingerprint. */
  async approveEvidence(
    snapshot: EvidenceSnapshot,
    policy: PolicyAssessment,
  ): Promise<EvidenceReview> {
    if (snapshot.offerId !== policy.offerId) {
      throw new Error("Evidence and extracted policy must belong to the same Offer");
    }
    if (!this.hasCompleteCitations(snapshot, policy)) {
      throw new Error("Every extracted policy fact needs an exact quote from its Evidence Snapshot");
    }
    const review: EvidenceReview = {
      fingerprint: snapshot.fingerprint,
      approvedAt: this.adapters.now(),
      policy,
    };
    await this.adapters.evidence.saveReview(review);
    return review;
  }

  /** Builds the deterministic comparison from evidence, extraction, and quote adapters. */
  async assess(
    product: Product,
    premiumLimitInr: PremiumLimitInr,
    destinationReference: string,
  ): Promise<AssessmentResult> {
    const [evidenceResult, quotesResult] = await Promise.all([
      this.adapters.senso.retrieveEvidence(product),
      this.adapters.prava.quoteOffers(SUPPORTED_OFFERS, destinationReference),
    ]);
    if (quotesResult._tag === "err") {
      return {
        _tag: "err",
        error: {
          _tag: "AssessmentUnavailable",
          message: "Policy check unavailable",
          cause: quotesResult.error,
        },
      };
    }
    const quotes = quotesResult.value;
    let evidence: ReadonlyArray<EvidenceSnapshot>;
    let policies: ReadonlyArray<PolicyAssessment>;
    let reviews: Map<string, EvidenceReview | undefined>;
    let usingCache = evidenceResult._tag === "err";

    if (evidenceResult._tag === "err") {
      const cache = await this.adapters.evidence.loadCache(product);
      if (cache === undefined) {
        return this.policyBlock(
          product,
          premiumLimitInr,
          destinationReference,
          [],
          "Policy check unavailable: Senso retrieval failed and no valid cache exists",
        );
      }
      evidence = cache.snapshots.map((snapshot) => ({
        ...snapshot,
        retrievalState: "cached" as const,
      }));
      policies = cache.reviews.map((review) => review.policy);
      reviews = new Map(cache.reviews.map((review) => [review.fingerprint, review]));
    } else {
      evidence = evidenceResult.value;
      if (!this.hasCompleteEvidence(evidence)) {
        return this.policyBlock(
          product,
          premiumLimitInr,
          destinationReference,
          evidence,
          "Policy Evidence is incomplete for one or more Offers",
        );
      }
      const policiesResult = await this.adapters.openAi.extractPolicies(evidence);
      if (policiesResult._tag === "err") {
        const cache = await this.adapters.evidence.loadCache(product);
        const cacheMatchesCurrentEvidence =
          cache !== undefined &&
          this.hasCompleteEvidence(cache.snapshots) &&
          evidence.every((snapshot) =>
            cache.snapshots.some(
              (cached) =>
                cached.offerId === snapshot.offerId &&
                cached.fingerprint === snapshot.fingerprint &&
                cached.exactText === snapshot.exactText,
            ),
          ) &&
          cache.reviews.every((review) =>
            evidence.some(
              (snapshot) =>
                snapshot.fingerprint === review.fingerprint &&
                this.isApplicableReview(snapshot, review),
            ),
          ) &&
          cache.reviews.length === evidence.length;
        if (!cacheMatchesCurrentEvidence || cache === undefined) {
          return this.policyBlock(
            product,
            premiumLimitInr,
            destinationReference,
            evidence,
            "Policy check unavailable: OpenAI extraction failed and no valid Reviewed Evidence cache exists",
          );
        }
        policies = cache.reviews.map((review) => review.policy);
        reviews = new Map(cache.reviews.map((review) => [review.fingerprint, review]));
        usingCache = true;
      } else {
        policies = policiesResult.value;
        reviews = new Map(
          await Promise.all(
            evidence.map(async (snapshot) => [
              snapshot.fingerprint,
              await this.adapters.evidence.findReview(snapshot.fingerprint),
            ] as const),
          ),
        );
      }
    }

    if (!this.hasCompleteEvidence(evidence)) {
      return this.policyBlock(
        product,
        premiumLimitInr,
        destinationReference,
        evidence,
        "Policy Evidence is incomplete for one or more Offers",
      );
    }
    const unreviewed = evidence.some(
      (snapshot) => !this.isApplicableReview(snapshot, reviews.get(snapshot.fingerprint)),
    );
    if (unreviewed) {
      return this.policyBlock(
        product,
        premiumLimitInr,
        destinationReference,
        evidence,
        "Policy Evidence changed and requires human review",
        usingCache
            ? undefined
            : evidence.flatMap((snapshot) => {
                if (this.isApplicableReview(snapshot, reviews.get(snapshot.fingerprint))) return [];
                const policy = policies.find((candidate) => candidate.offerId === snapshot.offerId);
              return policy === undefined ? [] : [{ snapshot, policy }];
            }),
      );
    }

    const now = Date.parse(this.adapters.now());
    const hasStaleEvidence = evidence.some(
      (snapshot) => now - Date.parse(snapshot.collectedAt) > 24 * 60 * 60 * 1_000,
    );
    if (hasStaleEvidence) {
      const staleEvidence = evidence.map((snapshot) =>
        now - Date.parse(snapshot.collectedAt) > 24 * 60 * 60 * 1_000
          ? { ...snapshot, retrievalState: "stale" as const }
          : snapshot,
      );
      return this.policyBlock(
        product,
        premiumLimitInr,
        destinationReference,
        staleEvidence,
        "Stale Evidence must be refreshed before purchase",
      );
    }

    const reviewedPolicies = evidence.flatMap((snapshot) => {
      const review = reviews.get(snapshot.fingerprint);
      return review === undefined ? [] : [review.policy];
    });
    if (reviewedPolicies.length !== evidence.length) {
      return this.policyBlock(
        product,
        premiumLimitInr,
        destinationReference,
        evidence,
        "Policy Evidence changed and requires human review",
      );
    }
    policies = reviewedPolicies;
    if (!usingCache) {
      const completeReviews = evidence.flatMap((snapshot) => {
        const review = reviews.get(snapshot.fingerprint);
        return review === undefined ? [] : [review];
      });
      await this.adapters.evidence.saveCache({
        snapshots: evidence,
        reviews: completeReviews,
      });
    }

    const availableTotals = quotes
      .filter((quote) => quote.purchaseAvailable)
      .map((quote) => quote.totalInr);
    const baselineTotal = Math.min(...availableTotals);
    if (!Number.isFinite(baselineTotal)) {
      return {
        _tag: "err",
        error: {
          _tag: "NoEligibleOffer",
          message: "No Purchase Available Offer found",
          reason: "purchase_unavailable",
        },
      };
    }

    const unrankedOffers = SUPPORTED_OFFERS.map((offer) => {
      const policy = policies.find((candidate) => candidate.offerId === offer.id);
      const snapshot = evidence.find((candidate) => candidate.offerId === offer.id);
      const checkoutQuote = quotes.find((candidate) => candidate.offerId === offer.id);
      if (policy === undefined || snapshot === undefined || checkoutQuote === undefined) {
        throw new Error(`Fake adapter fixture is incomplete for ${offer.id}`);
      }

      const withinPremiumLimit = checkoutQuote.totalInr <= baselineTotal + premiumLimitInr;
      const eligible =
        checkoutQuote.purchaseAvailable && isPolicyEligible(policy) && withinPremiumLimit;
      const explanation = !checkoutQuote.purchaseAvailable
        ? "Purchase Unavailable"
        : !isPolicyEligible(policy)
          ? policy.changeOfMind === "none"
            ? "Not reversible: defect remedy only"
            : "Blocked by incomplete policy evidence"
          : !withinPremiumLimit
            ? "Outside the Premium Limit"
            : "Eligible Reversible Offer";
      return {
        offer,
        policy,
        evidence: snapshot,
        evidenceReview: {
          state: reviews.get(snapshot.fingerprint) === undefined ? "unreviewed" : "reviewed",
          reused: reviews.get(snapshot.fingerprint) !== undefined,
        },
        checkoutQuote,
        rank: null,
        eligible,
        explanation,
      } as const;
    });

    const rankedOffers = unrankedOffers.filter((offer) => offer.eligible).sort(compareEligibleOffers);
    const firstRankedOffer = rankedOffers[0];
    if (firstRankedOffer === undefined) {
      const hasReversibleOffer = unrankedOffers.some((offer) => isPolicyEligible(offer.policy));
      return {
        _tag: "err",
        error: {
          _tag: "NoEligibleOffer",
          message: hasReversibleOffer
            ? "No reversible Offer is within this Premium Limit"
            : "No reversible purchase found",
          reason: hasReversibleOffer ? "blocked_by_price" : "blocked_by_policy",
        },
      };
    }

    const tiedOfferIds = rankedOffers
      .filter((offer) => compareEligibleOffers(firstRankedOffer, offer) === 0)
      .map((offer) => offer.offer.id);
    const rankByOfferId = new Map<Offer["id"], number>();
    let currentRank = 1;
    for (const [index, offer] of rankedOffers.entries()) {
      const previousOffer = rankedOffers[index - 1];
      if (previousOffer !== undefined && compareEligibleOffers(previousOffer, offer) !== 0) {
        currentRank = index + 1;
      }
      rankByOfferId.set(offer.offer.id, currentRank);
    }
    const assessedOffers = unrankedOffers.map((offer) => ({
      ...offer,
      rank: rankByOfferId.get(offer.offer.id) ?? null,
      explanation:
        tiedOfferIds.length > 1
          ? tiedOfferIds.includes(offer.offer.id)
            ? "Tied after every Remedy Ranking rule"
            : offer.explanation
          : offer.offer.id === firstRankedOffer.offer.id
          ? "Recommended by the Remedy Ranking"
          : offer.explanation,
    }));
    const topOffers = assessedOffers.filter((offer) => tiedOfferIds.includes(offer.offer.id));
    const firstTopOffer = topOffers[0];
    if (firstTopOffer === undefined) {
      throw new Error("Ranked Offer disappeared while constructing the assessment");
    }
    const ranking =
      topOffers.length > 1
        ? ({ _tag: "tied", offers: topOffers } as const)
        : ({ _tag: "winner", offer: firstTopOffer } as const);

    return {
      _tag: "ok",
      value: {
        product,
        offers: assessedOffers,
        ranking,
        premiumLimitInr,
        destinationReference,
      },
    };
  }

  /** Records a buyer decision without submitting checkout. */
  decline(assessment: ReversibilityAssessment, selectedOffer: AssessedOffer): UndoRecord {
    return {
      id: this.adapters.nextRecordId(),
      createdAt: this.adapters.now(),
      outcome: "buyer_declined",
      product: assessment.product,
      selectedMerchant: selectedOffer.offer.merchant,
      selectedSeller: selectedOffer.offer.seller,
      confirmedCheckoutTotalInr: selectedOffer.checkoutQuote.totalInr,
      premiumLimitInr: assessment.premiumLimitInr,
      destinationReference: assessment.destinationReference,
      evidence: assessment.offers.map((offer) => offer.evidence),
      recommendation: {
        rankedOfferIds:
          assessment.ranking._tag === "winner"
            ? [assessment.ranking.offer.offer.id]
            : assessment.ranking.offers.map((offer) => offer.offer.id),
        selectedOfferId: selectedOffer.offer.id,
        selection:
          assessment.ranking._tag === "winner" ? "ranking_winner" : "buyer_selected_tie",
        rankingRules: "remedy-ranking/1.0",
      },
      authorizationState: "not_requested",
      assumptions: [
        "All three curated Offers identify the same new Sennheiser HD 560S Product.",
        "Fixture evidence and quotes are deterministic demo substitutes, not live merchant data.",
        "No checkout was submitted because the buyer declined.",
      ],
      versions: {
        policySchema: "policy-schema/1.0",
        extractionPrompt: "policy-extraction/1.0",
        model: this.adapters.openAi.modelVersion(),
        rankingRules: "remedy-ranking/1.0",
      },
    };
  }

  private hasCompleteEvidence(evidence: ReadonlyArray<EvidenceSnapshot>): boolean {
    return SUPPORTED_OFFERS.every((offer) => {
      const snapshots = evidence.filter((snapshot) => snapshot.offerId === offer.id);
      const snapshot = snapshots[0];
      return (
        snapshots.length === 1 &&
        snapshot !== undefined &&
        OFFICIAL_EVIDENCE_SOURCES.some(
          (source) =>
            source.offerId === offer.id &&
            source.merchant === snapshot.merchant &&
            source.sourceUrl === snapshot.sourceUrl &&
            source.scope.kind === snapshot.scope.kind &&
            source.scope.value === snapshot.scope.value,
        ) &&
        snapshot.exactText.trim() !== "" &&
        snapshot.fingerprint.trim() !== "" &&
        Number.isFinite(Date.parse(snapshot.collectedAt)) &&
        snapshot.retrievedVia === "senso"
      );
    });
  }

  private isApplicableReview(
    snapshot: EvidenceSnapshot,
    review: EvidenceReview | undefined,
  ): review is EvidenceReview {
    return (
      review !== undefined &&
      review.policy.offerId === snapshot.offerId &&
      this.hasCompleteCitations(snapshot, review.policy)
    );
  }

  private hasCompleteCitations(
    snapshot: EvidenceSnapshot,
    policy: PolicyAssessment,
  ): boolean {
    const hasRequiredCitations = POLICY_FACTS.every((fact) => {
      const citations = policy.citations.filter((citation) => citation.fact === fact);
      const citation = citations[0];
      return (
        citations.length === 1 &&
        citation !== undefined &&
        citation.sourceUrl === snapshot.sourceUrl &&
        citation.quote.trim() !== "" &&
        snapshot.exactText.includes(citation.quote)
      );
    });
    const hasExactCitation = (citation: { readonly quote: string; readonly sourceUrl: string }) =>
      citation.sourceUrl === snapshot.sourceUrl &&
      citation.quote.trim() !== "" &&
      snapshot.exactText.includes(citation.quote);
    const remedyCitation = policy.citations.find((citation) => citation.fact === "remedy");
    const hasValidWindow =
      policy.remedyWindow.kind === "unclear" || policy.remedyWindow.days > 0;
    return (
      hasRequiredCitations &&
      remedyCitation !== undefined &&
      policy.quote === remedyCitation.quote &&
      hasValidWindow &&
      policy.materialConditions.every((condition) => hasExactCitation(condition.citation)) &&
      policy.supplementaryRemedies.every((remedy) => hasExactCitation(remedy.citation))
    );
  }

  private policyBlock(
    product: Product,
    premiumLimitInr: PremiumLimitInr,
    destinationReference: string,
    evidence: ReadonlyArray<EvidenceSnapshot>,
    message: string,
    reviewCandidates?: ReadonlyArray<{
      readonly snapshot: EvidenceSnapshot;
      readonly policy: PolicyAssessment;
    }>,
  ): AssessmentResult {
    return {
      _tag: "err",
      error: {
        _tag: "NoEligibleOffer",
        message,
        reason: "blocked_by_policy",
        record: this.blockedRecord(
          product,
          premiumLimitInr,
          destinationReference,
          evidence,
          message,
        ),
        ...(reviewCandidates === undefined ? {} : { reviewCandidates }),
      },
    };
  }

  private blockedRecord(
    product: Product,
    premiumLimitInr: PremiumLimitInr,
    destinationReference: string,
    evidence: ReadonlyArray<EvidenceSnapshot>,
    blockingReason: string,
  ): UndoRecord {
    return {
      id: this.adapters.nextRecordId(),
      createdAt: this.adapters.now(),
      outcome: "blocked_by_policy",
      product,
      selectedMerchant: null,
      selectedSeller: null,
      confirmedCheckoutTotalInr: null,
      premiumLimitInr,
      destinationReference,
      evidence,
      recommendation: {
        rankedOfferIds: [],
        selectedOfferId: null,
        selection: "none",
        rankingRules: "remedy-ranking/1.0",
      },
      authorizationState: "not_requested",
      blockingReason,
      assumptions: [
        "All three curated Offers identify the same new Sennheiser HD 560S Product.",
        "No Purchase Authorization was created because Policy Evidence was blocked.",
      ],
      versions: {
        policySchema: "policy-schema/1.0",
        extractionPrompt: "policy-extraction/1.0",
        model: this.adapters.openAi.modelVersion(),
        rankingRules: "remedy-ranking/1.0",
      },
    };
  }
}
