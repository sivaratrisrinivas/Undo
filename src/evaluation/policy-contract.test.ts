import { describe, expect, it } from "vitest";

import { FROZEN_POLICY_ANSWER_KEY } from "./frozen-policy-answer-key";
import { POLICY_CONTRACT_RELEASE, scorePolicyExtractionContract } from "./policy-contract";

describe("15-document policy extraction contract", () => {
  it("proves the scorer accepts a matching synthetic baseline without opening production", () => {
    const answerKeyBaseline = FROZEN_POLICY_ANSWER_KEY.map((entry) => ({
      documentId: entry.documentId,
      policy: entry.expected,
    }));

    expect(scorePolicyExtractionContract(FROZEN_POLICY_ANSWER_KEY, answerKeyBaseline)).toEqual({
      passedFields: 75,
      totalFields: 75,
      accuracy: 1,
      correctAbstention: true,
      noUnsupportedReturnClaims: true,
      demoFieldsAndCitationsCorrect: true,
      meetsAccuracyThreshold: true,
    });
    expect(POLICY_CONTRACT_RELEASE).toEqual({ corpus: "synthetic", purchaseEnabled: false });
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
      meetsAccuracyThreshold: false,
    });
  });

  it("scores every citation when a field needs multiple exact excerpts", () => {
    const entry = FROZEN_POLICY_ANSWER_KEY[0];
    if (entry === undefined) throw new Error("Missing answer-key fixture");
    const firstCitation = entry.expected.citations[0];
    if (firstCitation === undefined) throw new Error("Missing citation fixture");
    const expected = {
      ...entry.expected,
      citations: [...entry.expected.citations, { ...firstCitation, fact: "remedy" as const }],
    };
    const answerKey = [{ ...entry, expected }];
    const matching = [{ documentId: entry.documentId, policy: expected }];
    const missingOne = [{
      documentId: entry.documentId,
      policy: entry.expected,
    }];

    expect(scorePolicyExtractionContract(answerKey, matching)).toMatchObject({
      passedFields: 5,
      totalFields: 5,
      accuracy: 1,
    });
    expect(scorePolicyExtractionContract(answerKey, missingOne).passedFields).toBe(4);
  });

  it("fails the remedy field when a material condition is unsupported", () => {
    const answerKeyBaseline = FROZEN_POLICY_ANSWER_KEY.map((entry) => ({
      documentId: entry.documentId,
      policy: entry.expected,
    }));
    const first = answerKeyBaseline[0];
    if (first === undefined) throw new Error("Missing answer-key fixture");
    const extractions = answerKeyBaseline.map((extraction, index) =>
      index === 0
        ? {
            ...extraction,
            policy: {
              ...extraction.policy,
              materialConditions: [
                {
                  detail: "Unsupported condition",
                  citation: {
                    quote: "unsupported condition",
                    sourceUrl: extraction.policy.citations[0]?.sourceUrl ?? "",
                  },
                },
              ],
            },
          }
        : extraction,
    );

    expect(scorePolicyExtractionContract(FROZEN_POLICY_ANSWER_KEY, extractions)).toMatchObject({
      passedFields: 74,
      meetsAccuracyThreshold: false,
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
      meetsAccuracyThreshold: false,
    });
  });
});
