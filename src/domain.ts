/** The identity fields that must match before two Offers can be compared. */
export const PRODUCT_IDENTITY_FIELDS = [
  "manufacturer",
  "model",
  "variant",
  "condition",
  "bundleContents",
  "warrantyRegion",
] as const;

export type ProductIdentityField = (typeof PRODUCT_IDENTITY_FIELDS)[number];

/** A deterministic explanation for one Product identity mismatch. */
export type ProductMismatch = {
  readonly field: ProductIdentityField;
  readonly expected: string;
  readonly actual: string | undefined;
};

/** The result of comparing a quoted Offer Product with the buyer's Product. */
export type ProductEquivalence = {
  readonly equivalent: boolean;
  readonly mismatches: ReadonlyArray<ProductMismatch>;
};

/** The only Product supported by the walking skeleton. */
export type Product = {
  readonly manufacturer: string;
  readonly model: string;
  readonly variant: string;
  readonly condition: string;
  readonly bundleContents: string;
  readonly warrantyRegion: string;
};

/** Compares every Product identity field in a stable, user-explainable order. */
export function compareProductIdentity(expected: Product, actual: Product | undefined): ProductEquivalence {
  const mismatches = PRODUCT_IDENTITY_FIELDS.flatMap((field) => {
    const expectedValue = expected[field];
    const actualValue = actual?.[field];
    return actualValue === expectedValue
      ? []
      : [{ field, expected: expectedValue, actual: actualValue }];
  });
  return { equivalent: mismatches.length === 0, mismatches };
}

/** A supported merchant Offer for the Product. */
export type Offer = {
  readonly id: "headphone-zone" | "concept-kart" | "flipkart";
  readonly merchant: string;
  readonly seller: string;
  readonly url: string;
};

/** Ordered policy facts required by the extraction and citation contract. */
export const POLICY_FACTS = [
  "remedy",
  "window",
  "product_condition",
  "return_transport",
  "buyer_paid_fees",
] as const;

/** One member of the five-field policy extraction contract. */
export type PolicyFact = (typeof POLICY_FACTS)[number];

/** Exact source wording and provenance supporting a policy fact. */
export type EvidenceCitation = {
  readonly quote: string;
  readonly sourceUrl: string;
};

/** Policy facts extracted from an Evidence Snapshot. */
export type PolicyAssessment = {
  readonly offerId: Offer["id"];
  readonly changeOfMind: "money_back" | "store_credit" | "none" | "unclear";
  readonly defect: "replacement" | "money_back" | "none" | "unclear";
  readonly productCondition: "unopened_only" | "opened_unused" | "trial_allowed" | "unclear";
  readonly remedyWindow:
    | {
        readonly kind: "known";
        readonly days: number;
        readonly startsAt: "ordered" | "purchased" | "delivered";
        readonly requiredAction: "request_submitted" | "item_shipped" | "item_received";
      }
    | { readonly kind: "unclear" };
  readonly returnTransport: "doorstep_pickup" | "self_ship" | "unclear";
  readonly reversalCost:
    | { readonly kind: "explicit_none" }
    | { readonly kind: "known"; readonly amountInr: number }
    | { readonly kind: "unstated" }
    | { readonly kind: "unpriced_required" }
    | { readonly kind: "unclear" };
  readonly materialConditions: ReadonlyArray<{
    readonly detail: string;
    readonly citation: EvidenceCitation;
  }>;
  readonly supplementaryRemedies: ReadonlyArray<{
    readonly kind:
      | "warranty"
      | "replacement"
      | "pre_dispatch_cancellation"
      | "refund_processing_timing";
    readonly detail: string;
    readonly citation: EvidenceCitation;
  }>;
  /** Primary remedy quote retained for the compact Approval Summary. */
  readonly quote: string;
  readonly citations: ReadonlyArray<{
    readonly fact: PolicyFact;
    readonly quote: string;
    readonly sourceUrl: string;
  }>;
};

/** Dated official merchant text collected for an Offer. */
export type EvidenceSnapshot = {
  readonly offerId: Offer["id"];
  readonly merchant: string;
  readonly sourceUrl: string;
  readonly scope: {
    readonly kind: "product" | "category";
    readonly value: string;
  };
  readonly collectedAt: string;
  readonly exactText: string;
  readonly fingerprint: string;
  readonly retrievedVia: "senso";
  readonly retrievalState: "current" | "cached" | "stale";
};

