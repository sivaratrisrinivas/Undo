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
  PreviousSandboxPurchase,
  Product,
  ProductEquivalence,
  PravaCheckoutRequest,
  PravaCheckoutResult,
  PurchaseCheckoutResult,
  PurchaseAuthorizationResult,
  PurchaseAuthorization,
  ReversibilityAssessment,
  ReviewedEvidenceCache,
  UndoRecord,
} from "./domain";
import {
  compareProductIdentity,
  POLICY_FACTS,
  SUPPORTED_OFFERS,
} from "./domain";
import type { PipelineLogger } from "./pipeline-logging";

/** External capabilities required to perform a Reversibility Assessment. */
export type AssessmentAdapters = {
  readonly policyContract: { purchaseEnabled(): boolean };
  readonly evidenceApplicability: {
    appliesToProduct(product: Product, snapshot: EvidenceSnapshot): boolean;
  };
  readonly senso: {
    retrieveEvidence(
      product: Product,
      traceId?: string,
    ): Promise<AdapterResult<ReadonlyArray<EvidenceSnapshot>>>;
  };
  readonly openAi: {
    modelVersion(): string;
    extractPolicies(
      evidence: ReadonlyArray<EvidenceSnapshot>,
      traceId?: string,
    ): Promise<AdapterResult<ReadonlyArray<PolicyAssessment>>>;
  };
  readonly prava: {
    quoteOffers(
      offers: ReadonlyArray<Offer>,
      destinationReference: string,
      traceId?: string,
    ): Promise<AdapterResult<ReadonlyArray<CheckoutQuote>>>;
    registerCheckout(
      request: PravaCheckoutRequest,
      traceId?: string,
    ): Promise<"registered" | "unavailable">;
    submitCheckout(request: PravaCheckoutRequest, traceId?: string): Promise<PravaCheckoutResult>;
  };
  readonly evidence: {
    findReview(fingerprint: string): Promise<EvidenceReview | undefined>;
    saveReview(review: EvidenceReview): Promise<void>;
    loadCache(product: Product): Promise<ReviewedEvidenceCache | undefined>;
    saveCache(cache: ReviewedEvidenceCache): Promise<void>;
  };
  readonly authorization: PurchaseAuthorizationRepository;
  readonly records: UndoRecordRepository;
  readonly now: () => string;
  readonly nextAuthorizationId: () => string;
  readonly nextRecordId: () => string;
  readonly pipeline?: {
    readonly nextTraceId: () => string;
    readonly logger: (traceId: string) => PipelineLogger;
  };
};

/** Persistence boundary for auditable Undo Records and historical sandbox fallback. */
export type UndoRecordRepository = {
  save(record: UndoRecord): Promise<"saved" | "unavailable">;
  find(id: string): Promise<UndoRecord | undefined>;
  latestCompletedPurchase(): Promise<PreviousSandboxPurchase | undefined>;
};

/** Durable state retained for one Purchase Authorization lifecycle. */
export type StoredPurchaseAuthorization = {
  readonly authorizationSnapshot: string;
  readonly assessmentSnapshot: string;
  readonly state: "pending_registration" | "active" | "invalidated" | "used";
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
    nextState: "active" | "invalidated" | "used",
  ): Promise<
    | "updated"
    | "invalid"
    | "pending_registration"
    | "active"
    | "invalidated"
    | "unavailable"
    | "used"
  >;
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

type EvidenceResolution =
  | { readonly _tag: "ok"; readonly evidence: ReadonlyArray<EvidenceSnapshot> }
  | {
      readonly _tag: "incomplete";
      readonly reason: "unsupported_offer" | "missing_or_invalid_snapshot" | "not_applicable" | "selection_failed";
      readonly offerId: Offer["id"] | null;
    }
  | { readonly _tag: "conflict"; readonly offer: Offer };

type PreparedEvidenceCache = {
  readonly snapshots: ReadonlyArray<EvidenceSnapshot>;
  readonly reviews: ReadonlyArray<EvidenceReview>;
};

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

