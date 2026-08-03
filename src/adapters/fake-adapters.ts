import type {
  CheckoutQuote,
  EvidenceSnapshot,
  PolicyAssessment,
  PravaCheckoutResult,
  PreviousSandboxPurchase,
  ReviewedEvidenceCache,
  UndoRecord,
} from "../domain";
import { POLICY_FACTS, SUPPORTED_OFFERS, SUPPORTED_PRODUCT } from "../domain";
import type {
  AssessmentAdapters,
  PurchaseAuthorizationRepository,
  StoredPurchaseAuthorization,
} from "../workflow";

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
    merchant: "Headphone Zone",
    sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
    scope: { kind: "category", value: "Products eligible for sealed-unopened refunds" },
    collectedAt: "2026-08-01T10:30:00.000Z",
    exactText:
      "Eligible products may be returned for a refund within 7 days of delivery when sealed and unopened in the original packaging.",
    fingerprint: "sha256:hpz-demo-v1",
    retrievedVia: "senso",
    retrievalState: "current",
  },
  {
    offerId: "concept-kart",
    merchant: "Concept Kart",
    sourceUrl: "https://conceptkart.com/pages/replacement-return-policy",
    scope: { kind: "category", value: "Headphones" },
    collectedAt: "2026-08-01T10:30:00.000Z",
    exactText:
      "A manufacturing defect reported within 7 days of delivery is eligible for replacement after verification.",
    fingerprint: "sha256:ck-demo-v1",
    retrievedVia: "senso",
    retrievalState: "current",
  },
  {
    offerId: "flipkart",
    merchant: "Flipkart",
    sourceUrl: "https://www.flipkart.com/pages/returnpolicy",
    scope: { kind: "category", value: "Headphones" },
    collectedAt: "2026-08-01T10:30:00.000Z",
    exactText:
      "This category has a 7-day replacement policy for damaged, defective, or wrong products.",
    fingerprint: "sha256:fk-demo-v1",
    retrievedVia: "senso",
    retrievalState: "current",
  },
];

function citationsFor(
  offerId: PolicyAssessment["offerId"],
  quote: string,
): PolicyAssessment["citations"] {
  const sourceUrl = evidence.find((snapshot) => snapshot.offerId === offerId)?.sourceUrl ?? "";
  return POLICY_FACTS.map(
    (fact) => ({
      fact,
      quote,
      sourceUrl,
    }),
  );
}

function sourceUrlFor(offerId: PolicyAssessment["offerId"]): string {
  return evidence.find((snapshot) => snapshot.offerId === offerId)?.sourceUrl ?? "";
}

function policyAt(items: ReadonlyArray<PolicyAssessment>, index: number): PolicyAssessment {
  const policy = items[index];
  if (policy === undefined) throw new Error(`Fake policy fixture is missing index ${index}`);
  return policy;
}

const policies: ReadonlyArray<PolicyAssessment> = [
  {
    offerId: "headphone-zone",
    changeOfMind: "money_back",
    defect: "none",
    productCondition: "unopened_only",
    remedyWindow: { kind: "known", days: 7, startsAt: "delivered", requiredAction: "request_submitted" },
    returnTransport: "self_ship",
    reversalCost: { kind: "unstated" },
    materialConditions: [
      {
        detail: "Product must remain sealed and unopened.",
        citation: {
          quote: "sealed and unopened in the original packaging",
          sourceUrl: sourceUrlFor("headphone-zone"),
        },
      },
    ],
    supplementaryRemedies: [],
    quote:
      "Eligible products may be returned for a refund within 7 days of delivery when sealed and unopened in the original packaging.",
    citations: citationsFor(
      "headphone-zone",
      "Eligible products may be returned for a refund within 7 days of delivery when sealed and unopened in the original packaging.",
    ),
  },
  {
    offerId: "concept-kart",
    changeOfMind: "none",
    defect: "replacement",
    productCondition: "unclear",
    remedyWindow: { kind: "known", days: 7, startsAt: "delivered", requiredAction: "request_submitted" },
    returnTransport: "unclear",
    reversalCost: { kind: "unclear" },
    materialConditions: [
      {
        detail: "Manufacturing defect must be verified.",
        citation: { quote: "after verification", sourceUrl: sourceUrlFor("concept-kart") },
      },
    ],
    supplementaryRemedies: [{
      kind: "replacement",
      detail: "Manufacturing defects may be replaced after verification.",
      citation: {
        quote: "eligible for replacement after verification",
        sourceUrl: sourceUrlFor("concept-kart"),
      },
    }],
    quote:
      "A manufacturing defect reported within 7 days of delivery is eligible for replacement after verification.",
    citations: citationsFor(
      "concept-kart",
      "A manufacturing defect reported within 7 days of delivery is eligible for replacement after verification.",
    ),
  },
  {
    offerId: "flipkart",
    changeOfMind: "none",
    defect: "replacement",
    productCondition: "unclear",
    remedyWindow: { kind: "known", days: 7, startsAt: "delivered", requiredAction: "request_submitted" },
    returnTransport: "doorstep_pickup",
    reversalCost: { kind: "unstated" },
    materialConditions: [
      {
        detail: "Only damaged, defective, or wrong Products qualify.",
        citation: {
          quote: "damaged, defective, or wrong products",
          sourceUrl: sourceUrlFor("flipkart"),
        },
      },
    ],
    supplementaryRemedies: [{
      kind: "replacement",
      detail: "Damaged, defective, or wrong Products may be replaced.",
      citation: {
        quote: "replacement policy for damaged, defective, or wrong products",
        sourceUrl: sourceUrlFor("flipkart"),
      },
    }],
    quote:
      "This category has a 7-day replacement policy for damaged, defective, or wrong products.",
    citations: citationsFor(
      "flipkart",
      "This category has a 7-day replacement policy for damaged, defective, or wrong products.",
    ),
  },
];

