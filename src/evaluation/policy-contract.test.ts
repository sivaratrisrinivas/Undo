import { describe, expect, it } from "vitest";

import { FROZEN_POLICY_ANSWER_KEY } from "./frozen-policy-answer-key";
import { scorePolicyExtractionContract } from "./policy-contract";

describe("15-document policy extraction contract", () => {
  it("opens the release gate only at 95% overall with perfect demo fields and citations", () => {
    const recordedHumanReviewedExtractions = FROZEN_POLICY_ANSWER_KEY.map((entry) => ({
      documentId: entry.documentId,
      policy: entry.expected,
    }));

    expect(scorePolicyExtractionContract(FROZEN_POLICY_ANSWER_KEY, recordedHumanReviewedExtractions)).toEqual({
      passedFields: 75,
      totalFields: 75,
      accuracy: 1,
      correctAbstention: true,
      noUnsupportedReturnClaims: true,
      demoFieldsAndCitationsCorrect: true,
      purchaseEnabled: true,
    });
  });

  it("keeps purchase blocked for one wrong demo citation even above 95% overall", () => {
    const extractions = FROZEN_POLICY_ANSWER_KEY.map((entry, index) => ({
      documentId: entry.documentId,
      policy:
        index === 0
          ? {
              ...entry.expected,
              citations: entry.expected.citations.map((citation) =>
                citation.fact === "remedy"
                  ? { ...citation, quote: "unsupported wording" }
                  : citation,
              ),
            }
          : entry.expected,
    }));

    expect(scorePolicyExtractionContract(FROZEN_POLICY_ANSWER_KEY, extractions)).toMatchObject({
      passedFields: 74,
      accuracy: 74 / 75,
      demoFieldsAndCitationsCorrect: false,
      purchaseEnabled: false,
    });
  });

  it("fails unsupported return claims and incorrect abstention", () => {
    const extractions = FROZEN_POLICY_ANSWER_KEY.map((entry) => ({
      documentId: entry.documentId,
      policy:
        entry.documentId === "prompt-injection"
          ? { ...entry.expected, changeOfMind: "money_back" as const }
          : entry.expected,
    }));

    expect(scorePolicyExtractionContract(FROZEN_POLICY_ANSWER_KEY, extractions)).toMatchObject({
      correctAbstention: false,
      noUnsupportedReturnClaims: false,
      purchaseEnabled: false,
    });
  });
});
