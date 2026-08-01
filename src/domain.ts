/** The only Product supported by the walking skeleton. */
export type Product = {
  readonly manufacturer: "Sennheiser";
  readonly model: "HD 560S";
  readonly condition: "New";
  readonly colour: "Black";
  readonly bundle: "Standard retail package";
  readonly warrantyRegion: "India";
};

/** A supported merchant Offer for the Product. */
export type Offer = {
  readonly id: "headphone-zone" | "concept-kart" | "flipkart";
  readonly merchant: string;
  readonly seller: string;
  readonly url: string;
};

/** Policy facts extracted from an Evidence Snapshot. */
export type PolicyAssessment = {
  readonly offerId: Offer["id"];
  readonly changeOfMind: "money_back" | "none";
  readonly defect: "replacement" | "none";
  readonly productCondition: "unopened_only" | "unclear";
  readonly remedyWindow: string;
  readonly returnTransport: "doorstep_pickup" | "self_ship" | "unclear";
  readonly buyerPaidFees: "none_stated" | "unclear";
  readonly materialConditions: ReadonlyArray<string>;
  readonly quote: string;
};

/** Dated official merchant text collected for an Offer. */
export type EvidenceSnapshot = {
  readonly offerId: Offer["id"];
  readonly sourceUrl: string;
  readonly collectedAt: string;
  readonly exactText: string;
  readonly fingerprint: string;
};

/** A Prava live-quote substitute used by this walking skeleton. */
export type CheckoutQuote = {
  readonly offerId: Offer["id"];
  readonly totalInr: number;
  readonly purchaseAvailable: boolean;
};

/** One ranked row shown in the Reversibility Assessment. */
export type AssessedOffer = {
  readonly offer: Offer;
  readonly policy: PolicyAssessment;
  readonly evidence: EvidenceSnapshot;
  readonly checkoutQuote: CheckoutQuote;
  readonly rank: number | null;
  readonly eligible: boolean;
  readonly explanation: string;
};

/** The completed assessment data shown before a purchase decision. */
export type ReversibilityAssessment = {
  readonly product: Product;
  readonly offers: ReadonlyArray<AssessedOffer>;
  readonly recommendedOffer: AssessedOffer;
  readonly premiumLimitInr: number;
  readonly destinationReference: string;
};

/** A durable snapshot produced when the buyer declines the assessed purchase. */
export type UndoRecord = {
  readonly id: string;
  readonly createdAt: string;
  readonly outcome: "buyer_declined";
  readonly product: Product;
  readonly selectedMerchant: string;
  readonly selectedSeller: string;
  readonly confirmedCheckoutTotalInr: number;
  readonly premiumLimitInr: number;
  readonly destinationReference: string;
  readonly assumptions: ReadonlyArray<string>;
  readonly versions: {
    readonly policySchema: "policy-schema/1.0";
    readonly extractionPrompt: "policy-extraction/1.0";
    readonly model: "fake-openai/deterministic-1";
    readonly rankingRules: "remedy-ranking/1.0";
  };
};

/** Fixed Product identity shared by every supported Offer. */
export const SUPPORTED_PRODUCT: Product = {
  manufacturer: "Sennheiser",
  model: "HD 560S",
  condition: "New",
  colour: "Black",
  bundle: "Standard retail package",
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