function policyBlockingExplanation(policy: PolicyAssessment): string {
  if (policy.changeOfMind === "none") {
    return "Not reversible: defect remedy only";
  }
  const reasons = [
    policy.changeOfMind === "unclear" ||
    policy.remedyWindow.kind === "unclear" ||
    policy.productCondition === "unclear" ||
    policy.returnTransport === "unclear" ||
    policy.reversalCost.kind === "unclear"
      ? "Policy Unclear"
      : undefined,
    policy.reversalCost.kind === "unpriced_required" ? "Unpriced Required Cost" : undefined,
  ].flatMap((reason) => reason === undefined ? [] : [reason]);
  return reasons.length === 0 ? "Blocked: Policy Unclear" : `Blocked: ${reasons.join("; ")}`;
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
  if (
    trimmed === "destination-ref-prava-default" ||
    /^destination-ref-[0-9a-f]{8}$/.test(trimmed)
  ) {
    return trimmed;
  }
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
  private readonly traceIds = new WeakMap<object, string>();

  constructor(private readonly adapters: AssessmentAdapters) {}

  /** Saves a human approval for the extracted facts tied to one exact fingerprint. */
  async approveEvidence(
    snapshot: EvidenceSnapshot,
    policy: PolicyAssessment,
  ): Promise<EvidenceReview> {
    const traceId = this.traceIds.get(snapshot) ?? this.adapters.pipeline?.nextTraceId();
    const logger = traceId === undefined ? undefined : this.adapters.pipeline?.logger(traceId);
    logger?.log("evidence.review_approval", "started", { offerId: snapshot.offerId });
    if (snapshot.offerId !== policy.offerId) {
      logger?.log("evidence.review_approval", "failed", { reason: "offer_mismatch" });
      throw new Error("Evidence and extracted policy must belong to the same Offer");
    }
    if (!this.hasCompleteCitations(snapshot, policy)) {
      logger?.log("evidence.review_approval", "failed", { reason: "citation_validation_failed" });
      throw new Error("Every extracted policy fact needs an exact quote from its Evidence Snapshot");
    }
    const review: EvidenceReview = {
      fingerprint: snapshot.fingerprint,
      approvedAt: this.adapters.now(),
      policy,
    };
    try {
      await this.adapters.evidence.saveReview(review);
    } catch (cause: unknown) {
      logger?.log("evidence.review_approval", "failed", {
        reason: cause instanceof Error ? "repository_error" : "unknown_error",
      });
      throw cause;
    }
    logger?.log("evidence.review_approval", "succeeded", { offerId: snapshot.offerId });
    return review;
  }

  /** Persists an assessment-blocking Undo Record under the originating pipeline trace. */
  async saveBlockedRecord(record: UndoRecord): Promise<"saved" | "unavailable"> {
    const traceId = this.traceIds.get(record) ?? this.adapters.pipeline?.nextTraceId();
    const logger = traceId === undefined ? undefined : this.adapters.pipeline?.logger(traceId);
    logger?.log("undo_record.blocked", "started", { outcome: record.outcome });
    const result = await this.adapters.records.save(record);
    logger?.log(
      "undo_record.blocked",
      result === "saved" ? "succeeded" : "failed",
      result === "saved" ? { outcome: record.outcome } : { reason: "repository_unavailable" },
    );
    return result;
  }

  /** Builds the deterministic comparison from evidence, extraction, and quote adapters. */
  async assess(
    product: Product,
    premiumLimitInr: PremiumLimitInr,
    destinationReference: string,
    existingTraceId?: string,
  ): Promise<AssessmentResult> {
    const traceId = existingTraceId ?? this.adapters.pipeline?.nextTraceId();
    const logger = traceId === undefined ? undefined : this.adapters.pipeline?.logger(traceId);
    const safeDestinationReference = opaqueDestinationReference(destinationReference);
    logger?.log("assessment", "started", {
      productModel: product.model,
      offerCount: SUPPORTED_OFFERS.length,
      premiumLimitInr,
      destination: safeDestinationReference === "destination-ref-prava-default" ? "default" : "opaque_custom",
    });
    logger?.log("senso.evidence", "started", { offerCount: SUPPORTED_OFFERS.length });
    logger?.log("prava.quotes", "started", { offerCount: SUPPORTED_OFFERS.length });
    const [evidenceResult, quotesResult] = await Promise.all([
      this.adapters.senso.retrieveEvidence(product, traceId),
      this.adapters.prava.quoteOffers(SUPPORTED_OFFERS, safeDestinationReference, traceId),
    ]);
    logger?.log(
      "senso.evidence",
      evidenceResult._tag === "ok" ? "succeeded" : "failed",
      evidenceResult._tag === "ok"
        ? { snapshotCount: evidenceResult.value.length }
        : { dependency: evidenceResult.error.dependency },
    );
    logger?.log(
      "prava.quotes",
      quotesResult._tag === "ok" ? "succeeded" : "failed",
      quotesResult._tag === "ok"
        ? {
            quoteCount: quotesResult.value.length,
            purchaseAvailableCount: quotesResult.value.filter((quote) => quote.purchaseAvailable).length,
          }
        : { dependency: quotesResult.error.dependency },
    );
    if (quotesResult._tag === "err") {
      logger?.log("assessment", "blocked", { reason: "checkout_quote_unavailable" });
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
      logger?.log("evidence.cache", "started", { reason: "senso_unavailable" });
      const cache = await this.adapters.evidence.loadCache(product);
      const preparedCache = cache === undefined ? undefined : this.prepareEvidenceCache(product, cache);
      if (preparedCache === undefined) {
        logger?.log("evidence.cache", "failed", { reason: "no_valid_cache" });
        logger?.log("assessment", "blocked", { reason: "senso_unavailable_without_cache" });
        return this.policyBlock(
          product,
          premiumLimitInr,
          safeDestinationReference,
          [],
          "Policy check unavailable: Senso retrieval failed and no valid cache exists",
          undefined,
          traceId,
        );
      }
      evidence = preparedCache.snapshots.map((snapshot) => ({
        ...snapshot,
        retrievalState: "cached" as const,
      }));
      policies = preparedCache.reviews.map((review) => review.policy);
      reviews = new Map(preparedCache.reviews.map((review) => [review.fingerprint, review]));
      logger?.log("evidence.cache", "succeeded", { snapshotCount: evidence.length });
    } else {
      const liveEvidence = evidenceResult.value;
      logger?.log("evidence.applicability", "started", { snapshotCount: liveEvidence.length });
      const resolution = this.resolveApplicableEvidence(product, liveEvidence);
      if (resolution._tag === "incomplete") {
        logger?.log("evidence.applicability", "failed", {
          reason: resolution.reason,
          offerId: resolution.offerId,
        });
        logger?.log("assessment", "blocked", { reason: "policy_evidence_incomplete" });
        return this.policyBlock(
          product,
          premiumLimitInr,
          safeDestinationReference,
          liveEvidence,
          "Policy Evidence is incomplete for one or more Offers",
          undefined,
          traceId,
        );
      }
      if (resolution._tag === "conflict") {
        const message = `Policy Unclear: conflicting Policy Evidence for ${resolution.offer.merchant}`;
        logger?.log("evidence.applicability", "failed", {
          reason: "conflicting_snapshots",
          offerId: resolution.offer.id,
        });
        logger?.log("assessment", "blocked", { reason: "policy_evidence_conflict" });
        return this.policyBlock(
          product,
          premiumLimitInr,
          safeDestinationReference,
          liveEvidence,
          message,
          undefined,
          traceId,
        );
      }
      evidence = resolution.evidence;
      logger?.log("evidence.applicability", "succeeded", {
        snapshotCount: evidence.length,
        offers: evidence.map((snapshot) => snapshot.offerId),
      });
      logger?.log("openai.extraction", "started", {
        snapshotCount: evidence.length,
        totalCharacters: evidence.reduce((total, snapshot) => total + snapshot.exactText.length, 0),
      });
      const policiesResult = await this.adapters.openAi.extractPolicies(evidence, traceId);
      if (policiesResult._tag === "err") {
        logger?.log("openai.extraction", "failed", { dependency: policiesResult.error.dependency });
        logger?.log("evidence.cache", "started", { reason: "openai_unavailable" });
        const cache = await this.adapters.evidence.loadCache(product);
        const preparedCache = cache === undefined ? undefined : this.prepareEvidenceCache(product, cache);
        const cacheMatchesCurrentEvidence =
          preparedCache !== undefined &&
          preparedCache.snapshots.length === evidence.length &&
          evidence.every((snapshot) =>
            preparedCache.snapshots.some(
              (cached) =>
                cached.offerId === snapshot.offerId &&
                cached.fingerprint === snapshot.fingerprint &&
                cached.exactText === snapshot.exactText,
            ),
          );
        if (!cacheMatchesCurrentEvidence || preparedCache === undefined) {
          logger?.log("evidence.cache", "failed", { reason: "no_matching_reviewed_cache" });
          logger?.log("assessment", "blocked", { reason: "openai_unavailable_without_cache" });
          return this.policyBlock(
            product,
            premiumLimitInr,
            safeDestinationReference,
            evidence,
            "Policy check unavailable: OpenAI extraction failed and no valid Reviewed Evidence cache exists",
            undefined,
            traceId,
          );
        }
        policies = preparedCache.reviews.map((review) => review.policy);
        reviews = new Map(preparedCache.reviews.map((review) => [review.fingerprint, review]));
        usingCache = true;
        logger?.log("evidence.cache", "succeeded", { snapshotCount: evidence.length });
      } else {
        policies = policiesResult.value;
        logger?.log("openai.extraction", "succeeded", {
          policyCount: policies.length,
          model: this.adapters.openAi.modelVersion(),
        });
        logger?.log("evidence.review_lookup", "started", { fingerprintCount: evidence.length });
        reviews = new Map(
          await Promise.all(
            evidence.map(async (snapshot) => [
              snapshot.fingerprint,
              await this.adapters.evidence.findReview(snapshot.fingerprint),
            ] as const),
          ),
        );
        logger?.log("evidence.review_lookup", "succeeded", {
          reviewedCount: [...reviews.values()].filter((review) => review !== undefined).length,
        });
      }
    }

    const reviewCandidates = usingCache
      ? []
      : evidence.flatMap((snapshot) => {
          if (this.isApplicableReview(snapshot, reviews.get(snapshot.fingerprint))) return [];
          const policy = policies.find((candidate) => candidate.offerId === snapshot.offerId);
          return policy === undefined ? [] : [{ snapshot, policy }];
        });
    if (reviewCandidates.length > 0) {
      logger?.log("evidence.human_review", "blocked", {
        candidateCount: reviewCandidates.length,
        offers: reviewCandidates.map((candidate) => candidate.snapshot.offerId),
      });
      logger?.log("assessment", "blocked", { reason: "human_review_required" });
      return this.policyBlock(
        product,
        premiumLimitInr,
        safeDestinationReference,
        evidence,
        "Policy Evidence changed and requires human review",
        reviewCandidates,
        traceId,
      );
    }
    const now = Date.parse(this.adapters.now());
    logger?.log("evidence.freshness", "started", { snapshotCount: evidence.length });
    evidence = evidence.map((snapshot) =>
      hasFreshEvidence(snapshot, now)
        ? snapshot
        : { ...snapshot, retrievalState: "stale" as const },
    );
    if (evidence.every((snapshot) => snapshot.retrievalState === "stale")) {
      logger?.log("evidence.freshness", "failed", { staleCount: evidence.length });
      logger?.log("assessment", "blocked", { reason: "all_evidence_stale" });
      return this.policyBlock(
        product,
        premiumLimitInr,
        safeDestinationReference,
        evidence,
        "Stale Evidence must be refreshed before purchase",
        undefined,
        traceId,
      );
    }
    logger?.log("evidence.freshness", "succeeded", {
      freshCount: evidence.filter((snapshot) => snapshot.retrievalState !== "stale").length,
      staleCount: evidence.filter((snapshot) => snapshot.retrievalState === "stale").length,
    });
    const applicablePolicies = evidence.flatMap((snapshot) => {
      const review = reviews.get(snapshot.fingerprint);
      if (this.isApplicableReview(snapshot, review)) return [review.policy];
      if (usingCache) return [];
      const extractedPolicy = policies.find((policy) => policy.offerId === snapshot.offerId);
      return extractedPolicy === undefined ? [] : [extractedPolicy];
    });
    if (applicablePolicies.length !== evidence.length) {
      logger?.log("evidence.review_binding", "failed", {
        policyCount: applicablePolicies.length,
        snapshotCount: evidence.length,
      });
      logger?.log("assessment", "blocked", { reason: "review_binding_incomplete" });
      return this.policyBlock(
        product,
        premiumLimitInr,
        safeDestinationReference,
        evidence,
        "Policy Evidence changed and requires human review",
        undefined,
        traceId,
      );
    }
    policies = applicablePolicies;
    if (!usingCache) {
      const completeReviews = evidence.flatMap((snapshot) => {
        const review = reviews.get(snapshot.fingerprint);
        return this.isApplicableReview(snapshot, review) ? [review] : [];
      });
      if (completeReviews.length === evidence.length) {
        logger?.log("evidence.cache_save", "started", { snapshotCount: evidence.length });
        await this.adapters.evidence.saveCache({ snapshots: evidence, reviews: completeReviews });
        logger?.log("evidence.cache_save", "succeeded", { snapshotCount: evidence.length });
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
                ? policyBlockingExplanation(policy)
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
      logger?.log("offer.validation", "succeeded", {
        offers: unrankedOffers.map((offer) =>
          `${offer.offer.id}:equivalent=${String(offer.offerEquivalent)},available=${String(offer.checkoutQuote.purchaseAvailable)}`),
      });
      logger?.log("assessment", "blocked", { reason: "no_purchase_available_equivalent_offer" });
      const record = this.rememberTrace(this.blockedRecord(
        product,
        premiumLimitInr,
        safeDestinationReference,
        evidence,
        message,
        "purchase_unavailable",
      ), traceId);
      return {
        _tag: "err",
        error: {
          _tag: "NoEligibleOffer",
          message,
          reason: "purchase_unavailable",
          record,
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
    logger?.log("offer.validation", "succeeded", {
      offers: assessedBeforeRanking.map((offer) =>
        `${offer.offer.id}:equivalent=${String(offer.offerEquivalent)},available=${String(offer.checkoutQuote.purchaseAvailable)},evidence=${String(offer.evidenceEligible)},policy=${String(isPolicyEligible(offer.policy))},eligible=${String(offer.eligible)}`),
    });
    logger?.log("premium_baseline", "succeeded", { baselineTotalInr: baselineTotal, premiumLimitInr });

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
      const policyReasons = assessedBeforeRanking
        .filter(
          (offer) =>
            offer.offerEquivalent &&
            offer.checkoutQuote.purchaseAvailable &&
            offer.evidenceEligible &&
            !isPolicyEligible(offer.policy),
        )
        .map(
          (offer) =>
            `${offer.offer.merchant}: ${policyBlockingExplanation(offer.policy).replace(/^Blocked: /, "")}`,
        );
      const blockingMessage =
        purchaseCandidatesBeforePremium.length > 0 || policyReasons.length === 0
          ? message
          : `${message}: ${[...new Set(policyReasons)].join("; ")}`;
      const rankedOfferIds = purchaseCandidatesBeforePremium.map((offer) => offer.offer.id);
      const pendingReviewCandidates = usingCache
        ? undefined
        : evidence.flatMap((snapshot) => {
            if (this.isApplicableReview(snapshot, reviews.get(snapshot.fingerprint))) return [];
            const policy = policies.find((candidate) => candidate.offerId === snapshot.offerId);
            return policy === undefined ? [] : [{ snapshot, policy }];
          });
      logger?.log("remedy_ranking", "blocked", {
        reason,
        eligibleCount: 0,
        policyReasons,
      });
      logger?.log("assessment", "blocked", { reason });
      const record = this.rememberTrace(this.blockedRecord(
        product,
        premiumLimitInr,
        safeDestinationReference,
        evidence,
        blockingMessage,
        reason,
        rankedOfferIds,
      ), traceId);
      return {
        _tag: "err",
        error: {
          _tag: "NoEligibleOffer",
          message: blockingMessage,
          reason,
          record,
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

    logger?.log("remedy_ranking", "succeeded", {
      rankedOfferIds: rankedOffers.map((offer) => offer.offer.id),
      result: ranking._tag,
      selectedOfferIds: ranking._tag === "winner"
        ? [ranking.offer.offer.id]
        : ranking.offers.map((offer) => offer.offer.id),
    });

    const assessment: ReversibilityAssessment = {
      product,
      offers: assessedOffers,
      ranking,
      baselineTotalInr: baselineTotal,
      premiumLimitInr,
      destinationReference: safeDestinationReference,
    };
    if (traceId !== undefined) this.traceIds.set(assessment, traceId);
    logger?.log("assessment", "succeeded", {
      assessedOfferCount: assessedOffers.length,
      eligibleOfferCount: assessedOffers.filter((offer) => offer.eligible).length,
    });
    return {
      _tag: "ok",
      value: assessment,
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
    const traceId = this.traceIds.get(assessment) ?? this.adapters.pipeline?.nextTraceId();
    const logger = traceId === undefined ? undefined : this.adapters.pipeline?.logger(traceId);
    logger?.log("purchase_authorization", "started", {
      offerId: selectedOffer.offer.offer.id,
      acknowledgedWarningCount: acknowledgedWarningIds.size,
    });
    if (!this.adapters.policyContract.purchaseEnabled()) {
      logger?.log("purchase_authorization", "blocked", { reason: "policy_contract_closed" });
      return { _tag: "err", reason: "purchase_blocked" };
    }
    const summaryResult = this.createApprovalSummary(assessment, selectedOffer);
    if (summaryResult._tag === "err") {
      logger?.log("purchase_authorization", "blocked", { reason: summaryResult.reason });
      return summaryResult;
    }
    const missingWarningIds = summaryResult.value.materialWarnings
      .filter((warning) => !acknowledgedWarningIds.has(warning.id))
      .map((warning) => warning.id);
    if (missingWarningIds.length > 0) {
      logger?.log("purchase_authorization", "blocked", {
        reason: "missing_warning_acknowledgements",
        missingWarningCount: missingWarningIds.length,
      });
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
      state: "pending_registration",
    });
    if (created === "duplicate") {
      logger?.log("authorization.persistence", "failed", { reason: "identifier_conflict" });
      return { _tag: "err", reason: "authorization_id_conflict" };
    }
    if (created === "unavailable") {
      logger?.log("authorization.persistence", "failed", { reason: "repository_unavailable" });
      return { _tag: "err", reason: "authorization_unavailable" };
    }
    logger?.log("authorization.persistence", "succeeded", { state: "pending_registration" });
    logger?.log("prava.authorization_registration", "started", { offerId: selectedOffer.offer.offer.id });
    const registration = await this.adapters.prava.registerCheckout({
      authorizationId: authorization.id,
      expiresAt: authorization.expiresAt,
      product: authorization.binding.product,
      quantity: authorization.binding.quantity,
      offer: selectedOffer.offer.offer,
      destinationReference: authorization.binding.destinationReference,
      maximumTotalInr: authorization.binding.maximumTotalInr,
      paymentMethod: authorization.paymentMethod,
    }, traceId);
    if (registration === "unavailable") {
      logger?.log("prava.authorization_registration", "failed", { reason: "server_registration_unavailable" });
      logger?.log("purchase_authorization", "blocked", { reason: "authorization_unavailable" });
      return { _tag: "err", reason: "authorization_unavailable" };
    }
    logger?.log("prava.authorization_registration", "succeeded", { offerId: selectedOffer.offer.offer.id });
    const activated = await this.adapters.authorization.transition(
      authorization.id,
      JSON.stringify(authorization),
      "active",
    );
    if (activated !== "updated") {
      logger?.log("authorization.persistence", "failed", { reason: "activation_transition_failed" });
      return { _tag: "err", reason: "authorization_unavailable" };
    }
    logger?.log("authorization.persistence", "succeeded", { state: "active" });
    logger?.log("purchase_authorization", "succeeded", {
      offerId: selectedOffer.offer.offer.id,
      maximumTotalInr: authorization.binding.maximumTotalInr,
    });
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
    if (stored.value.state === "pending_registration") {
      return { _tag: "err", reason: "authorization_invalid" };
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

  /** Consumes one Purchase Authorization, submits once to Prava, and creates the final Undo Record. */
  async checkout(claim: CheckoutSubmissionClaim): Promise<PurchaseCheckoutResult> {
    const traceId = this.traceIds.get(claim.assessment) ?? this.adapters.pipeline?.nextTraceId();
    const logger = traceId === undefined ? undefined : this.adapters.pipeline?.logger(traceId);
    logger?.log("checkout_claim", "started", { offerId: claim.selectedOffer.offer.offer.id });
    const claimed = await this.claimCheckoutSubmission(claim);
    if (claimed._tag === "err") {
      logger?.log("checkout_claim", "blocked", { reason: claimed.reason });
      logger?.log("checkout", "blocked", { reason: claimed.reason });
      return claimed;
    }
    logger?.log("checkout_claim", "succeeded", {
      offerId: claim.selectedOffer.offer.offer.id,
      authorizedMaximumTotalInr: claimed.value.authorization.binding.maximumTotalInr,
    });

    const assessment = claim.assessment;
    const selected = claim.selectedOffer;
    const id = this.adapters.nextRecordId();
    const createdAt = this.adapters.now();
    const previousSandboxPurchase = await this.adapters.records.latestCompletedPurchase();
    const recordBase = {
      id,
      createdAt,
      product: assessment.product,
      selectedMerchant: selected.offer.offer.merchant,
      selectedSeller: selected.offer.offer.seller,
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
        rankingRules: "remedy-ranking/1.0" as const,
      },
      authorizationId: claimed.value.authorization.id,
      approvedMaximumTotalInr: claimed.value.authorization.binding.maximumTotalInr,
      versions: {
        policySchema: "policy-schema/1.0" as const,
        extractionPrompt: "policy-extraction/1.0" as const,
        model: this.adapters.openAi.modelVersion(),
        rankingRules: "remedy-ranking/1.0" as const,
      },
    };
    const pendingRecord: UndoRecord = {
      ...recordBase,
      outcome: "outcome_unknown",
      confirmedCheckoutTotalInr: claimed.value.quote.totalInr,
      authorizationState: "used",
      pravaStatus: "outcome_unknown",
      merchantOrderIdentifier: null,
      ...(previousSandboxPurchase === undefined ? {} : { previousSandboxPurchase }),
      blockingReason: "Checkout handoff began, but no final Prava result has been recorded.",
      assumptions: [
        "The Purchase Authorization was consumed before the checkout handoff.",
        "An order may exist, so Undo must not submit this authorization again.",
      ],
    };
    logger?.log("undo_record.pending", "started", { outcome: pendingRecord.outcome });
    if (await this.adapters.records.save(pendingRecord) === "unavailable") {
      logger?.log("undo_record.pending", "failed", { reason: "repository_unavailable" });
      logger?.log("checkout", "failed", { reason: "pending_record_unavailable" });
      return { _tag: "err", reason: "record_unavailable", record: pendingRecord };
    }
    logger?.log("undo_record.pending", "succeeded", { outcome: pendingRecord.outcome });

    logger?.log("prava.checkout", "started", { offerId: claim.selectedOffer.offer.offer.id });
    const checkoutResult = await this.adapters.prava.submitCheckout({
      authorizationId: claimed.value.authorization.id,
      expiresAt: claimed.value.authorization.expiresAt,
      product: claimed.value.authorization.binding.product,
      quantity: claimed.value.authorization.binding.quantity,
      offer: claim.selectedOffer.offer.offer,
      destinationReference: claimed.value.authorization.binding.destinationReference,
      maximumTotalInr: claimed.value.authorization.binding.maximumTotalInr,
      paymentMethod: claimed.value.paymentMethod,
    }, traceId);
    logger?.log(
      "prava.checkout",
      checkoutResult._tag === "not_submitted"
        ? "blocked"
        : checkoutResult.paymentStatus === "successful" &&
            checkoutResult.merchantOrderIdentifier !== null
          ? "succeeded"
          : "failed",
      checkoutResult._tag === "not_submitted"
        ? { reason: checkoutResult.reason }
        : {
            paymentStatus: checkoutResult.paymentStatus,
            hasMerchantOrderIdentifier: checkoutResult.merchantOrderIdentifier !== null,
          },
    );
    const submittedConfirmedTotalInr = checkoutResult._tag === "submitted"
      ? checkoutResult.confirmedTotalInr
      : null;
    const hasUntrustedSubmittedTotal =
      checkoutResult._tag === "submitted" &&
      submittedConfirmedTotalInr !== null &&
      (!Number.isFinite(submittedConfirmedTotalInr) ||
        submittedConfirmedTotalInr < 0 ||
        submittedConfirmedTotalInr > claimed.value.authorization.binding.maximumTotalInr);
    if (hasUntrustedSubmittedTotal) {
      const safeRecord: UndoRecord = {
        ...pendingRecord,
        blockingReason:
          "Prava returned a submitted checkout total outside the Purchase Authorization; the purchase outcome is unknown, an order may exist, and Undo will not retry.",
      };
      if (await this.adapters.records.save(safeRecord) === "unavailable") {
        logger?.log("undo_record.final", "failed", { reason: "repository_unavailable" });
        logger?.log("checkout", "failed", { reason: "record_unavailable" });
        return { _tag: "err", reason: "record_unavailable", record: safeRecord };
      }
      logger?.log("undo_record.final", "succeeded", { outcome: safeRecord.outcome });
      logger?.log("checkout", "failed", { outcome: safeRecord.outcome });
      return { _tag: "ok", value: safeRecord };
    }
    const notSubmitted = checkoutResult._tag === "not_submitted";
    const outcome: UndoRecord["outcome"] = notSubmitted
      ? checkoutResult.reason
      : checkoutResult.paymentStatus === "successful"
        ? "purchased"
        : checkoutResult.paymentStatus === "failed"
          ? "purchase_unavailable"
          : "outcome_unknown";
    const pravaStatus: UndoRecord["pravaStatus"] = notSubmitted
      ? "not_submitted"
      : checkoutResult.paymentStatus === "successful"
        ? "payment_succeeded"
        : checkoutResult.paymentStatus === "failed"
          ? "confirmed_failure"
          : "outcome_unknown";
    const blockingReason = notSubmitted
      ? checkoutResult.explanation
      : checkoutResult.paymentStatus === "successful"
        ? undefined
        : checkoutResult.failureReason;
    const orderIdentifier = notSubmitted
      ? null
      : checkoutResult.merchantOrderIdentifier;
    const record: UndoRecord = {
        ...recordBase,
        outcome,
        confirmedCheckoutTotalInr: checkoutResult.confirmedTotalInr,
        authorizationState: notSubmitted ? "used_without_submission" : "used",
        pravaStatus,
        merchantOrderIdentifier: orderIdentifier,
        ...(outcome === "purchased" || previousSandboxPurchase === undefined
          ? {}
          : { previousSandboxPurchase }),
        ...(blockingReason === undefined ? {} : { blockingReason }),
        assumptions: [
          "Each curated Offer was checked against the supported Product identity before Purchase Authorization.",
          "Prava received only the exact authorized Product, quantity, merchant, seller, destination reference, payment method, and maximum total.",
          notSubmitted
            ? "The Purchase Authorization was consumed safely before Prava rejected the attempt without submitting checkout."
            : outcome === "outcome_unknown"
            ? "Checkout was submitted once; an order may exist, so Undo did not retry automatically."
            : "The Purchase Authorization was consumed by exactly one Prava checkout attempt.",
        ],
    };
    if (await this.adapters.records.save(record) === "unavailable") {
      logger?.log("undo_record.final", "failed", { reason: "repository_unavailable" });
      logger?.log("checkout", "failed", { reason: "record_unavailable" });
      return { _tag: "err", reason: "record_unavailable", record };
    }
    logger?.log("undo_record.final", "succeeded", { outcome: record.outcome });
    logger?.log(
      "checkout",
      notSubmitted ? "blocked" : record.outcome === "purchased" ? "succeeded" : "failed",
      { outcome: record.outcome },
    );
    return {
      _tag: "ok",
      value: record,
    };
  }

  /** Records a buyer decision without submitting checkout. */
  async decline(
    assessment: ReversibilityAssessment,
    selectedOffer: BuyerOfferSelection,
    authorization?: PurchaseAuthorization,
  ): Promise<BuyerDeclineResult> {
    const traceId = this.traceIds.get(assessment) ?? this.adapters.pipeline?.nextTraceId();
    const logger = traceId === undefined ? undefined : this.adapters.pipeline?.logger(traceId);
    logger?.log("buyer_decline", "started", { offerId: selectedOffer.offer.offer.id });
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
    const record: UndoRecord = {
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
      authorizationId: authorization?.id ?? null,
      authorizationState,
      approvedMaximumTotalInr: authorization?.binding.maximumTotalInr ?? null,
      pravaStatus: "not_submitted",
      merchantOrderIdentifier: null,
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
    };
    if (await this.adapters.records.save(record) === "unavailable") {
      logger?.log("undo_record.final", "failed", { reason: "repository_unavailable" });
      return { _tag: "err", reason: "record_unavailable", record };
    }
    logger?.log("undo_record.final", "succeeded", { outcome: record.outcome });
    logger?.log("buyer_decline", "succeeded", { outcome: record.outcome });
    return { _tag: "ok", value: record };
  }

  private resolveApplicableEvidence(
    product: Product,
    evidence: ReadonlyArray<EvidenceSnapshot>,
  ): EvidenceResolution {
    if (
      evidence.some(
        (snapshot) => !SUPPORTED_OFFERS.some((offer) => offer.id === snapshot.offerId),
      )
    ) {
      return { _tag: "incomplete", reason: "unsupported_offer", offerId: null };
    }

    const controlling: Array<EvidenceSnapshot> = [];
    for (const offer of SUPPORTED_OFFERS) {
      const offerSnapshots = evidence.filter((snapshot) => snapshot.offerId === offer.id);
      if (
        offerSnapshots.length === 0 ||
        offerSnapshots.some((snapshot) => !this.isCompleteSnapshotForOffer(offer, snapshot))
      ) {
        return { _tag: "incomplete", reason: "missing_or_invalid_snapshot", offerId: offer.id };
      }
      const applicable = offerSnapshots.filter((snapshot) =>
        this.adapters.evidenceApplicability.appliesToProduct(product, snapshot),
      );
      if (applicable.length === 0) {
        return { _tag: "incomplete", reason: "not_applicable", offerId: offer.id };
      }
      const highestScope = applicable.some((snapshot) => snapshot.scope.kind === "product")
        ? "product"
        : "category";
      const highestScopeSnapshots = applicable
        .filter((snapshot) => snapshot.scope.kind === highestScope)
        .filter((snapshot, index, snapshots) =>
          snapshots.findIndex((candidate) => this.sameEvidenceIdentity(candidate, snapshot)) === index,
        )
        .map((snapshot) =>
          applicable
            .filter(
              (candidate) =>
                candidate.scope.kind === highestScope && this.sameEvidenceIdentity(candidate, snapshot),
            )
            .reduce(
              (freshest, candidate) => this.preferFreshestEvidence(freshest, candidate),
              snapshot,
            ),
        );
      if (highestScopeSnapshots.length > 1) return { _tag: "conflict", offer };
      const snapshot = highestScopeSnapshots[0];
      if (snapshot === undefined) {
        return { _tag: "incomplete", reason: "selection_failed", offerId: offer.id };
      }
      controlling.push(snapshot);
    }
    return { _tag: "ok", evidence: controlling };
  }

  private prepareEvidenceCache(
    product: Product,
    cache: ReviewedEvidenceCache,
  ): PreparedEvidenceCache | undefined {
    if (cache.snapshots.some((snapshot) => snapshot.retrievalState === "stale")) return undefined;
    const resolution = this.resolveApplicableEvidence(product, cache.snapshots);
    if (resolution._tag !== "ok" || cache.reviews.length !== resolution.evidence.length) {
      return undefined;
    }
    const reviews = resolution.evidence.flatMap((snapshot) => {
      const matches = cache.reviews.filter((review) =>
        review.fingerprint === snapshot.fingerprint && this.isApplicableReview(snapshot, review),
      );
      return matches.length === 1 ? matches : [];
    });
    return reviews.length === resolution.evidence.length
      ? { snapshots: resolution.evidence, reviews }
      : undefined;
  }

  private isCompleteSnapshotForOffer(offer: Offer, snapshot: EvidenceSnapshot): boolean {
    return (
      snapshot.offerId === offer.id &&
      snapshot.merchant === offer.merchant &&
      snapshot.sourceUrl.trim() !== "" &&
      (snapshot.scope.kind === "product" || snapshot.scope.kind === "category") &&
      snapshot.scope.value.trim() !== "" &&
      snapshot.collectedAt.trim() !== "" &&
      Number.isFinite(Date.parse(snapshot.collectedAt)) &&
      snapshot.exactText.trim() !== "" &&
      snapshot.fingerprint.trim() !== "" &&
      snapshot.retrievedVia === "senso" &&
      (snapshot.retrievalState === "current" ||
        snapshot.retrievalState === "cached" ||
        snapshot.retrievalState === "stale")
    );
  }

  private sameEvidenceIdentity(left: EvidenceSnapshot, right: EvidenceSnapshot): boolean {
    return (
      left.offerId === right.offerId &&
      left.merchant === right.merchant &&
      left.sourceUrl === right.sourceUrl &&
      left.scope.kind === right.scope.kind &&
      left.scope.value === right.scope.value &&
      left.exactText === right.exactText &&
      left.fingerprint === right.fingerprint &&
      left.retrievedVia === right.retrievedVia
    );
  }

  private preferFreshestEvidence(
    left: EvidenceSnapshot,
    right: EvidenceSnapshot,
  ): EvidenceSnapshot {
    const leftCollectedAt = Date.parse(left.collectedAt);
    const rightCollectedAt = Date.parse(right.collectedAt);
    if (rightCollectedAt !== leftCollectedAt) {
      return rightCollectedAt > leftCollectedAt ? right : left;
    }
    const retrievalStatePriority = { stale: 0, cached: 1, current: 2 } as const;
    return retrievalStatePriority[right.retrievalState] > retrievalStatePriority[left.retrievalState]
      ? right
      : left;
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
    traceId?: string,
  ): AssessmentResult {
    const record = this.rememberTrace(this.blockedRecord(
      product,
      premiumLimitInr,
      destinationReference,
      evidence,
      message,
    ), traceId);
    for (const candidate of reviewCandidates ?? []) {
      this.rememberTrace(candidate.snapshot, traceId);
    }
    return {
      _tag: "err",
      error: {
        _tag: "NoEligibleOffer",
        message,
        reason: "blocked_by_policy",
        record,
        ...(reviewCandidates === undefined ? {} : { reviewCandidates }),
      },
    };
  }

  private rememberTrace<T extends object>(value: T, traceId: string | undefined): T {
    if (traceId !== undefined) this.traceIds.set(value, traceId);
    return value;
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
      authorizationId: null,
      authorizationState: "not_requested",
      approvedMaximumTotalInr: null,
      pravaStatus: "not_submitted",
      merchantOrderIdentifier: null,
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
