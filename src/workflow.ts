import type {
  CheckoutQuote,
  EvidenceSnapshot,
  Offer,
  PolicyAssessment,
  Product,
  ReversibilityAssessment,
  UndoRecord,
} from "./domain";
import { SUPPORTED_OFFERS } from "./domain";

/** External capabilities required to perform a Reversibility Assessment. */
export type AssessmentAdapters = {
  readonly senso: {
    retrieveEvidence(product: Product): Promise<ReadonlyArray<EvidenceSnapshot>>;
  };
  readonly openAi: {
    extractPolicies(
      evidence: ReadonlyArray<EvidenceSnapshot>,
    ): Promise<ReadonlyArray<PolicyAssessment>>;
  };
  readonly prava: {
    quoteOffers(
      offers: ReadonlyArray<Offer>,
      destinationReference: string,
    ): Promise<ReadonlyArray<CheckoutQuote>>;
    submitCheckout(offer: Offer, maximumTotalInr: number): Promise<never>;
  };
  readonly now: () => string;
  readonly nextRecordId: () => string;
};

/** Coordinates the high-level assessment while keeping external behavior injectable. */
export class AssessmentWorkflow {
  constructor(private readonly adapters: AssessmentAdapters) {}

  /** Builds the deterministic comparison from evidence, extraction, and quote adapters. */
  async assess(
    product: Product,
    premiumLimitInr: number,
    destinationReference: string,
  ): Promise<ReversibilityAssessment> {
    const evidence = await this.adapters.senso.retrieveEvidence(product);
    const policies = await this.adapters.openAi.extractPolicies(evidence);
    const quotes = await this.adapters.prava.quoteOffers(
      SUPPORTED_OFFERS,
      destinationReference,
    );

    const assessedOffers = SUPPORTED_OFFERS.map((offer) => {
      const policy = policies.find((candidate) => candidate.offerId === offer.id);
      const snapshot = evidence.find((candidate) => candidate.offerId === offer.id);
      const checkoutQuote = quotes.find((candidate) => candidate.offerId === offer.id);
      if (policy === undefined || snapshot === undefined || checkoutQuote === undefined) {
        throw new Error(`Fake adapter fixture is incomplete for ${offer.id}`);
      }

      const eligible =
        checkoutQuote.purchaseAvailable && policy.changeOfMind === "money_back";
      return {
        offer,
        policy,
        evidence: snapshot,
        checkoutQuote,
        rank: eligible ? 1 : null,
        eligible,
        explanation: eligible
          ? "Recommended: evidenced change-of-mind money back"
          : "Not reversible: defect remedy only",
      } as const;
    });

    const recommendedOffer = assessedOffers.find((offer) => offer.eligible);
    if (recommendedOffer === undefined) {
      throw new Error("Fake adapter fixture has no Reversible Offer");
    }

    return {
      product,
      offers: assessedOffers,
      recommendedOffer,
      premiumLimitInr,
      destinationReference,
    };
  }

  /** Records a buyer decision without submitting checkout. */
  decline(assessment: ReversibilityAssessment): UndoRecord {
    const recommendation = assessment.recommendedOffer;
    return {
      id: this.adapters.nextRecordId(),
      createdAt: this.adapters.now(),
      outcome: "buyer_declined",
      product: assessment.product,
      selectedMerchant: recommendation.offer.merchant,
      selectedSeller: recommendation.offer.seller,
      confirmedCheckoutTotalInr: recommendation.checkoutQuote.totalInr,
      premiumLimitInr: assessment.premiumLimitInr,
      destinationReference: assessment.destinationReference,
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