/** Human approval of extracted facts for one exact content fingerprint. */
export type EvidenceReview = {
  readonly fingerprint: string;
  readonly approvedAt: string;
  readonly policy: PolicyAssessment;
};

/** A complete Reviewed Evidence set retained for a temporary Senso outage. */
export type ReviewedEvidenceCache = {
  readonly snapshots: ReadonlyArray<EvidenceSnapshot>;
  readonly reviews: ReadonlyArray<EvidenceReview>;
};

/** A discount that Prava actually applied or merely advertised. */
export type QuoteDiscount = {
  readonly label: string;
  readonly amountInr: number;
};

/** A Prava live quote containing the identity and complete checkout price breakdown. */
export type CheckoutQuote = {
  readonly offerId: Offer["id"];
  readonly merchant: string;
  readonly seller: string;
  readonly product: Product;
  readonly itemTotalInr: number;
  readonly deliveryInr: number;
  readonly taxesInr: number;
  readonly appliedDiscounts: ReadonlyArray<QuoteDiscount>;
  readonly advertisedDiscounts: ReadonlyArray<QuoteDiscount>;
  readonly cashbackInr: number;
  readonly rewardPoints: number;
  readonly totalInr: number;
  readonly purchaseAvailable: boolean;
  readonly unavailableReason?: string;
};

/** One ranked row shown in the Reversibility Assessment. */
export type AssessedOffer = {
  readonly offer: Offer;
  readonly productEquivalence: ProductEquivalence;
  readonly offerEquivalent: boolean;
  readonly policy: PolicyAssessment;
  readonly evidence: EvidenceSnapshot;
  readonly evidenceReview: {
    readonly state: "reviewed" | "unreviewed";
    readonly reused: boolean;
  };
  readonly checkoutQuote: CheckoutQuote;
  readonly premiumOverBaselineInr: number | null;
  readonly rank: number | null;
  readonly eligible: boolean;
  readonly explanation: string;
};

/** A buyer-controlled choice that has passed every purchase eligibility rule. */
export type BuyerOfferSelection = {
  readonly offer: AssessedOffer;
  readonly selection: "ranking_winner" | "buyer_selected_tie" | "buyer_override";
};

/** Typed result of attempting to select an Offer from an assessment. */
export type BuyerOfferSelectionResult =
  | { readonly _tag: "ok"; readonly value: BuyerOfferSelection }
  | { readonly _tag: "err"; readonly reason: "offer_not_found" | "offer_not_eligible" };

/** The completed assessment data shown before a purchase decision. */
export type ReversibilityAssessment = {
  readonly product: Product;
  readonly offers: ReadonlyArray<AssessedOffer>;
  readonly ranking:
    | { readonly _tag: "winner"; readonly offer: AssessedOffer; readonly reason: string }
    | { readonly _tag: "tied"; readonly offers: ReadonlyArray<AssessedOffer>; readonly reason: string };
  readonly baselineTotalInr: number;
  readonly premiumLimitInr: number;
  readonly destinationReference: string;
};

declare const premiumLimitBrand: unique symbol;

/** A parsed, non-negative whole-rupee Premium Limit. */
export type PremiumLimitInr = number & { readonly [premiumLimitBrand]: true };

/** Result returned when parsing a Premium Limit at the UI boundary. */
export type PremiumLimitParseResult =
  | { readonly _tag: "ok"; readonly value: PremiumLimitInr }
  | { readonly _tag: "err"; readonly message: string };

/** A durable snapshot produced when the buyer declines the assessed purchase. */
export type UndoRecord = {
  readonly id: string;
  readonly createdAt: string;
  readonly outcome:
    | "buyer_declined"
    | "blocked_by_policy"
    | "blocked_by_price"
    | "purchase_unavailable";
  readonly product: Product;
  readonly selectedMerchant: string | null;
  readonly selectedSeller: string | null;
  readonly confirmedCheckoutTotalInr: number | null;
  readonly premiumLimitInr: number;
  readonly destinationReference: string;
  readonly evidence: ReadonlyArray<EvidenceSnapshot>;
  readonly recommendation: {
    readonly rankedOfferIds: ReadonlyArray<Offer["id"]>;
    readonly selectedOfferId: Offer["id"] | null;
    readonly selection: "ranking_winner" | "buyer_selected_tie" | "buyer_override" | "none";
    readonly rankingRules: "remedy-ranking/1.0";
  };
  readonly authorizationState: "not_requested";
  readonly blockingReason?: string;
  readonly assumptions: ReadonlyArray<string>;
  readonly versions: {
    readonly policySchema: "policy-schema/1.0";
    readonly extractionPrompt: "policy-extraction/1.0";
    readonly model: string;
    readonly rankingRules: "remedy-ranking/1.0";
  };
};

