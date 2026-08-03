import { describe, expect, it } from "vitest";

import { SUPPORTED_OFFERS } from "../domain";
import {
  DEMO_RELEASE_THRESHOLDS,
  evaluateDemoRelease,
  type DemoReleaseInput,
} from "./demo-release-gate";

const policyScore = {
  passedFields: 72,
  totalFields: 75,
  accuracy: 0.96,
  correctAbstention: true,
  noUnsupportedReturnClaims: true,
  demoFieldsAndCitationsCorrect: true,
  meetsAccuracyThreshold: true,
} as const;

const offerVerification = SUPPORTED_OFFERS.map((offer) => ({
  offerId: offer.id,
  merchant: offer.merchant,
  seller: offer.seller,
  productIdentityVerified: true,
  merchantVerified: true,
  sellerVerified: true,
  availabilityVerified: true,
  priceVerified: true,
  pravaOrderabilityVerified: true,
  policyWordingVerified: true,
  reviewedEvidenceFingerprint: `sha256:${offer.id}-reviewed`,
  verifiedAt: "2026-08-03T09:00:00.000Z",
}));

const passingInput: DemoReleaseInput = {
  normalPath: {
    sensoRetrieved: true,
    openAiStructuredExtraction: true,
    deterministicRanking: true,
    explicitBuyerAuthorization: true,
    pravaCheckout: true,
    valuesDerivedFromAdapters: true,
  },
  offerVerification,
  cachedComparison: { durationMs: DEMO_RELEASE_THRESHOLDS.maxCachedComparisonMs - 1 },
  purchaseAttempts: [1, 2, 3].map((sequence) => ({
    authorizationId: `authorization-${sequence}`,
    authorizationCreated: true,
    checkoutSubmitted: true,
    paymentSucceeded: true,
    merchantOrderIdentifier: `sandbox-order-${sequence}`,
  })),
  outageRehearsal: {
    sensoOutageHandled: true,
    openAiOutageHandled: true,
    previousSandboxPurchaseShown: true,
    previousSandboxPurchaseLabelledHistorical: true,
    currentAttemptDistinguished: true,
  },
  policyContract: policyScore,
  rankingContract: { correctScenarios: 30, totalScenarios: 30 },
  consumerValidation: {
    recentBuyerCount: 10,
    sellerSwitches: 6,
    usageIntentions: 4,
  },
  scope: { sevenStepFlowCompleted: true, excludedScopeIntroduced: false },
};

describe("demo release gate", () => {
  it("passes the complete ledger at the accepted thresholds", () => {
    const report = evaluateDemoRelease(passingInput);

    expect(report.overall).toBe("pass");
    expect(Object.values(report.gates).every((gate) => gate.status === "pass")).toBe(true);
    expect(report.consumerValidation).toMatchObject({ classification: "success" });
  });

  it("fails closed when any curated Offer is missing verification provenance", () => {
    const missingFingerprint = passingInput.offerVerification.map((offer, index) =>
      index === 0 ? { ...offer, reviewedEvidenceFingerprint: "" } : offer,
    );
    const missingTimestamp = passingInput.offerVerification.map((offer, index) =>
      index === 1 ? { ...offer, verifiedAt: "not-a-timestamp" } : offer,
    );

    expect(evaluateDemoRelease({ ...passingInput, offerVerification: missingFingerprint }).gates.offerVerification.status).toBe("fail");
    expect(evaluateDemoRelease({ ...passingInput, offerVerification: missingTimestamp }).gates.offerVerification.status).toBe("fail");
  });

  it("requires exactly the supported Offer set", () => {
    const firstOffer = passingInput.offerVerification[0];
    if (firstOffer === undefined) throw new Error("Missing Offer verification fixture");
    const wrongOffer = {
      ...firstOffer,
      offerId: passingInput.offerVerification[1]?.offerId ?? firstOffer.offerId,
    };

    const report = evaluateDemoRelease({
      ...passingInput,
      offerVerification: [wrongOffer, ...passingInput.offerVerification.slice(1)],
    });

    expect(report.gates.offerVerification.status).toBe("fail");

    const wrongSeller = { ...firstOffer, seller: "Unknown seller" };
    expect(
      evaluateDemoRelease({
        ...passingInput,
        offerVerification: [wrongSeller, ...passingInput.offerVerification.slice(1)],
      }).gates.offerVerification.status,
    ).toBe("fail");
  });

  it("requires a cached comparison strictly under eight seconds", () => {
    expect(
      evaluateDemoRelease({
        ...passingInput,
        cachedComparison: { durationMs: DEMO_RELEASE_THRESHOLDS.maxCachedComparisonMs },
      }).gates.cachedComparison.status,
    ).toBe("fail");
    expect(
      evaluateDemoRelease({ ...passingInput, cachedComparison: { durationMs: -1 } }).gates.cachedComparison.status,
    ).toBe("fail");
  });

  it("requires three distinct confirmed Prava purchases with order identifiers", () => {
    const twoAttempts = passingInput.purchaseAttempts.slice(0, 2);
    const missingOrder = passingInput.purchaseAttempts.map((attempt, index) =>
      index === 0 ? { ...attempt, merchantOrderIdentifier: "" } : attempt,
    );
    const failedPayment = passingInput.purchaseAttempts.map((attempt, index) =>
      index === 1 ? { ...attempt, paymentSucceeded: false } : attempt,
    );

    expect(evaluateDemoRelease({ ...passingInput, purchaseAttempts: twoAttempts }).gates.pravaPurchases.status).toBe("fail");
    expect(evaluateDemoRelease({ ...passingInput, purchaseAttempts: missingOrder }).gates.pravaPurchases.status).toBe("fail");
    expect(evaluateDemoRelease({ ...passingInput, purchaseAttempts: failedPayment }).gates.pravaPurchases.status).toBe("fail");
  });

  it("requires visibly labelled outage and historical fallback rehearsal", () => {
    const report = evaluateDemoRelease({
      ...passingInput,
      outageRehearsal: { ...passingInput.outageRehearsal, currentAttemptDistinguished: false },
    });

    expect(report.gates.outageFallback.status).toBe("fail");
  });

  it("enforces the 95 percent extraction and 30 out of 30 ranking gates", () => {
    expect(
      evaluateDemoRelease({
        ...passingInput,
        policyContract: { ...policyScore, accuracy: 0.949 },
      }).gates.extractionContract.status,
    ).toBe("fail");
    expect(
      evaluateDemoRelease({
        ...passingInput,
        rankingContract: { correctScenarios: 29, totalScenarios: 30 },
      }).gates.rankingContract.status,
    ).toBe("fail");
  });

  it("distinguishes consumer success, failure, and inconclusive outcomes", () => {
    expect(evaluateDemoRelease(passingInput).consumerValidation.classification).toBe("success");
    expect(
      evaluateDemoRelease({
        ...passingInput,
        consumerValidation: { recentBuyerCount: 10, sellerSwitches: 2, usageIntentions: 4 },
      }).consumerValidation.classification,
    ).toBe("failure");
    expect(
      evaluateDemoRelease({
        ...passingInput,
        consumerValidation: { recentBuyerCount: 10, sellerSwitches: 4, usageIntentions: 4 },
      }).consumerValidation.classification,
    ).toBe("inconclusive");
  });

  it("does not pass when excluded scope enters the seven-step flow", () => {
    const report = evaluateDemoRelease({
      ...passingInput,
      scope: { sevenStepFlowCompleted: true, excludedScopeIntroduced: true },
    });

    expect(report.overall).toBe("fail");
    expect(report.gates.scope.status).toBe("fail");
  });
});
