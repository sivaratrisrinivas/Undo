import { loadEnv } from "vite";
import { expect, it } from "vitest";

import { fingerprintEvidenceText } from "./senso-evidence";
import {
  extractPoliciesWithOpenAi,
  openAiApiKeyFrom,
} from "./openai-policy-extraction-server";
import {
  parseKbNodeIds,
  retrievePolicyEvidenceFromSenso,
  type SensoOfficialSource,
} from "./senso-evidence-server";
import {
  OFFICIAL_EVIDENCE_SOURCES,
  POLICY_FACTS,
  SUPPORTED_OFFERS,
  SUPPORTED_PRODUCT,
  type EvidenceSnapshot,
} from "../domain";

const liveTest = process.env.RUN_OPENAI_LIVE_TESTS === "1" ? it : it.skip;

const SENSITIVE_OUTPUT_KEY_PATTERN = /^(?:buyer(?:Name|Phone|Address)|fullAddress|payment(?:Credential|Details?|Data|Token|Method)|(?:oneTime)?Credential|authorization(?:State|Id)|authorization)$/i;

function containsSensitiveOutputKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveOutputKey);
  if (value === null || typeof value !== "object") return false;

  return Object.entries(value).some(
    ([key, nestedValue]) => SENSITIVE_OUTPUT_KEY_PATTERN.test(key) || containsSensitiveOutputKey(nestedValue),
  );
}

it("allows policy wording about payment while rejecting sensitive output fields", () => {
  expect(
    containsSensitiveOutputKey({
      fact: "buyer_paid_fees",
      detail: "Eligible refunds return to the original payment account.",
    }),
  ).toBe(false);
  expect(containsSensitiveOutputKey({ paymentCredential: "secret" })).toBe(true);
  expect(containsSensitiveOutputKey({ authorizationId: "authorization-001" })).toBe(true);
});

liveTest("extracts current Senso evidence for every curated Offer through OpenAI", async () => {
  const env = loadEnv("development", process.cwd(), "");
  const nodeIdsByOffer = {
    "headphone-zone": env.SENSO_HEADPHONE_ZONE_KB_NODE_IDS,
    "concept-kart": env.SENSO_CONCEPT_KART_KB_NODE_IDS,
    flipkart: env.SENSO_FLIPKART_KB_NODE_IDS,
  } as const;
  const sources: ReadonlyArray<SensoOfficialSource> = OFFICIAL_EVIDENCE_SOURCES.map((source) => ({
    ...source,
    kbNodeIds: parseKbNodeIds(nodeIdsByOffer[source.offerId]),
  }));
  const apiKey = openAiApiKeyFrom(env.OPENAI_API_KEY);
  if (apiKey === undefined) throw new Error("OPENAI_API_KEY is not configured");
  if (sources.some((source) => source.kbNodeIds.length === 0)) {
    throw new Error("Senso KB node IDs are not configured for every curated Offer");
  }

  const evidenceResult = await retrievePolicyEvidenceFromSenso(SUPPORTED_PRODUCT, {
    apiKey: env.SENSO_API_KEY ?? "",
    sources,
  });
  const evidence: ReadonlyArray<EvidenceSnapshot> = await Promise.all(
    evidenceResult.documents.map(async (document) => ({
      ...document,
      fingerprint: await fingerprintEvidenceText(document.exactText),
      retrievedVia: "senso" as const,
      retrievalState: "current" as const,
    })),
  );
  const extractionOptions = env.OPENAI_POLICY_MODEL === undefined || env.OPENAI_POLICY_MODEL.trim() === ""
    ? { apiKey }
    : { apiKey, model: env.OPENAI_POLICY_MODEL };
  const extraction = await extractPoliciesWithOpenAi(evidence, extractionOptions);
  if (extraction._tag === "err") {
    throw new Error(`OpenAI live extraction failed: ${extraction.error.kind}`);
  }

  expect(extraction.value).toHaveLength(SUPPORTED_OFFERS.length);
  expect(new Set(extraction.value.map((policy) => policy.offerId))).toEqual(
    new Set(SUPPORTED_OFFERS.map((offer) => offer.id)),
  );
  for (const policy of extraction.value) {
    const snapshot = evidence.find((candidate) => candidate.offerId === policy.offerId);
    expect(snapshot).toBeDefined();
    expect(new Set(policy.citations.map((citation) => citation.fact))).toEqual(new Set(POLICY_FACTS));
    expect(policy.citations.every((citation) => snapshot?.exactText.includes(citation.quote))).toBe(true);
  }
  expect(containsSensitiveOutputKey(extraction.value)).toBe(false);
}, 120_000);
