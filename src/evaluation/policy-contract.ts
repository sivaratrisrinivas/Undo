import { POLICY_FACTS, type EvidenceSnapshot, type PolicyAssessment, type PolicyFact } from "../domain";

/** One scored field in the five-field extraction contract. */
export type PolicyField = PolicyFact;

/** One synthetic scorer fixture and its expected extraction. */
export type PolicyAnswerKeyEntry = {
  readonly documentId: string;
  readonly demoOffer: boolean;
  readonly evidence: EvidenceSnapshot;
  readonly expected: PolicyAssessment;
};

/** An extraction result associated with its frozen document. */
export type PolicyContractExtraction = {
  readonly documentId: string;
  readonly policy: PolicyAssessment;
};

/** Release-gate metrics produced by the all-or-nothing contract scorer. */
export type PolicyContractScore = {
  readonly passedFields: number;
  readonly totalFields: number;
  readonly accuracy: number;
  readonly correctAbstention: boolean;
  readonly noUnsupportedReturnClaims: boolean;
  readonly demoFieldsAndCitationsCorrect: boolean;
  readonly meetsAccuracyThreshold: boolean;
};

/** Provenance and authorization decision for the deployed extraction contract. */
export type PolicyContractRelease = {
  readonly corpus: "synthetic" | "human_reviewed_official";
  readonly purchaseEnabled: boolean;
};

/** Production remains closed until independent model outputs pass an official human-reviewed corpus. */
export const POLICY_CONTRACT_RELEASE: PolicyContractRelease = {
  corpus: "synthetic",
  purchaseEnabled: false,
};

function citation(policy: PolicyAssessment, fact: PolicyField) {
  return policy.citations.filter((candidate) => candidate.fact === fact);
}

function canonicalCitations(citations: ReturnType<typeof citation>): string {
  return JSON.stringify(
    [...citations].sort((left, right) =>
      `${left.sourceUrl}\u0000${left.quote}`.localeCompare(`${right.sourceUrl}\u0000${right.quote}`),
    ),
  );
}

function supportingDetails(policy: PolicyAssessment): string {
  return JSON.stringify(
    [
      ...policy.materialConditions.map((condition) => ({
        kind: "condition",
        detail: condition.detail,
        citation: condition.citation,
      })),
      ...policy.supplementaryRemedies.map((remedy) => ({
        kind: remedy.kind,
        detail: remedy.detail,
        citation: remedy.citation,
      })),
    ].sort((left, right) =>
      `${left.kind}\u0000${left.detail}\u0000${left.citation.sourceUrl}\u0000${left.citation.quote}`.localeCompare(
        `${right.kind}\u0000${right.detail}\u0000${right.citation.sourceUrl}\u0000${right.citation.quote}`,
      ),
    ),
  );
}

function fieldValue(policy: PolicyAssessment, fact: PolicyField): unknown {
  return {
    remedy: { changeOfMind: policy.changeOfMind, defect: policy.defect },
    window: policy.remedyWindow,
    product_condition: policy.productCondition,
    return_transport: policy.returnTransport,
    buyer_paid_fees: policy.reversalCost,
  }[fact];
}

function fieldPasses(
  entry: PolicyAnswerKeyEntry,
  actual: PolicyAssessment | undefined,
  fact: PolicyField,
): boolean {
  if (actual === undefined) return false;
  const expectedCitations = citation(entry.expected, fact);
  const actualCitations = citation(actual, fact);
  const supportingDetailsMatch =
    fact !== "remedy" || supportingDetails(actual) === supportingDetails(entry.expected);
  const supportingDetailsAreCited =
    fact !== "remedy" ||
    [...actual.materialConditions.map((condition) => condition.citation),
      ...actual.supplementaryRemedies.map((remedy) => remedy.citation)].every(
      (citation) =>
        entry.evidence.exactText.includes(citation.quote) &&
        citation.sourceUrl === entry.evidence.sourceUrl,
    );
  return (
    JSON.stringify(fieldValue(actual, fact)) === JSON.stringify(fieldValue(entry.expected, fact)) &&
    expectedCitations.length > 0 &&
    actualCitations.length > 0 &&
    canonicalCitations(actualCitations) === canonicalCitations(expectedCitations) &&
    actualCitations.every(
      (citation) =>
        entry.evidence.exactText.includes(citation.quote) &&
        citation.sourceUrl === entry.evidence.sourceUrl,
    ) &&
    supportingDetailsMatch &&
    supportingDetailsAreCited
  );
}

function expectsAbstention(entry: PolicyAnswerKeyEntry, fact: PolicyField): boolean {
  const value = fieldValue(entry.expected, fact);
  if (typeof value === "string") return value === "unclear";
  if (typeof value !== "object" || value === null) return false;
  // SAFETY: The object/null checks establish a record for discriminant inspection only.
  const record = value as Record<string, unknown>;
  return record.kind === "unclear" || record.changeOfMind === "unclear" || record.defect === "unclear";
}

/** Scores five fields all-or-nothing, including every nested value and exact citation. */
export function scorePolicyExtractionContract(
  answerKey: ReadonlyArray<PolicyAnswerKeyEntry>,
  extractions: ReadonlyArray<PolicyContractExtraction>,
): PolicyContractScore {
  const facts: ReadonlyArray<PolicyField> = POLICY_FACTS;
  const extractionByDocument = new Map(
    extractions.map((extraction) => [extraction.documentId, extraction.policy]),
  );
  const results = answerKey.flatMap((entry) =>
    facts.map((fact) => ({
      entry,
      fact,
      passes: fieldPasses(entry, extractionByDocument.get(entry.documentId), fact),
    })),
  );
  const passedFields = results.filter((result) => result.passes).length;
  const totalFields = results.length;
  const correctAbstention = results
    .filter((result) => expectsAbstention(result.entry, result.fact))
    .every((result) => result.passes);
  const noUnsupportedReturnClaims = answerKey.every((entry) => {
    const actual = extractionByDocument.get(entry.documentId);
    return (
      actual === undefined ||
      actual.changeOfMind === "none" ||
      actual.changeOfMind === "unclear" ||
      actual.changeOfMind === entry.expected.changeOfMind
    );
  });
  const demoFieldsAndCitationsCorrect = results
    .filter((result) => result.entry.demoOffer)
    .every((result) => result.passes);
  const accuracy = totalFields === 0 ? 0 : passedFields / totalFields;
  return {
    passedFields,
    totalFields,
    accuracy,
    correctAbstention,
    noUnsupportedReturnClaims,
    demoFieldsAndCitationsCorrect,
    meetsAccuracyThreshold:
      accuracy >= 0.95 &&
      correctAbstention &&
      noUnsupportedReturnClaims &&
      demoFieldsAndCitationsCorrect,
  };
}