function quoteFor(
  offerId: CheckoutQuote["offerId"],
  totalInr: number,
  purchaseAvailable: boolean,
): CheckoutQuote {
  const offer = SUPPORTED_OFFERS.find((candidate) => candidate.id === offerId);
  if (offer === undefined) throw new Error(`Fake quote fixture is missing ${offerId}`);
  return {
    offerId,
    merchant: offer.merchant,
    seller: offer.seller,
    destinationReference: "destination-ref-prava-default",
    product: SUPPORTED_PRODUCT,
    itemTotalInr: totalInr - 500,
    deliveryInr: 300,
    taxesInr: 200,
    appliedDiscounts: [],
    advertisedDiscounts: [{ label: "Advertised bank offer", amountInr: 1_000 }],
    cashbackInr: 250,
    rewardPoints: 100,
    totalInr,
    purchaseAvailable,
  };
}

const quotes: ReadonlyArray<CheckoutQuote> = [
  quoteFor("headphone-zone", 14_990, true),
  quoteFor("concept-kart", 14_490, true),
  quoteFor("flipkart", 14_799, false),
];

/** Creates a deterministic repository with atomic in-memory lifecycle transitions. */
export function createInMemoryPurchaseAuthorizationRepository(): PurchaseAuthorizationRepository {
  const records = new Map<string, StoredPurchaseAuthorization>();
  return {
    create(id, value) {
      if (records.has(id)) return Promise.resolve("duplicate");
      records.set(id, value);
      return Promise.resolve("created");
    },
    read(id, authorizationSnapshot) {
      const value = records.get(id);
      return Promise.resolve(
        value === undefined || value.authorizationSnapshot !== authorizationSnapshot
          ? { _tag: "invalid" as const }
          : { _tag: "ok" as const, value },
      );
    },
    transition(id, authorizationSnapshot, nextState) {
      const value = records.get(id);
      if (value === undefined || value.authorizationSnapshot !== authorizationSnapshot) {
        return Promise.resolve("invalid");
      }
      if (nextState === "active") {
        if (value.state !== "pending_registration") return Promise.resolve(value.state);
        records.set(id, { ...value, state: "active" });
        return Promise.resolve("updated");
      }
      if (value.state !== "active") return Promise.resolve(value.state);
      records.set(id, { ...value, state: nextState });
      return Promise.resolve("updated");
    },
  };
}

