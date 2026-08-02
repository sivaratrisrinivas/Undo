import type {
  AssessedOffer,
  CheckoutQuote,
  EvidenceSnapshot,
  EvidenceReview,
  Offer,
  PolicyAssessment,
  PremiumLimitInr,
  Product,
  ProductEquivalence,
  ReversibilityAssessment,
  ReviewedEvidenceCache,
  UndoRecord,
} from "./domain";
import {
  compareProductIdentity,
  OFFICIAL_EVIDENCE_SOURCES,
  POLICY_FACTS,
  SUPPORTED_OFFERS,
} from "./domain";

/** External capabilities required to perform a Reversibility Assessment. */
export type AssessmentAdapters = {
  readonly policyContract: { purchaseEnabled(): boolean };
  readonly evidenceApplicability: {
    appliesToProduct(product: Product, snapshot: EvidenceSnapshot): boolean;
  };
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

function sumDiscounts(discounts: ReadonlyArray<{ readonly amountInr: number }>): number {
  return discounts.reduce((total, discount) => total + discount.amountInr, 0);
}

function hasValidQuoteBreakdown(quote: CheckoutQuote): boolean {
  const values = [
    quote.itemTotalInr,
    quote.deliveryInr,
    quote.taxesInr,
    quote.cashbackInr,
    quote.rewardPoints,
    quote.totalInr,
    ...quote.appliedDiscounts.map((discount) => discount.amountInr),
    ...quote.advertisedDiscounts.map((discount) => discount.amountInr),
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return false;
  const expectedTotal =
    quote.itemTotalInr +
    quote.deliveryInr +
    quote.taxesInr -
    sumDiscounts(quote.appliedDiscounts);
  return expectedTotal === quote.totalInr;
}

function opaqueDestinationReference(input: string): string {
  const trimmed = input.trim();
  if (/destination-ref-[a-z0-9-]+$/i.test(trimmed)) return trimmed;
  let hash = 2_166_136_261;
  for (const character of trimmed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `destination-ref-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function missingQuoteFor(offer: Offer): CheckoutQuote {
  return {
    offerId: offer.id,
    merchant: offer.merchant,
    seller: offer.seller,
    product: {
      manufacturer: "",
      model: "",
      variant: "",
      condition: "",
      bundleContents: "",
      warrantyRegion: "",
    },
    itemTotalInr: 0,
    deliveryInr: 0,
    taxesInr: 0,
    appliedDiscounts: [],
    advertisedDiscounts: [],
    cashbackInr: 0,
    rewardPoints: 0,
    totalInr: 0,
    purchaseAvailable: false,
    unavailableReason: "Prava returned no quote for this Offer",
  };
}

function unavailableQuote(quote: CheckoutQuote, reason: string): CheckoutQuote {
  return quote.purchaseAvailable
    ? { ...quote, purchaseAvailable: false, unavailableReason: reason }
    : quote;
}

function formatProductMismatches(equivalence: ProductEquivalence): string {
  return equivalence.mismatches
    .map(
      (mismatch) =>
        `${mismatch.field}: expected ${mismatch.expected}, received ${mismatch.actual ?? "unknown"}`,
    )
    .join("; ");
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
    const safeDestinationReference = opaqueDestinationReference(destinationReference);
    const [evidenceResult, quotesResult] = await Promise.all([
      this.adapters.senso.retrieveEvidence(product),
      this.adapters.prava.quoteOffers(SUPPORTED_OFFERS, safeDestinationReference),
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
          safeDestinationReference,
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
      if (!this.hasCompleteEvidence(product, evidence)) {
        return this.policyBlock(
          product,
          premiumLimitInr,
          safeDestinationReference,
          evidence,
          "Policy Evidence is incomplete for one or more Offers",
        );
      }
      const policiesResult = await this.adapters.openAi.extractPolicies(evidence);
      if (policiesResult._tag === "err") {
        const cache = await this.adapters.evidence.loadCache(product);
        const cacheMatchesCurrentEvidence =
          cache !== undefined &&
          this.hasCompleteEvidence(product, cache.snapshots) &&
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
            safeDestinationReference,
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

    if (!this.hasCompleteEvidence(product, evidence)) {
      return this.policyBlock(
        product,
        premiumLimitInr,
        safeDestinationReference,
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
        safeDestinationReference,
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
        safeDestinationReference,
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
        safeDestinationReference,
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

    const unrankedOffers = SUPPORTED_OFFERS.map((offer) => {
      const policy = policies.find((candidate) => candidate.offerId === offer.id);
      const snapshot = evidence.find((candidate) => candidate.offerId === offer.id);
      const returnedQuote = quotes.find((candidate) => candidate.offerId === offer.id);
      if (policy === undefined || snapshot === undefined) {
        throw new Error(`Adapter result is incomplete for ${offer.id}`);
      }

      const checkoutQuote = returnedQuote ?? missingQuoteFor(offer);
      const productEquivalence = compareProductIdentity(product, checkoutQuote.product);
      const merchantMatches = checkoutQuote.merchant === offer.merchant;
      const sellerMatches = checkoutQuote.seller === offer.seller;
      const offerEquivalent = productEquivalence.equivalent && merchantMatches && sellerMatches;
      const quoteHasValidBreakdown = hasValidQuoteBreakdown(checkoutQuote);
      const normalizedQuote =
        checkoutQuote.purchaseAvailable && !quoteHasValidBreakdown
          ? unavailableQuote(checkoutQuote, "Prava returned an inconsistent checkout total")
          : checkoutQuote;

      return {
        offer,
        productEquivalence,
        offerEquivalent,
        policy,
        evidence: snapshot,
        evidenceReview: {
          state: reviews.get(snapshot.fingerprint) === undefined ? "unreviewed" : "reviewed",
          reused: reviews.get(snapshot.fingerprint) !== undefined,
        },
        checkoutQuote: normalizedQuote,
        rank: null,
        eligible: false,
        explanation: !offerEquivalent
          ? !productEquivalence.equivalent
            ? `Not equivalent: ${formatProductMismatches(productEquivalence)}`
            : !merchantMatches
              ? `Merchant changed: expected ${offer.merchant}, received ${checkoutQuote.merchant}`
              : `Seller changed: expected ${offer.seller}, received ${checkoutQuote.seller}`
          : !normalizedQuote.purchaseAvailable
            ? normalizedQuote.unavailableReason ?? "Purchase Unavailable"
            : !quoteHasValidBreakdown
              ? "Purchase Unavailable: Prava returned an inconsistent checkout total"
              : !isPolicyEligible(policy)
                ? policy.changeOfMind === "none"
                  ? "Not reversible: defect remedy only"
                  : "Blocked by incomplete policy evidence"
                : "Eligible Reversible Offer",
      } as const;
    });

    const baselineTotal = Math.min(
      ...unrankedOffers
        .filter((offer) => offer.offerEquivalent && offer.checkoutQuote.purchaseAvailable)
        .map((offer) => offer.checkoutQuote.totalInr),
    );
    if (!Number.isFinite(baselineTotal)) {
      const message = "No Purchase Available Equivalent Offer found";
      return {
        _tag: "err",
        error: {
          _tag: "NoEligibleOffer",
          message,
          reason: "purchase_unavailable",
          record: this.blockedRecord(
            product,
            premiumLimitInr,
            safeDestinationReference,
            evidence,
            message,
            "purchase_unavailable",
          ),
        },
      };
    }

    const assessedBeforeRanking = unrankedOffers.map((offer) => {
      const withinPremiumLimit = offer.checkoutQuote.totalInr <= baselineTotal + premiumLimitInr;
      return {
        ...offer,
        eligible:
          offer.offerEquivalent &&
          offer.checkoutQuote.purchaseAvailable &&
          isPolicyEligible(offer.policy) &&
          withinPremiumLimit,
        explanation:
          !offer.offerEquivalent || !offer.checkoutQuote.purchaseAvailable
            ? offer.explanation
            : !isPolicyEligible(offer.policy)
              ? offer.explanation
              : !withinPremiumLimit
                ? "Outside the Premium Limit"
                : offer.explanation,
      };
    });

    const rankedOffers = assessedBeforeRanking.filter((offer) => offer.eligible).sort(compareEligibleOffers);
    const firstRankedOffer = rankedOffers[0];
    if (firstRankedOffer === undefined) {
      const hasReversibleOffer = assessedBeforeRanking.some(
        (offer) => offer.offerEquivalent && offer.checkoutQuote.purchaseAvailable && isPolicyEligible(offer.policy),
      );
      const message = hasReversibleOffer
        ? "No reversible Offer is within this Premium Limit"
        : "No reversible purchase found";
      const reason: "blocked_by_price" | "blocked_by_policy" = hasReversibleOffer
        ? "blocked_by_price"
        : "blocked_by_policy";
      const rankedOfferIds = assessedBeforeRanking
        .filter((offer) => offer.offerEquivalent && offer.checkoutQuote.purchaseAvailable && isPolicyEligible(offer.policy))
        .map((offer) => offer.offer.id);
      return {
        _tag: "err",
        error: {
          _tag: "NoEligibleOffer",
          message,
          reason,
          record: this.blockedRecord(
            product,
            premiumLimitInr,
            safeDestinationReference,
            evidence,
            message,
            reason,
            rankedOfferIds,
          ),
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
    const assessedOffers = assessedBeforeRanking.map((offer) => ({
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
        destinationReference: safeDestinationReference,
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
        "Each curated Offer was checked against the supported Product identity before any Purchase Authorization.",
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

  private hasCompleteEvidence(product: Product, evidence: ReadonlyArray<EvidenceSnapshot>): boolean {
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
        this.adapters.evidenceApplicability.appliesToProduct(product, snapshot) &&
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
      const allowsMultipleCitations =
        fact === "remedy" ||
        (fact === "window" && policy.remedyWindow.kind === "unclear") ||
        (fact === "product_condition" && policy.productCondition === "unclear") ||
        (fact === "return_transport" && policy.returnTransport === "unclear") ||
        (fact === "buyer_paid_fees" && policy.reversalCost.kind === "unclear");
      return (
        (allowsMultipleCitations ? citations.length > 0 : citations.length === 1) &&
        citations.every((citation) =>
          citation.sourceUrl === snapshot.sourceUrl &&
          citation.quote.trim() !== "" &&
          snapshot.exactText.includes(citation.quote),
        )
      );
    });
    const hasExactCitation = (citation: { readonly quote: string; readonly sourceUrl: string }) =>
      citation.sourceUrl === snapshot.sourceUrl &&
      citation.quote.trim() !== "" &&
      snapshot.exactText.includes(citation.quote);
    const hasPrimaryRemedyCitation = policy.citations.some(
      (citation) => citation.fact === "remedy" && citation.quote === policy.quote,
    );
    const hasValidWindow =
      policy.remedyWindow.kind === "unclear" || policy.remedyWindow.days > 0;
    return (
      hasRequiredCitations &&
      policy.citations.every((citation) =>
        POLICY_FACTS.includes(citation.fact) && hasExactCitation(citation),
      ) &&
      hasPrimaryRemedyCitation &&
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
    outcome: Exclude<UndoRecord["outcome"], "buyer_declined"> = "blocked_by_policy",
    rankedOfferIds: ReadonlyArray<Offer["id"]> = [],
  ): UndoRecord {
    return {
      id: this.adapters.nextRecordId(),
      createdAt: this.adapters.now(),
      outcome,
      product,
      selectedMerchant: null,
      selectedSeller: null,
      confirmedCheckoutTotalInr: null,
      premiumLimitInr,
      destinationReference,
      evidence,
      recommendation: {
        rankedOfferIds,
        selectedOfferId: null,
        selection: "none",
        rankingRules: "remedy-ranking/1.0",
      },
      authorizationState: "not_requested",
      blockingReason,
      assumptions: [
        "Any Offer must pass the supported Product identity check before Purchase Authorization.",
        outcome === "purchase_unavailable"
          ? "No Purchase Authorization was created because no Equivalent Offer was Purchase Available."
          : outcome === "blocked_by_price"
            ? "No Purchase Authorization was created because every eligible Equivalent Offer exceeded the Premium Limit."
            : "No Purchase Authorization was created because Policy Evidence was blocked.",
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
