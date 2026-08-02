import type {
  ApprovalSummary,
  ApprovalSummaryResult,
  AssessedOffer,
  BuyerOfferSelection,
  BuyerOfferSelectionResult,
  BuyerDeclineResult,
  CheckoutSubmissionClaim,
  CheckoutSubmissionClaimResult,
  CheckoutQuote,
  EvidenceSnapshot,
  EvidenceReview,
  MaterialWarning,
  Offer,
  PolicyAssessment,
  PremiumLimitInr,
  Product,
  ProductEquivalence,
  PurchaseAuthorizationResult,
  PurchaseAuthorization,
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
  readonly authorization: PurchaseAuthorizationRepository;
  readonly now: () => string;
  readonly nextAuthorizationId: () => string;
  readonly nextRecordId: () => string;
};

/** Durable state retained for one Purchase Authorization lifecycle. */
export type StoredPurchaseAuthorization = {
  readonly authorizationSnapshot: string;
  readonly assessmentSnapshot: string;
  readonly state: "active" | "invalidated" | "used";
};

/** Atomic persistence boundary for single-use Purchase Authorization transitions. */
export type PurchaseAuthorizationRepository = {
  create(
    id: string,
    value: StoredPurchaseAuthorization,
  ): Promise<"created" | "duplicate" | "unavailable">;
  read(
    id: string,
    authorizationSnapshot: string,
  ): Promise<
    | { readonly _tag: "ok"; readonly value: StoredPurchaseAuthorization }
    | { readonly _tag: "invalid" }
    | { readonly _tag: "unavailable" }
  >;
  transition(
    id: string,
    authorizationSnapshot: string,
    nextState: "invalidated" | "used",
  ): Promise<"updated" | "invalid" | "invalidated" | "unavailable" | "used">;
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
      readonly message: "Policy check unavailable" | "Checkout quote unavailable";
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

type RankingComparison = {
  readonly order: number;
  readonly reason: string;
};

function compareEligibleOffersByRule(
  left: { readonly policy: PolicyAssessment; readonly checkoutQuote: CheckoutQuote },
  right: { readonly policy: PolicyAssessment; readonly checkoutQuote: CheckoutQuote },
): RankingComparison {
  const trialDifference =
    Number(right.policy.productCondition === "trial_allowed") -
    Number(left.policy.productCondition === "trial_allowed");
  if (trialDifference !== 0) {
    return { order: trialDifference, reason: "Trial Permission ranks first" };
  }

  const remedyOrder = { money_back: 2, store_credit: 1, none: 0, unclear: 0 } as const;
  const remedyDifference =
    remedyOrder[right.policy.changeOfMind] - remedyOrder[left.policy.changeOfMind];
  if (remedyDifference !== 0) {
    return { order: remedyDifference, reason: "Money back ranks above store credit" };
  }

  const leftWindowDays = left.policy.remedyWindow.kind === "known" ? left.policy.remedyWindow.days : 0;
  const rightWindowDays = right.policy.remedyWindow.kind === "known" ? right.policy.remedyWindow.days : 0;
  const windowDifference = rightWindowDays - leftWindowDays;
  if (windowDifference !== 0) {
    return { order: windowDifference, reason: "The longer Remedy Window ranks next" };
  }

  const transportOrder = { doorstep_pickup: 2, self_ship: 1, unclear: 0 } as const;
  const transportDifference =
    transportOrder[right.policy.returnTransport] - transportOrder[left.policy.returnTransport];
  if (transportDifference !== 0) {
    return { order: transportDifference, reason: "Doorstep pickup ranks above self-shipping" };
  }

  const costDifference = reversalCostOrder(left.policy) - reversalCostOrder(right.policy);
  if (costDifference !== 0) {
    return { order: costDifference, reason: "The lower evidenced Reversal Cost ranks next" };
  }

  const totalDifference = left.checkoutQuote.totalInr - right.checkoutQuote.totalInr;
  return {
    order: totalDifference,
    reason:
      totalDifference === 0
        ? "Equal after every Remedy Ranking rule"
        : "The lower Confirmed Checkout Total is the final ranking rule",
  };
}

function compareEligibleOffers(
  left: { readonly policy: PolicyAssessment; readonly checkoutQuote: CheckoutQuote },
  right: { readonly policy: PolicyAssessment; readonly checkoutQuote: CheckoutQuote },
): number {
  return compareEligibleOffersByRule(left, right).order;
}

function hasFreshEvidence(snapshot: EvidenceSnapshot, now: number): boolean {
  const ageInMilliseconds = now - Date.parse(snapshot.collectedAt);
  return (
    snapshot.retrievalState !== "stale" &&
    ageInMilliseconds >= 0 &&
    ageInMilliseconds <= 24 * 60 * 60 * 1_000
  );
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
  return `destination-ref-${stableFingerprint(trimmed)}`;
}

function stableFingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assessmentFingerprint(assessment: ReversibilityAssessment): string {
  return `assessment:${stableFingerprint(JSON.stringify(assessment))}`;
}

function missingQuoteFor(offer: Offer): CheckoutQuote {
  return {
    offerId: offer.id,
    merchant: offer.merchant,
    seller: offer.seller,
    destinationReference: "destination-ref-unknown",
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
          message: "Checkout quote unavailable",
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
    const reviewCandidates = usingCache
      ? []
      : evidence.flatMap((snapshot) => {
          if (this.isApplicableReview(snapshot, reviews.get(snapshot.fingerprint))) return [];
          const policy = policies.find((candidate) => candidate.offerId === snapshot.offerId);
          return policy === undefined ? [] : [{ snapshot, policy }];
        });
    if (reviewCandidates.length > 0) {
      return this.policyBlock(
        product,
        premiumLimitInr,
        safeDestinationReference,
        evidence,
        "Policy Evidence changed and requires human review",
        reviewCandidates,
      );
    }
    const now = Date.parse(this.adapters.now());
    evidence = evidence.map((snapshot) =>
      hasFreshEvidence(snapshot, now)
        ? snapshot
        : { ...snapshot, retrievalState: "stale" as const },
    );
    if (evidence.every((snapshot) => snapshot.retrievalState === "stale")) {
      return this.policyBlock(
        product,
        premiumLimitInr,
        safeDestinationReference,
        evidence,
        "Stale Evidence must be refreshed before purchase",
      );
    }
    const applicablePolicies = evidence.flatMap((snapshot) => {
      const review = reviews.get(snapshot.fingerprint);
      if (this.isApplicableReview(snapshot, review)) return [review.policy];
      const extractedPolicy = policies.find((policy) => policy.offerId === snapshot.offerId);
      return extractedPolicy === undefined ? [] : [extractedPolicy];
    });
    if (applicablePolicies.length !== evidence.length) {
      return this.policyBlock(
        product,
        premiumLimitInr,
        safeDestinationReference,
        evidence,
        "Policy Evidence changed and requires human review",
      );
    }
    policies = applicablePolicies;
    if (!usingCache) {
      const completeReviews = evidence.flatMap((snapshot) => {
        const review = reviews.get(snapshot.fingerprint);
        return this.isApplicableReview(snapshot, review) ? [review] : [];
      });
      if (completeReviews.length === evidence.length) {
        await this.adapters.evidence.saveCache({ snapshots: evidence, reviews: completeReviews });
      }
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
      const destinationMatches = checkoutQuote.destinationReference === safeDestinationReference;
      const normalizedQuote =
        checkoutQuote.purchaseAvailable && (!quoteHasValidBreakdown || !destinationMatches)
          ? unavailableQuote(
              checkoutQuote,
              !destinationMatches
                ? "Prava returned a quote for a different Delivery Destination"
                : "Prava returned an inconsistent checkout total",
            )
          : checkoutQuote;
      const evidenceReviewed = this.isApplicableReview(
        snapshot,
        reviews.get(snapshot.fingerprint),
      );
      const evidenceFresh = hasFreshEvidence(snapshot, now);

      return {
        offer,
        productEquivalence,
        offerEquivalent,
        policy,
        evidence: snapshot,
        evidenceReview: {
          state: evidenceReviewed ? "reviewed" : "unreviewed",
          reused: evidenceReviewed,
        },
        checkoutQuote: normalizedQuote,
        premiumOverBaselineInr: null,
        rank: null,
        eligible: false,
        evidenceEligible: evidenceReviewed && evidenceFresh,
        explanation: !offerEquivalent
          ? !productEquivalence.equivalent
            ? `Not equivalent: ${formatProductMismatches(productEquivalence)}`
            : !merchantMatches
              ? `Merchant changed: expected ${offer.merchant}, received ${checkoutQuote.merchant}`
              : `Seller changed: expected ${offer.seller}, received ${checkoutQuote.seller}`
          : !normalizedQuote.purchaseAvailable
            ? normalizedQuote.unavailableReason ?? "Purchase Unavailable"
            : !quoteHasValidBreakdown || !destinationMatches
              ? normalizedQuote.unavailableReason ?? "Purchase Unavailable"
              : !evidenceReviewed
                ? "Blocked: Policy Evidence requires human review"
                : !evidenceFresh
                  ? "Blocked: Stale Evidence must be refreshed"
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
        premiumOverBaselineInr:
          offer.offerEquivalent && offer.checkoutQuote.purchaseAvailable
            ? offer.checkoutQuote.totalInr - baselineTotal
            : null,
        eligible:
          offer.offerEquivalent &&
          offer.checkoutQuote.purchaseAvailable &&
          offer.evidenceEligible &&
          isPolicyEligible(offer.policy) &&
          withinPremiumLimit,
        explanation:
          !offer.offerEquivalent || !offer.checkoutQuote.purchaseAvailable
            ? offer.explanation
            : !offer.evidenceEligible || !isPolicyEligible(offer.policy)
              ? offer.explanation
              : !withinPremiumLimit
                ? "Outside the Premium Limit"
                : offer.explanation,
      };
    });

    const rankedOffers = assessedBeforeRanking.filter((offer) => offer.eligible).sort(compareEligibleOffers);
    const firstRankedOffer = rankedOffers[0];
    if (firstRankedOffer === undefined) {
      const purchaseCandidatesBeforePremium = assessedBeforeRanking.filter(
        (offer) =>
          offer.offerEquivalent &&
          offer.checkoutQuote.purchaseAvailable &&
          offer.evidenceEligible &&
          isPolicyEligible(offer.policy),
      );
      const message = purchaseCandidatesBeforePremium.length > 0
        ? "No reversible Offer is within this Premium Limit"
        : "No reversible purchase found";
      const reason: "blocked_by_price" | "blocked_by_policy" = purchaseCandidatesBeforePremium.length > 0
        ? "blocked_by_price"
        : "blocked_by_policy";
      const rankedOfferIds = purchaseCandidatesBeforePremium.map((offer) => offer.offer.id);
      const pendingReviewCandidates = usingCache
        ? undefined
        : evidence.flatMap((snapshot) => {
            if (this.isApplicableReview(snapshot, reviews.get(snapshot.fingerprint))) return [];
            const policy = policies.find((candidate) => candidate.offerId === snapshot.offerId);
            return policy === undefined ? [] : [{ snapshot, policy }];
          });
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
          ...(pendingReviewCandidates === undefined || pendingReviewCandidates.length === 0
            ? {}
            : { reviewCandidates: pendingReviewCandidates }),
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
    const assessedOffers: ReadonlyArray<AssessedOffer> = assessedBeforeRanking.map((offer) => ({
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
        ? ({
            _tag: "tied",
            offers: topOffers,
            reason: "Equal after every Remedy Ranking rule",
          } as const)
        : ({
            _tag: "winner",
            offer: firstTopOffer,
            reason:
              rankedOffers[1] === undefined
                ? "The only Offer satisfying every eligibility rule"
                : compareEligibleOffersByRule(firstRankedOffer, rankedOffers[1]).reason,
          } as const);

    return {
      _tag: "ok",
      value: {
        product,
        offers: assessedOffers,
        ranking,
        baselineTotalInr: baselineTotal,
        premiumLimitInr,
        destinationReference: safeDestinationReference,
      },
    };
  }

  /** Selects a winner, Tied Offer, or safe Buyer Override without bypassing eligibility. */
  selectOffer(
    assessment: ReversibilityAssessment,
    offerId: Offer["id"],
  ): BuyerOfferSelectionResult {
    const offer = assessment.offers.find((candidate) => candidate.offer.id === offerId);
    if (offer === undefined) return { _tag: "err", reason: "offer_not_found" };
    if (!offer.eligible) return { _tag: "err", reason: "offer_not_eligible" };

    const selection: BuyerOfferSelection["selection"] =
      assessment.ranking._tag === "winner" && assessment.ranking.offer.offer.id === offerId
        ? "ranking_winner"
        : assessment.ranking._tag === "tied" &&
            assessment.ranking.offers.some((candidate) => candidate.offer.id === offerId)
          ? "buyer_selected_tie"
          : "buyer_override";
    return { _tag: "ok", value: { offer, selection } };
  }

  /** Derives the complete buyer-visible approval facts from a validated Offer selection. */
  createApprovalSummary(
    assessment: ReversibilityAssessment,
    selectedOffer: BuyerOfferSelection,
  ): ApprovalSummaryResult {
    const validatedSelection = this.selectOffer(assessment, selectedOffer.offer.offer.id);
    if (
      validatedSelection._tag === "err" ||
      validatedSelection.value.selection !== selectedOffer.selection
    ) {
      return { _tag: "err", reason: "selection_mismatch" };
    }
    const offer = validatedSelection.value.offer;
    const policy = offer.policy;
    if (
      policy.remedyWindow.kind !== "known" ||
      policy.changeOfMind === "none" ||
      policy.changeOfMind === "unclear" ||
      policy.returnTransport === "unclear" ||
      policy.reversalCost.kind === "unclear" ||
      policy.reversalCost.kind === "unpriced_required" ||
      offer.evidence.retrievalState === "stale"
    ) {
      return { _tag: "err", reason: "summary_incomplete" };
    }

    let hasUnopenedWarning = false;
    const materialWarnings: Array<MaterialWarning> = policy.materialConditions.map(
      (condition, index) => {
        const representsUnopenedRestriction =
          policy.productCondition === "unopened_only" &&
          !hasUnopenedWarning &&
          /\b(unopened|sealed)\b/i.test(condition.detail);
        if (representsUnopenedRestriction) hasUnopenedWarning = true;
        return {
          id: representsUnopenedRestriction ? "unopened-only" : `remedy-condition:${index + 1}`,
          kind: representsUnopenedRestriction ? "unopened_only" : "remedy_condition",
          detail: condition.detail,
        };
      },
    );
    if (policy.productCondition === "unopened_only" && !hasUnopenedWarning) {
      materialWarnings.push({
        id: "unopened-only",
        kind: "unopened_only",
        detail: "The Product must remain unopened to keep the remedy.",
      });
    }
    if (policy.reversalCost.kind === "unstated") {
      materialWarnings.push({
        id: "unstated-cost",
        kind: "unstated_cost",
        detail: "No fee stated—cost uncertain.",
      });
    }

    const summary: ApprovalSummary = {
      product: assessment.product,
      quantity: 1,
      offerId: offer.offer.id,
      merchant: offer.offer.merchant,
      seller: offer.offer.seller,
      destinationReference: assessment.destinationReference,
      confirmedCheckoutTotalInr: offer.checkoutQuote.totalInr,
      maximumTotalInr: offer.checkoutQuote.totalInr,
      premiumLimitInr: assessment.premiumLimitInr,
      remedy: policy.changeOfMind,
      trialPermission: policy.productCondition === "trial_allowed",
      remedyWindow: policy.remedyWindow,
      returnTransport: policy.returnTransport,
      buyerPaidCosts: policy.reversalCost,
      evidence: {
        collectedAt: offer.evidence.collectedAt,
        retrievalState: offer.evidence.retrievalState,
      },
      materialConditions: policy.materialConditions.map((condition) => condition.detail),
      materialWarnings,
    };
    if (!this.hasCompleteApprovalSummary(summary)) {
      return { _tag: "err", reason: "summary_incomplete" };
    }
    return { _tag: "ok", value: summary };
  }

  /** Converts explicit per-warning approval into a Purchase Authorization. */
  async authorizePurchase(
    assessment: ReversibilityAssessment,
    selectedOffer: BuyerOfferSelection,
    acknowledgedWarningIds: ReadonlySet<string>,
  ): Promise<PurchaseAuthorizationResult> {
    if (!this.adapters.policyContract.purchaseEnabled()) {
      return { _tag: "err", reason: "purchase_blocked" };
    }
    const summaryResult = this.createApprovalSummary(assessment, selectedOffer);
    if (summaryResult._tag === "err") return summaryResult;
    const missingWarningIds = summaryResult.value.materialWarnings
      .filter((warning) => !acknowledgedWarningIds.has(warning.id))
      .map((warning) => warning.id);
    if (missingWarningIds.length > 0) {
      return {
        _tag: "err",
        reason: "missing_warning_acknowledgements",
        missingWarningIds,
      };
    }
    const issuedAt = this.adapters.now();
    const issuedAtMilliseconds = Date.parse(issuedAt);
    if (!Number.isFinite(issuedAtMilliseconds)) {
      throw new Error("The injected clock returned an invalid timestamp");
    }
    const authorization: PurchaseAuthorization = {
      id: this.adapters.nextAuthorizationId(),
      state: "active",
      issuedAt,
      expiresAt: new Date(issuedAtMilliseconds + 10 * 60 * 1_000).toISOString(),
      binding: {
        product: summaryResult.value.product,
        quantity: summaryResult.value.quantity,
        offerId: summaryResult.value.offerId,
        merchant: summaryResult.value.merchant,
        seller: summaryResult.value.seller,
        destinationReference: summaryResult.value.destinationReference,
        maximumTotalInr: summaryResult.value.maximumTotalInr,
        premiumLimitInr: summaryResult.value.premiumLimitInr,
        assessmentFingerprint: assessmentFingerprint(assessment),
      },
      paymentMethod: "prava_one_time_prepaid",
      acknowledgedWarningIds: summaryResult.value.materialWarnings.map((warning) => warning.id),
    };
    const created = await this.adapters.authorization.create(authorization.id, {
      authorizationSnapshot: JSON.stringify(authorization),
      assessmentSnapshot: JSON.stringify(assessment),
      state: "active",
    });
    if (created === "duplicate") {
      return { _tag: "err", reason: "authorization_id_conflict" };
    }
    if (created === "unavailable") {
      return { _tag: "err", reason: "authorization_unavailable" };
    }
    return { _tag: "ok", value: authorization };
  }

  /** Atomically claims the authorization before a caller submits one checkout attempt. */
  async claimCheckoutSubmission(
    claim: CheckoutSubmissionClaim,
  ): Promise<CheckoutSubmissionClaimResult> {
    const authorizationSnapshot = JSON.stringify(claim.authorization);
    const stored = await this.adapters.authorization.read(
      claim.authorization.id,
      authorizationSnapshot,
    );
    if (stored._tag === "unavailable") {
      return { _tag: "err", reason: "authorization_unavailable" };
    }
    if (stored._tag === "invalid") {
      return { _tag: "err", reason: "authorization_invalid" };
    }
    if (stored.value.state === "used") {
      return { _tag: "err", reason: "authorization_used" };
    }
    if (stored.value.state === "invalidated") {
      return { _tag: "err", reason: "authorization_invalid" };
    }
    const invalidate = async (
      reason: Extract<CheckoutSubmissionClaimResult, { readonly _tag: "err" }>["reason"],
    ): Promise<CheckoutSubmissionClaimResult> => {
      const transitioned = await this.adapters.authorization.transition(
        claim.authorization.id,
        authorizationSnapshot,
        "invalidated",
      );
      if (transitioned === "unavailable") {
        return { _tag: "err", reason: "authorization_unavailable" };
      }
      if (transitioned === "used") return { _tag: "err", reason: "authorization_used" };
      if (transitioned !== "updated") return { _tag: "err", reason: "authorization_invalid" };
      return { _tag: "err", reason };
    };
    const now = Date.parse(this.adapters.now());
    if (!Number.isFinite(now)) {
      throw new Error("The injected clock returned an invalid timestamp");
    }
    if (now >= Date.parse(claim.authorization.expiresAt)) {
      return await invalidate("authorization_expired");
    }
    if (claim.paymentMethod !== claim.authorization.paymentMethod) {
      return await invalidate("unsupported_payment_method");
    }
    if (claim.quantity !== claim.authorization.binding.quantity) {
      return await invalidate("quantity_changed");
    }
    if (!compareProductIdentity(claim.authorization.binding.product, claim.assessment.product).equivalent) {
      return await invalidate("product_changed");
    }
    if (claim.selectedOffer.offer.offer.merchant !== claim.authorization.binding.merchant) {
      return await invalidate("merchant_changed");
    }
    if (claim.selectedOffer.offer.offer.seller !== claim.authorization.binding.seller) {
      return await invalidate("seller_changed");
    }
    if (claim.assessment.destinationReference !== claim.authorization.binding.destinationReference) {
      return await invalidate("destination_changed");
    }
    const selectedOfferResult = this.selectOffer(
      claim.assessment,
      claim.selectedOffer.offer.offer.id,
    );
    if (
      selectedOfferResult._tag === "err" ||
      selectedOfferResult.value.selection !== claim.selectedOffer.selection ||
      claim.selectedOffer.offer.offer.id !== claim.authorization.binding.offerId ||
      stored.value.assessmentSnapshot !== JSON.stringify(claim.assessment) ||
      claim.assessment.premiumLimitInr !== claim.authorization.binding.premiumLimitInr
    ) {
      return await invalidate("approval_changed");
    }
    if (
      claim.quote.offerId !== claim.authorization.binding.offerId ||
      !compareProductIdentity(claim.authorization.binding.product, claim.quote.product).equivalent
    ) {
      return await invalidate("product_changed");
    }
    if (claim.quote.merchant !== claim.authorization.binding.merchant) {
      return await invalidate("merchant_changed");
    }
    if (claim.quote.seller !== claim.authorization.binding.seller) {
      return await invalidate("seller_changed");
    }
    if (claim.quote.destinationReference !== claim.authorization.binding.destinationReference) {
      return await invalidate("destination_changed");
    }
    if (!claim.quote.purchaseAvailable || !hasValidQuoteBreakdown(claim.quote)) {
      return await invalidate("quote_invalid");
    }
    if (claim.quote.totalInr > claim.authorization.binding.maximumTotalInr) {
      return await invalidate("total_exceeded");
    }

    const transitioned = await this.adapters.authorization.transition(
      claim.authorization.id,
      authorizationSnapshot,
      "used",
    );
    if (transitioned === "unavailable") {
      return { _tag: "err", reason: "authorization_unavailable" };
    }
    if (transitioned === "used") return { _tag: "err", reason: "authorization_used" };
    if (transitioned !== "updated") return { _tag: "err", reason: "authorization_invalid" };
    return {
      _tag: "ok",
      value: {
        authorization: {
          ...claim.authorization,
          state: "used",
          usedAt: this.adapters.now(),
        },
        quote: claim.quote,
        paymentMethod: claim.authorization.paymentMethod,
      },
    };
  }

  /** Records a buyer decision without submitting checkout. */
  async decline(
    assessment: ReversibilityAssessment,
    selectedOffer: BuyerOfferSelection,
    authorization?: PurchaseAuthorization,
  ): Promise<BuyerDeclineResult> {
    const validatedSelection = this.selectOffer(assessment, selectedOffer.offer.offer.id);
    if (
      validatedSelection._tag === "err" ||
      validatedSelection.value.selection !== selectedOffer.selection ||
      JSON.stringify(validatedSelection.value.offer) !== JSON.stringify(selectedOffer.offer)
    ) {
      return { _tag: "err", reason: "selection_mismatch" };
    }
    const selected = validatedSelection.value;
    let authorizationState: UndoRecord["authorizationState"] = "not_requested";
    if (authorization !== undefined) {
      if (
        authorization.binding.assessmentFingerprint !== assessmentFingerprint(assessment) ||
        authorization.binding.offerId !== selected.offer.offer.id ||
        authorization.binding.merchant !== selected.offer.offer.merchant ||
        authorization.binding.seller !== selected.offer.offer.seller ||
        authorization.binding.destinationReference !== assessment.destinationReference
      ) {
        return { _tag: "err", reason: "authorization_invalid" };
      }
      const authorizationSnapshot = JSON.stringify(authorization);
      const stored = await this.adapters.authorization.read(
        authorization.id,
        authorizationSnapshot,
      );
      if (stored._tag === "unavailable") {
        return { _tag: "err", reason: "authorization_unavailable" };
      }
      if (
        stored._tag === "invalid" ||
        stored.value.state !== "active" ||
        stored.value.assessmentSnapshot !== JSON.stringify(assessment)
      ) {
        return { _tag: "err", reason: "authorization_invalid" };
      }
      const transitioned = await this.adapters.authorization.transition(
        authorization.id,
        authorizationSnapshot,
        "invalidated",
      );
      if (transitioned === "unavailable") {
        return { _tag: "err", reason: "authorization_unavailable" };
      }
      if (transitioned !== "updated") {
        return { _tag: "err", reason: "authorization_invalid" };
      }
      authorizationState = "authorized_not_submitted";
    }
    return { _tag: "ok", value: {
      id: this.adapters.nextRecordId(),
      createdAt: this.adapters.now(),
      outcome: "buyer_declined",
      product: assessment.product,
      selectedMerchant: selected.offer.offer.merchant,
      selectedSeller: selected.offer.offer.seller,
      confirmedCheckoutTotalInr: selected.offer.checkoutQuote.totalInr,
      premiumLimitInr: assessment.premiumLimitInr,
      destinationReference: assessment.destinationReference,
      evidence: assessment.offers.map((offer) => offer.evidence),
      recommendation: {
        rankedOfferIds:
          assessment.ranking._tag === "winner"
            ? [assessment.ranking.offer.offer.id]
            : assessment.ranking.offers.map((offer) => offer.offer.id),
        selectedOfferId: selected.offer.offer.id,
        selection: selected.selection,
        rankingRules: "remedy-ranking/1.0",
      },
      authorizationState,
      assumptions: [
        "Each curated Offer was checked against the supported Product identity before any Purchase Authorization.",
        "Checkout totals were supplied by the configured Prava boundary for the selected destination.",
        "No checkout was submitted because the buyer declined.",
      ],
      versions: {
        policySchema: "policy-schema/1.0",
        extractionPrompt: "policy-extraction/1.0",
        model: this.adapters.openAi.modelVersion(),
        rankingRules: "remedy-ranking/1.0",
      },
    } };
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

  private hasCompleteApprovalSummary(summary: ApprovalSummary): boolean {
    return (
      Object.values(summary.product).every((value) => value.trim() !== "") &&
      summary.merchant.trim() !== "" &&
      summary.seller.trim() !== "" &&
      summary.destinationReference.trim() !== "" &&
      Number.isFinite(summary.confirmedCheckoutTotalInr) &&
      summary.confirmedCheckoutTotalInr >= 0 &&
      Number.isFinite(summary.premiumLimitInr) &&
      summary.premiumLimitInr >= 0 &&
      Number.isFinite(Date.parse(summary.evidence.collectedAt)) &&
      summary.remedyWindow.days > 0 &&
      Number.isSafeInteger(summary.remedyWindow.days) &&
      summary.materialConditions.every((condition) => condition.trim() !== "") &&
      summary.materialWarnings.every(
        (warning) => warning.id.trim() !== "" && warning.detail.trim() !== "",
      ) &&
      new Set(summary.materialWarnings.map((warning) => warning.id)).size ===
        summary.materialWarnings.length
    );
  }

  private isApplicableReview(
    snapshot: EvidenceSnapshot,
    review: EvidenceReview | undefined,
  ): review is EvidenceReview {
    return (
      review !== undefined &&
      review.fingerprint === snapshot.fingerprint &&
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
