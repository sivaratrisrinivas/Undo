import {
  SUPPORTED_OFFERS,
  type Offer,
} from "../domain";
import type { PolicyContractScore } from "./policy-contract";

/** Thresholds from Issue #10's accepted demo and validation contract. */
export const DEMO_RELEASE_THRESHOLDS = {
  maxCachedComparisonMs: 8_000,
  requiredOfferCount: SUPPORTED_OFFERS.length,
  requiredPravaPurchaseCount: 3,
  extractionFieldCount: 75,
  extractionAccuracy: 0.95,
  rankingScenarioCount: 30,
  minimumConsumerCount: 10,
  minimumSellerSwitches: 6,
  minimumUsageIntentions: 4,
} as const;

type GateStatus = "pass" | "fail";

/** One safe, human-readable result for a release gate. */
export type DemoGateResult = {
  readonly status: GateStatus;
  readonly reason: string;
};

/** Evidence that one curated Offer was verified before a repeatable demo. */
export type DemoOfferVerification = {
  readonly offerId: Offer["id"];
  readonly merchant: string;
  readonly seller: string;
  /** Verification means the observed state was checked, including an unavailable state. */
  readonly productIdentityVerified: boolean;
  readonly merchantVerified: boolean;
  readonly sellerVerified: boolean;
  readonly availabilityVerified: boolean;
  readonly priceVerified: boolean;
  readonly pravaOrderabilityVerified: boolean;
  readonly policyWordingVerified: boolean;
  readonly reviewedEvidenceFingerprint: string;
  readonly verifiedAt: string;
};

/** One human-approved Prava sandbox attempt, represented without payment data. */
export type DemoPurchaseAttempt = {
  readonly authorizationId: string;
  readonly authorizationCreated: boolean;
  readonly checkoutSubmitted: boolean;
  readonly paymentSucceeded: boolean;
  readonly merchantOrderIdentifier: string;
};

/** The non-secret validation ledger evaluated before accepting a demo release. */
export type DemoReleaseInput = {
  readonly normalPath: {
    readonly sensoRetrieved: boolean;
    readonly openAiStructuredExtraction: boolean;
    readonly deterministicRanking: boolean;
    readonly explicitBuyerAuthorization: boolean;
    readonly pravaCheckout: boolean;
    readonly valuesDerivedFromAdapters: boolean;
  };
  readonly offerVerification: ReadonlyArray<DemoOfferVerification>;
  readonly cachedComparison: { readonly durationMs: number };
  readonly purchaseAttempts: ReadonlyArray<DemoPurchaseAttempt>;
  readonly outageRehearsal: {
    readonly sensoOutageHandled: boolean;
    readonly openAiOutageHandled: boolean;
    readonly previousSandboxPurchaseShown: boolean;
    readonly previousSandboxPurchaseLabelledHistorical: boolean;
    readonly currentAttemptDistinguished: boolean;
  };
  readonly policyContract: PolicyContractScore;
  readonly rankingContract: {
    readonly correctScenarios: number;
    readonly totalScenarios: number;
  };
  readonly consumerValidation: {
    readonly recentBuyerCount: number;
    readonly sellerSwitches: number;
    readonly usageIntentions: number;
  };
  readonly scope: {
    readonly sevenStepFlowCompleted: boolean;
    readonly excludedScopeIntroduced: boolean;
  };
};

/** Classification of the consumer validation sample, including its inconclusive state. */
export type ConsumerValidationClassification =
  | "success"
  | "failure"
  | "inconclusive"
  | "invalid";

/** Safe consumer validation result included in the release report. */
export type ConsumerValidationResult = {
  readonly classification: ConsumerValidationClassification;
  readonly reason: string;
};

/** Complete safe report used to decide whether the repeatable demo is accepted. */
export type DemoReleaseReport = {
  readonly overall: GateStatus;
  readonly gates: {
    readonly normalPath: DemoGateResult;
    readonly offerVerification: DemoGateResult;
    readonly cachedComparison: DemoGateResult;
    readonly pravaPurchases: DemoGateResult;
    readonly outageFallback: DemoGateResult;
    readonly extractionContract: DemoGateResult;
    readonly rankingContract: DemoGateResult;
    readonly consumerValidation: DemoGateResult;
    readonly scope: DemoGateResult;
  };
  readonly consumerValidation: ConsumerValidationResult;
};