/** Fixed Product identity shared by every supported Offer. */
export const SUPPORTED_PRODUCT: Product = {
  manufacturer: "Sennheiser",
  model: "HD 560S",
  variant: "Black",
  condition: "New",
  bundleContents: "Standard retail package",
  warrantyRegion: "India",
};

/** Curated Offer URLs accepted by the MVP boundary. */
export const SUPPORTED_OFFERS: ReadonlyArray<Offer> = [
  {
    id: "headphone-zone",
    merchant: "Headphone Zone",
    seller: "Headphone Zone",
    url: "https://www.headphonezone.in/products/sennheiser-hd-560s",
  },
  {
    id: "concept-kart",
    merchant: "Concept Kart",
    seller: "Concept Kart",
    url: "https://conceptkart.com/products/sennheiser-hd-560s-reference-grade-open-back-headphones",
  },
  {
    id: "flipkart",
    merchant: "Flipkart",
    seller: "BUZZINDIA",
    url: "https://www.flipkart.com/sennheiser-hd-560s-audiophile-over-ear-headphone-wired-without-mic-headset/p/itme71f567510ef2",
  },
];

/** Curated official merchant sources accepted for Policy Evidence retrieval. */
export const OFFICIAL_EVIDENCE_SOURCES = [
  { offerId: "headphone-zone", merchant: "Headphone Zone", sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges", scope: { kind: "category", value: "Selected Easy Exchange products" }, applicability: "unverified", requiredTextMarkers: ["# Returns & Exchanges", "Easy Exchange"] },
  { offerId: "concept-kart", merchant: "Concept Kart", sourceUrl: "https://conceptkart.com/pages/replacement-return-policy", scope: { kind: "category", value: "Headphones" }, applicability: "confirmed", requiredTextMarkers: ["# Replacement Policy", "ten-day replacement policy"] },
  { offerId: "flipkart", merchant: "Flipkart", sourceUrl: "https://www.flipkart.com/pages/returnpolicy", scope: { kind: "category", value: "Headphones" }, applicability: "confirmed", requiredTextMarkers: ["# Order Cancellation and Return Policy", "# Returns Policy"] },
] as const satisfies ReadonlyArray<{
  readonly offerId: Offer["id"];
  readonly merchant: string;
  readonly sourceUrl: string;
  readonly scope: EvidenceSnapshot["scope"];
  readonly applicability: "confirmed" | "unverified";
  readonly requiredTextMarkers: ReadonlyArray<string>;
}>;

/** Confirms that a curated source is known to apply to the supported Product. */
export function officialEvidenceAppliesToSupportedProduct(snapshot: EvidenceSnapshot): boolean {
  return OFFICIAL_EVIDENCE_SOURCES.some(
    (source) =>
      source.offerId === snapshot.offerId &&
      source.merchant === snapshot.merchant &&
      source.sourceUrl === snapshot.sourceUrl &&
      source.scope.kind === snapshot.scope.kind &&
      source.scope.value === snapshot.scope.value &&
      source.applicability === "confirmed",
  );
}

/** Resolves the preset or an approved Offer URL without performing external work. */
export function resolveSupportedProduct(input: string): Product | undefined {
  if (input === "preset") {
    return SUPPORTED_PRODUCT;
  }

  const normalizedInput = input.trim().replace(/\/$/, "");
  return SUPPORTED_OFFERS.some((offer) => offer.url === normalizedInput)
    ? SUPPORTED_PRODUCT
    : undefined;
}

/** Parses an untrusted input value into a valid Premium Limit. */
export function parsePremiumLimitInr(input: string): PremiumLimitParseResult {
  const value = Number(input);
  if (input.trim() === "" || !Number.isSafeInteger(value) || value < 0) {
    return { _tag: "err", message: "Enter a whole-number Premium Limit of ₹0 or more" };
  }

  // SAFETY: The checks above establish the non-negative, whole, safe-integer invariant.
  return { _tag: "ok", value: value as PremiumLimitInr };
}
