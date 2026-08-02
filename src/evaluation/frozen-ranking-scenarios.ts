import type { Offer, PolicyAssessment, Product } from "../domain";

type PolicyOverrides = Partial<
  Pick<
    PolicyAssessment,
    | "changeOfMind"
    | "defect"
    | "productCondition"
    | "remedyWindow"
    | "returnTransport"
    | "reversalCost"
  >
>;

/** One Offer's controlled differences from the frozen ranking fixture defaults. */
export type FrozenRankingOffer = {
  readonly totalInr?: number;
  readonly purchaseAvailable?: boolean;
  readonly product?: Partial<Product>;
  readonly merchant?: string;
  readonly seller?: string;
  readonly policy?: PolicyOverrides;
  readonly collectedAt?: string;
  readonly retrievalState?: "current" | "cached" | "stale";
  readonly reviewed?: boolean;
  readonly reviewFingerprint?: string;
  readonly evidenceProblem?: "missing_required_citation" | "conflicting_required_evidence";
};

/** One immutable ranking input and its independently authored expected outcome. */
export type FrozenRankingScenario = {
  readonly name: string;
  readonly premiumLimitInr?: number;
  readonly useReviewedCache?: boolean;
  readonly offers?: Partial<Record<Offer["id"], FrozenRankingOffer>>;
  readonly expected:
    | { readonly _tag: "winner"; readonly offerId: Offer["id"] }
    | { readonly _tag: "tied"; readonly offerIds: ReadonlyArray<Offer["id"]> }
    | {
        readonly _tag: "blocked";
        readonly reason: "purchase_unavailable" | "blocked_by_policy" | "blocked_by_price";
      };
  readonly buyerSelection?: {
    readonly offerId: Offer["id"];
    readonly expected:
      | "ranking_winner"
      | "buyer_selected_tie"
      | "buyer_override"
      | "offer_not_eligible";
  };
};