function gate(status: boolean, passReason: string, failReason: string): DemoGateResult {
  return { status: status ? "pass" : "fail", reason: status ? passReason : failReason };
}

function allTrue(values: ReadonlyArray<boolean>): boolean {
  return values.every((value) => value === true);
}

function isFiniteNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isVerifiedAt(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function hasExactSupportedOfferSet(values: ReadonlyArray<DemoOfferVerification>): boolean {
  if (values.length !== DEMO_RELEASE_THRESHOLDS.requiredOfferCount) return false;
  const expectedIds = new Set(SUPPORTED_OFFERS.map((offer) => offer.id));
  const actualIds = new Set(values.map((value) => value.offerId));
  return actualIds.size === expectedIds.size && [...expectedIds].every((id) => actualIds.has(id));
}

function offerVerificationPasses(values: ReadonlyArray<DemoOfferVerification>): boolean {
  return hasExactSupportedOfferSet(values) && values.every((value) =>
    SUPPORTED_OFFERS.some((offer) =>
      offer.id === value.offerId &&
      offer.merchant === value.merchant &&
      offer.seller === value.seller,
    ) &&
    allTrue([
      value.productIdentityVerified,
      value.merchantVerified,
      value.sellerVerified,
      value.availabilityVerified,
      value.priceVerified,
      value.pravaOrderabilityVerified,
      value.policyWordingVerified,
    ]) &&
    value.reviewedEvidenceFingerprint.trim() !== "" &&
    isVerifiedAt(value.verifiedAt),
  );
}

function cachedComparisonPasses(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs >= 0 && durationMs < DEMO_RELEASE_THRESHOLDS.maxCachedComparisonMs;
}

function purchaseAttemptsPass(values: ReadonlyArray<DemoPurchaseAttempt>): boolean {
  if (values.length !== DEMO_RELEASE_THRESHOLDS.requiredPravaPurchaseCount) return false;
  const authorizationIds = values.map((value) => value.authorizationId.trim());
  return new Set(authorizationIds).size === values.length && values.every((value) =>
    value.authorizationId.trim() !== "" &&
    value.authorizationCreated === true &&
    value.checkoutSubmitted === true &&
    value.paymentSucceeded === true &&
    value.merchantOrderIdentifier.trim() !== "",
  );
}

function outageFallbackPasses(input: DemoReleaseInput["outageRehearsal"]): boolean {
  return allTrue([
    input.sensoOutageHandled,
    input.openAiOutageHandled,
    input.previousSandboxPurchaseShown,
    input.previousSandboxPurchaseLabelledHistorical,
    input.currentAttemptDistinguished,
  ]);
}

function extractionContractPasses(score: PolicyContractScore): boolean {
  const hasValidMetrics =
    isFiniteNonNegativeInteger(score.passedFields) &&
    isFiniteNonNegativeInteger(score.totalFields) &&
    score.totalFields === DEMO_RELEASE_THRESHOLDS.extractionFieldCount &&
    score.passedFields <= score.totalFields &&
    Number.isFinite(score.accuracy) &&
    score.accuracy >= 0 &&
    score.accuracy <= 1 &&
    score.accuracy === score.passedFields / score.totalFields;
  return hasValidMetrics &&
    score.accuracy >= DEMO_RELEASE_THRESHOLDS.extractionAccuracy &&
    score.correctAbstention === true &&
    score.noUnsupportedReturnClaims === true &&
    score.demoFieldsAndCitationsCorrect === true &&
    score.meetsAccuracyThreshold === true;
}

function rankingContractPasses(contract: DemoReleaseInput["rankingContract"]): boolean {
  return isFiniteNonNegativeInteger(contract.correctScenarios) &&
    isFiniteNonNegativeInteger(contract.totalScenarios) &&
    contract.totalScenarios === DEMO_RELEASE_THRESHOLDS.rankingScenarioCount &&
    contract.correctScenarios === contract.totalScenarios;
}

function consumerValidationResult(
  validation: DemoReleaseInput["consumerValidation"],
): ConsumerValidationResult {
  const validMetrics =
    isFiniteNonNegativeInteger(validation.recentBuyerCount) &&
    isFiniteNonNegativeInteger(validation.sellerSwitches) &&
    isFiniteNonNegativeInteger(validation.usageIntentions) &&
    validation.recentBuyerCount >= DEMO_RELEASE_THRESHOLDS.minimumConsumerCount &&
    validation.sellerSwitches <= validation.recentBuyerCount &&
    validation.usageIntentions <= validation.recentBuyerCount;
  if (!validMetrics) {
    return { classification: "invalid", reason: "Consumer validation metrics are incomplete or invalid" };
  }
  if (validation.sellerSwitches <= 2) {
    return { classification: "failure", reason: "Two or fewer buyers switched sellers" };
  }
  if (validation.sellerSwitches <= 5) {
    return { classification: "inconclusive", reason: "Three to five buyers switched; run ten additional interviews" };
  }
  if (validation.usageIntentions < DEMO_RELEASE_THRESHOLDS.minimumUsageIntentions) {
    return { classification: "inconclusive", reason: "Seller switches passed, but usage intentions did not" };
  }
  return { classification: "success", reason: "At least six switches and four usage intentions from ten recent buyers" };
}

function scopePasses(scope: DemoReleaseInput["scope"]): boolean {
  return scope.sevenStepFlowCompleted === true && scope.excludedScopeIntroduced === false;
}

/**
 * Validates a collected non-secret demo ledger without performing external work or payments.
 * This is a fail-closed shape and threshold check, not an authenticity oracle: manual rows must
 * remain backed by the external evidence retained by the operator and described in the runbook.
 */
export function evaluateDemoRelease(input: DemoReleaseInput): DemoReleaseReport {
  const consumerValidation = consumerValidationResult(input.consumerValidation);
  const gates = {
    normalPath: gate(
      allTrue(Object.values(input.normalPath)),
      "Senso, OpenAI, deterministic ranking, authorization, and Prava are represented in the normal path",
      "Normal path integration evidence is incomplete or includes unproven adapter-derived behavior",
    ),
    offerVerification: gate(
      offerVerificationPasses(input.offerVerification),
      "All three curated Offers have current, reviewed, provenance-backed verification",
      "Each curated Offer needs complete current verification and a reviewed evidence fingerprint",
    ),
    cachedComparison: gate(
      cachedComparisonPasses(input.cachedComparison.durationMs),
      "A valid cached comparison completed under eight seconds",
      "Cached comparison timing is missing, invalid, or not strictly under eight seconds",
    ),
    pravaPurchases: gate(
      purchaseAttemptsPass(input.purchaseAttempts),
      "Three distinct authorized attempts have confirmed payment and merchant order identifiers",
      "Exactly three distinct authorized attempts must each have confirmed payment and an order identifier",
    ),
    outageFallback: gate(
      outageFallbackPasses(input.outageRehearsal),
      "Senso/OpenAI outage and historical fallback labels were visibly rehearsed",
      "Outage handling or the historical Previous Sandbox Purchase distinction is unproven",
    ),
    extractionContract: gate(
      extractionContractPasses(input.policyContract),
      "The frozen extraction contract meets the 95% and demo citation gates",
      "The frozen extraction contract is below threshold or has an unsafe claim/citation result",
    ),
    rankingContract: gate(
      rankingContractPasses(input.rankingContract),
      "The frozen deterministic ranking contract is 30/30",
      "The frozen deterministic ranking contract is not 30/30",
    ),
    consumerValidation: gate(
      consumerValidation.classification === "success",
      "Consumer validation reached the accepted switch and usage-intention thresholds",
      consumerValidation.reason,
    ),
    scope: gate(
      scopePasses(input.scope),
      "The scoped seven-step flow completed without excluded scope",
      "The seven-step scope is incomplete or an excluded capability entered the demo",
    ),
  } as const;
  return {
    overall: Object.values(gates).every((result) => result.status === "pass") ? "pass" : "fail",
    gates,
    consumerValidation,
  };
}
