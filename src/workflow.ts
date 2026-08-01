import type {
  AssessedOffer,
  CheckoutQuote,
  EvidenceSnapshot,
  Offer,
  PolicyAssessment,
  PremiumLimitInr,
  Product,
  ReversibilityAssessment,
  UndoRecord,
} from "./domain";
import { SUPPORTED_OFFERS } from "./domain";

/** External capabilities required to perform a Reversibility Assessment. */
export type AssessmentAdapters = {
  readonly senso: {
    retrieveEvidence(product: Product): Promise<AdapterResult<ReadonlyArray<EvidenceSnapshot>>>;
  };
  readonly openAi: {
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
    };

type AssessmentResult =
  | { readonly _tag: "ok"; readonly value: ReversibilityAssessment }
  | { readonly _tag: "err"; readonly error: AssessmentFailure };

function isPolicyEligible(policy: PolicyAssessment): boolean {
  return (
    policy.changeOfMind !== "none" &&
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

  const remedyOrder = { money_back: 2, store_credit: 1, none: 0 } as const;
  const remedyDifference =
    remedyOrder[right.policy.changeOfMind] - remedyOrder[left.policy.changeOfMind];
  if (remedyDifference !== 0) return remedyDifference;

  const windowDifference = right.policy.remedyWindow.days - left.policy.remedyWindow.days;
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
    if (evidenceResult._tag === "err") {
      return {
        _tag: "err",
        error: {
          _tag: "AssessmentUnavailable",
          message: "Policy check unavailable",
          cause: evidenceResult.error,
        },
      };
    }
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
    const evidence = evidenceResult.value;
    const quotes = quotesResult.value;
    const policiesResult = await this.adapters.openAi.extractPolicies(evidence);
    if (policiesResult._tag === "err") {
      return {
        _tag: "err",
        error: {
          _tag: "AssessmentUnavailable",
          message: "Policy check unavailable",
          cause: policiesResult.error,
        },
      };
    }
    const policies = policiesResult.value;

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
        model: "fake-openai/deterministic-1",
        rankingRules: "remedy-ranking/1.0",
      },
    };
  }
}