/** Creates deterministic Senso, OpenAI, and Prava substitutes for the walking skeleton. */
export function createFakeAdapters(options?: {
  readonly now?: string;
  readonly authorizationId?: string;
  readonly recordId?: string;
  readonly failSenso?: boolean;
  readonly failOpenAi?: boolean;
  readonly failPravaQuote?: boolean;
  readonly checkoutResult?: PravaCheckoutResult;
  readonly previousSandboxPurchase?: PreviousSandboxPurchase;
  readonly unreviewed?: boolean;
  readonly scenario?: "default" | "exchange" | "tied" | "override";
  readonly quoteOverrides?: Partial<Record<CheckoutQuote["offerId"], Partial<CheckoutQuote>>>;
}): FakeAdapters {
  const scenario = options?.scenario ?? "default";
  const conceptKartIsReversible = scenario === "tied" || scenario === "override";
  const conceptKartComparisonTotal =
    scenario === "tied" ? 14_990 : scenario === "override" ? 15_000 : undefined;
  const activity: FakeAdapterActivity = {
    sensoRequests: 0,
    openAiRequests: 0,
    pravaQuoteRequests: 0,
    pravaCheckoutRequests: 0,
  };
  const scenarioPolicies = () =>
    scenario === "exchange"
      ? policies.map((policy) =>
          policy.offerId === "headphone-zone"
            ? {
                ...policy,
                changeOfMind: "store_credit" as const,
                productCondition: "trial_allowed" as const,
                remedyWindow: {
                  kind: "known" as const,
                  days: 10,
                  startsAt: "delivered" as const,
                  requiredAction: "request_submitted" as const,
                },
                returnTransport: "doorstep_pickup" as const,
                reversalCost: { kind: "explicit_none" as const },
                materialConditions: [],
              }
            : policy,
        )
      : conceptKartIsReversible
        ? policies.map((policy) =>
            policy.offerId === "concept-kart"
              ? {
                  ...policy,
                  changeOfMind: "money_back" as const,
                  defect: "none" as const,
                  productCondition: "unopened_only" as const,
                  returnTransport: "self_ship" as const,
                  reversalCost: { kind: "unstated" as const },
                  materialConditions: [],
                }
              : policy,
          )
        : policies;
  const reviewByFingerprint = new Map(
    (options?.unreviewed === true ? [] : evidence).map((snapshot, index) => [
      snapshot.fingerprint,
      {
        fingerprint: snapshot.fingerprint,
        approvedAt: "2026-08-01T11:00:00.000Z",
        policy: policyAt(scenarioPolicies(), index),
      },
    ]),
  );
  let cache: ReviewedEvidenceCache | undefined;
  let authorizationSequence = 0;
  const authorization = createInMemoryPurchaseAuthorizationRepository();
  const savedRecords: Array<UndoRecord> = [];

  return {
    activity,
    policyContract: { purchaseEnabled: () => true },
    evidenceApplicability: { appliesToProduct: () => true },
    senso: {
      retrieveEvidence() {
        activity.sensoRequests += 1;
        if (options?.failSenso === true) {
          return Promise.resolve({
            _tag: "err" as const,
            error: {
              _tag: "DependencyUnavailable" as const,
              dependency: "senso" as const,
              cause: new Error("deterministic Senso failure"),
            },
          });
        }
        return Promise.resolve({ _tag: "ok" as const, value: evidence });
      },
    },
    openAi: {
      modelVersion: () => "fake-openai/deterministic-1",
      extractPolicies() {
        activity.openAiRequests += 1;
        if (options?.failOpenAi === true) {
          return Promise.resolve({
            _tag: "err" as const,
            error: {
              _tag: "DependencyUnavailable" as const,
              dependency: "openai" as const,
              cause: new Error("deterministic OpenAI failure"),
            },
          });
        }
        return Promise.resolve({ _tag: "ok" as const, value: scenarioPolicies() });
      },
    },
    prava: {
      quoteOffers(_offers, destinationReference) {
        activity.pravaQuoteRequests += 1;
        if (options?.failPravaQuote === true) {
          return Promise.resolve({
            _tag: "err" as const,
            error: {
              _tag: "DependencyUnavailable" as const,
              dependency: "prava" as const,
              cause: new Error("deterministic Prava quote failure"),
            },
          });
        }
        const scenarioQuotes =
          conceptKartComparisonTotal !== undefined
            ? quotes.map((quote) =>
                quote.offerId === "concept-kart"
                  ? quoteFor(
                      quote.offerId,
                      conceptKartComparisonTotal,
                      quote.purchaseAvailable,
                    )
                  : quote,
              )
            : quotes;
        const overriddenQuotes = scenarioQuotes.map((quote) => ({
          ...quote,
          destinationReference,
          ...options?.quoteOverrides?.[quote.offerId],
        }));
        return Promise.resolve({ _tag: "ok" as const, value: overriddenQuotes });
      },
      registerCheckout() {
        return Promise.resolve("registered");
      },
      submitCheckout() {
        activity.pravaCheckoutRequests += 1;
        return Promise.resolve(options?.checkoutResult ?? {
          _tag: "submitted" as const,
          paymentStatus: "successful" as const,
          merchantOrderIdentifier: "sandbox-order-demo-001",
          confirmedTotalInr: 14_990,
        });
      },
    },
    evidence: {
      findReview(fingerprint) {
        return Promise.resolve(reviewByFingerprint.get(fingerprint));
      },
      saveReview(review) {
        reviewByFingerprint.set(review.fingerprint, review);
        return Promise.resolve();
      },
      loadCache() {
        return Promise.resolve(cache);
      },
      saveCache(nextCache) {
        cache = nextCache;
        return Promise.resolve();
      },
    },
    authorization,
    records: {
      save(record) {
        const existing = savedRecords.findIndex(({ id }) => id === record.id);
        if (existing === -1) savedRecords.push(record);
        else savedRecords[existing] = record;
        return Promise.resolve("saved");
      },
      find(id) {
        return Promise.resolve(savedRecords.find((record) => record.id === id));
      },
      latestCompletedPurchase() {
        const savedPurchase = [...savedRecords].reverse().find(
          (record) => record.outcome === "purchased" && record.merchantOrderIdentifier !== null,
        );
        if (savedPurchase === undefined || savedPurchase.merchantOrderIdentifier === null) {
          return Promise.resolve(options?.previousSandboxPurchase);
        }
        return Promise.resolve({
          purchasedAt: savedPurchase.createdAt,
          merchantOrderIdentifier: savedPurchase.merchantOrderIdentifier,
        });
      },
    },
    now: () => options?.now ?? "2026-08-01T12:00:00.000Z",
    nextAuthorizationId: () => {
      authorizationSequence += 1;
      return options?.authorizationId ?? `purchase-authorization-demo-${authorizationSequence}`;
    },
    nextRecordId: () => options?.recordId ?? "undo-demo-record",
  };
}