/** Human-authored expected outcomes frozen before the issue #6 ranking changes. */
export const FROZEN_RANKING_SCENARIOS: ReadonlyArray<FrozenRankingScenario> = [
  {
    name: "Offer exactly at the Premium Limit remains eligible",
    premiumLimitInr: 2_000,
    offers: {
      flipkart: { totalInr: 10_000, purchaseAvailable: true, policy: { changeOfMind: "none" } },
      "headphone-zone": { totalInr: 12_000 },
      "concept-kart": { totalInr: 12_001 },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Offer one rupee above the Premium Limit is excluded",
    premiumLimitInr: 2_000,
    offers: {
      flipkart: { totalInr: 10_000, purchaseAvailable: true, policy: { changeOfMind: "none" } },
      "headphone-zone": { totalInr: 12_001 },
      "concept-kart": { totalInr: 12_000 },
    },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Trial Permission outranks unopened-only money back",
    offers: {
      "headphone-zone": {
        totalInr: 10_500,
        policy: { changeOfMind: "store_credit", productCondition: "trial_allowed" },
      },
      "concept-kart": {
        totalInr: 10_000,
        policy: { changeOfMind: "money_back", productCondition: "unopened_only" },
      },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Money back outranks store credit after Trial Permission ties",
    offers: {
      "headphone-zone": { totalInr: 10_500, policy: { changeOfMind: "money_back" } },
      "concept-kart": { totalInr: 10_000, policy: { changeOfMind: "store_credit" } },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Longer Remedy Window outranks price",
    offers: {
      "headphone-zone": {
        totalInr: 10_500,
        policy: {
          remedyWindow: {
            kind: "known",
            days: 8,
            startsAt: "delivered",
            requiredAction: "request_submitted",
          },
        },
      },
      "concept-kart": { totalInr: 10_000 },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Doorstep pickup outranks self-shipping",
    offers: {
      "headphone-zone": {
        totalInr: 10_500,
        policy: { returnTransport: "doorstep_pickup" },
      },
      "concept-kart": { totalInr: 10_000, policy: { returnTransport: "self_ship" } },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Explicit free Reversal Cost outranks Unstated Cost",
    offers: {
      "headphone-zone": {
        totalInr: 10_500,
        policy: { reversalCost: { kind: "explicit_none" } },
      },
      "concept-kart": { totalInr: 10_000, policy: { reversalCost: { kind: "unstated" } } },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Lower known Reversal Cost outranks price",
    offers: {
      "headphone-zone": {
        totalInr: 10_500,
        policy: { reversalCost: { kind: "known", amountInr: 99 } },
      },
      "concept-kart": {
        totalInr: 10_000,
        policy: { reversalCost: { kind: "known", amountInr: 100 } },
      },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Explicit free Reversal Cost outranks a known one-rupee cost",
    offers: {
      "headphone-zone": { policy: { reversalCost: { kind: "explicit_none" } } },
      "concept-kart": { policy: { reversalCost: { kind: "known", amountInr: 1 } } },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Lower Confirmed Checkout Total is the final ranking rule",
    offers: {
      "headphone-zone": { totalInr: 10_000 },
      "concept-kart": { totalInr: 10_001 },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Perfect ties remain Tied Offers",
    offers: { "concept-kart": { totalInr: 10_000 } },
    expected: { _tag: "tied", offerIds: ["headphone-zone", "concept-kart"] },
    buyerSelection: { offerId: "concept-kart", expected: "buyer_selected_tie" },
  },
  {
    name: "No change-of-mind remedy reports no reversible purchase",
    offers: {
      "headphone-zone": { policy: { changeOfMind: "none" } },
      "concept-kart": { policy: { changeOfMind: "none" } },
    },
    expected: { _tag: "blocked", reason: "blocked_by_policy" },
  },
  {
    name: "Replacement-only evidence does not establish reversibility",
    offers: {
      "headphone-zone": { policy: { changeOfMind: "none", defect: "replacement" } },
      "concept-kart": { policy: { changeOfMind: "none", defect: "replacement" } },
    },
    expected: { _tag: "blocked", reason: "blocked_by_policy" },
  },
  {
    name: "Unclear change-of-mind evidence excludes that Offer",
    offers: { "headphone-zone": { policy: { changeOfMind: "unclear" } } },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Incomplete Remedy Window excludes that Offer",
    offers: { "headphone-zone": { policy: { remedyWindow: { kind: "unclear" } } } },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Unclear Product condition excludes that Offer",
    offers: { "headphone-zone": { policy: { productCondition: "unclear" } } },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Unclear return transport excludes that Offer",
    offers: { "headphone-zone": { policy: { returnTransport: "unclear" } } },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Unclear buyer-paid fees exclude that Offer",
    offers: { "headphone-zone": { policy: { reversalCost: { kind: "unclear" } } } },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Unpriced required self-shipping cost excludes that Offer",
    offers: {
      "headphone-zone": {
        policy: { returnTransport: "self_ship", reversalCost: { kind: "unpriced_required" } },
      },
    },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Purchase Unavailable Offer cannot set the Premium Limit baseline",
    premiumLimitInr: 0,
    offers: {
      flipkart: { totalInr: 8_000, purchaseAvailable: false },
      "headphone-zone": { totalInr: 10_000 },
      "concept-kart": { totalInr: 10_100 },
    },
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "No Purchase Available Equivalent Offer reports purchase unavailable",
    offers: {
      "headphone-zone": { purchaseAvailable: false },
      "concept-kart": { purchaseAvailable: false },
      flipkart: { purchaseAvailable: false },
    },
    expected: { _tag: "blocked", reason: "purchase_unavailable" },
  },
  {
    name: "A variant mismatch excludes that Offer",
    offers: { "headphone-zone": { product: { variant: "Silver" } } },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "A seller mismatch excludes that Offer",
    offers: { "headphone-zone": { seller: "Unknown seller" } },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Stale Evidence excludes only the stale Offer",
    offers: {
      "headphone-zone": {
        collectedAt: "2026-07-31T11:59:59.999Z",
        retrievalState: "stale",
      },
    },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Fresh unchanged Cached Evidence remains eligible",
    useReviewedCache: true,
    expected: { _tag: "winner", offerId: "headphone-zone" },
  },
  {
    name: "Missing required evidence excludes the Policy Unclear Offer",
    offers: {
      "headphone-zone": {
        evidenceProblem: "missing_required_citation",
      },
    },
    expected: { _tag: "blocked", reason: "blocked_by_policy" },
  },
  {
    name: "Conflicting required evidence excludes the Policy Unclear Offer",
    offers: {
      "headphone-zone": {
        evidenceProblem: "conflicting_required_evidence",
      },
    },
    expected: { _tag: "winner", offerId: "concept-kart" },
  },
  {
    name: "Buyer Override may select another eligible Offer",
    offers: { "concept-kart": { totalInr: 10_001 } },
    expected: { _tag: "winner", offerId: "headphone-zone" },
    buyerSelection: { offerId: "concept-kart", expected: "buyer_override" },
  },
  {
    name: "Buyer Override cannot bypass the Premium Limit",
    premiumLimitInr: 0,
    offers: { "concept-kart": { totalInr: 10_001 } },
    expected: { _tag: "winner", offerId: "headphone-zone" },
    buyerSelection: { offerId: "concept-kart", expected: "offer_not_eligible" },
  },
  {
    name: "Buyer Override cannot bypass a policy block",
    offers: { "concept-kart": { policy: { reversalCost: { kind: "unpriced_required" } } } },
    expected: { _tag: "winner", offerId: "headphone-zone" },
    buyerSelection: { offerId: "concept-kart", expected: "offer_not_eligible" },
  },
];
