import { loadEnv } from "vite";
import { expect, it } from "vitest";

import { OFFICIAL_EVIDENCE_SOURCES, SUPPORTED_PRODUCT } from "../domain";
import { parseKbNodeIds, retrievePolicyEvidenceFromSenso, type SensoOfficialSource } from "./senso-evidence-server";

const liveTest = process.env.RUN_SENSO_LIVE_TESTS === "1" ? it : it.skip;

liveTest("retrieves complete raw Policy Evidence for every configured official source", async () => {
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

  const apiKey = env.SENSO_API_KEY;
  if (!apiKey) throw new Error("SENSO_API_KEY is not configured");
  expect(sources.every((source) => source.kbNodeIds.length > 0)).toBe(true);
  const allNodeIds = sources.flatMap((source) => source.kbNodeIds);
  expect(new Set(allNodeIds).size).toBe(allNodeIds.length);

  const result = await retrievePolicyEvidenceFromSenso(SUPPORTED_PRODUCT, {
    apiKey,
    sources,
  });

  expect(result.documents).toHaveLength(OFFICIAL_EVIDENCE_SOURCES.length);
  const sourceMetadata = (source: SensoOfficialSource) => ({
    offerId: source.offerId,
    merchant: source.merchant,
    sourceUrl: source.sourceUrl,
    scope: source.scope,
  });
  expect(result.documents.map(({ offerId, merchant, sourceUrl, scope }) => ({
    offerId,
    merchant,
    sourceUrl,
    scope,
  }))).toEqual(sources.map(sourceMetadata));
  for (const document of result.documents) {
    const source = sources.find((candidate) => candidate.offerId === document.offerId);
    expect(source).toBeDefined();
    expect(source?.requiredTextMarkers.every((marker) => document.exactText.includes(marker))).toBe(true);
    expect(document.exactText.trim().length).toBeGreaterThan(100);
    expect(Date.parse(document.collectedAt)).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
  }
});
