import type {
  CheckoutQuote,
  EvidenceSnapshot,
  PolicyAssessment,
} from "../domain";
import type { AssessmentAdapters } from "../workflow";

/** Observable counters exposed by the deterministic fake boundary. */
export type FakeAdapterActivity = {
  sensoRequests: number;
  openAiRequests: number;
  pravaQuoteRequests: number;
  pravaCheckoutRequests: number;
};

/** Assessment dependencies plus activity records for system-seam tests. */
export type FakeAdapters = AssessmentAdapters & {
  readonly activity: FakeAdapterActivity;
};

const evidence: ReadonlyArray<EvidenceSnapshot> = [
  {
    offerId: "headphone-zone",
    sourceUrl: "https://www.headphonezone.in/pages/returns-refunds",
    collectedAt: "2026-08-01T10:30:00.000Z",
    exactText:
      "Eligible products may be returned for a refund within 7 days of delivery when sealed and unopened in the original packaging.",
    fingerprint: "sha256:hpz-demo-v1",
  },
  {
    offerId: "concept-kart",
    sourceUrl: "https://conceptkart.com/pages/refund-policy",
    collectedAt: "2026-08-01T10:30:00.000Z",
    exactText:
      "A manufacturing defect reported within 7 days of delivery is eligible for replacement after verification.",
    fingerprint: "sha256:ck-demo-v1",
  },
  {
    offerId: "flipkart",
    sourceUrl: "https://www.flipkart.com/pages/returnpolicy",
    collectedAt: "2026-08-01T10:30:00.000Z",
    exactText:
      "This category has a 7-day replacement policy for damaged, defective, or wrong products.",
    fingerprint: "sha256:fk-demo-v1",
  },
];

const policies: ReadonlyArray<PolicyAssessment> = [
  {
    offerId: "headphone-zone",
    changeOfMind: "money_back",
    defect: "none",
    productCondition: "unopened_only",
    remedyWindow: "7 days from delivery; request submitted",
    returnTransport: "self_ship",
    buyerPaidFees: "none_stated",
    materialConditions: ["Product must remain sealed and unopened."],
    quote: "returned for a refund within 7 days of delivery when sealed and unopened",
  },
  {
    offerId: "concept-kart",
    changeOfMind: "none",
    defect: "replacement",
    productCondition: "unclear",
    remedyWindow: "7 days from delivery; report submitted",
    returnTransport: "unclear",
    buyerPaidFees: "unclear",
    materialConditions: ["Manufacturing defect must be verified."],
    quote: "manufacturing defect reported within 7 days ... eligible for replacement",
  },
  {
    offerId: "flipkart",
    changeOfMind: "none",
    defect: "replacement",
    productCondition: "unclear",
    remedyWindow: "7 days from delivery; request submitted",
    returnTransport: "doorstep_pickup",
    buyerPaidFees: "none_stated",
    materialConditions: ["Only damaged, defective, or wrong Products qualify."],
    quote: "7-day replacement policy for damaged, defective, or wrong products",
  },
];

const quotes: ReadonlyArray<CheckoutQuote> = [
  { offerId: "headphone-zone", totalInr: 14_990, purchaseAvailable: true },
  { offerId: "concept-kart", totalInr: 14_490, purchaseAvailable: true },
  { offerId: "flipkart", totalInr: 14_799, purchaseAvailable: false },
];

/** Creates deterministic Senso, OpenAI, and Prava substitutes for the walking skeleton. */
export function createFakeAdapters(options?: {
  readonly now?: string;
  readonly recordId?: string;
}): FakeAdapters {
  const activity: FakeAdapterActivity = {
    sensoRequests: 0,
    openAiRequests: 0,
    pravaQuoteRequests: 0,
    pravaCheckoutRequests: 0,
  };

  return {
    activity,
    senso: {
      retrieveEvidence() {
        activity.sensoRequests += 1;
        return Promise.resolve(evidence);
      },
    },
    openAi: {
      extractPolicies() {
        activity.openAiRequests += 1;
        return Promise.resolve(policies);
      },
    },
    prava: {
      quoteOffers() {
        activity.pravaQuoteRequests += 1;
        return Promise.resolve(quotes);
      },
      submitCheckout() {
        activity.pravaCheckoutRequests += 1;
        return Promise.reject(new Error("Checkout is outside the decline-path skeleton"));
      },
    },
    now: () => options?.now ?? "2026-08-01T12:00:00.000Z",
    nextRecordId: () => options?.recordId ?? "undo-demo-record",
  };
}
