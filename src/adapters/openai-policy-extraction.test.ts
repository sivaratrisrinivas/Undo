import { describe, expect, it, vi } from "vitest";

import type { EvidenceSnapshot, PolicyAssessment } from "../domain";
import { createOpenAiPolicyExtractionAdapter } from "./openai-policy-extraction";

const evidenceSnapshot: EvidenceSnapshot = {
    offerId: "headphone-zone",
    merchant: "Headphone Zone",
    sourceUrl: "https://merchant.example/policy",
    scope: { kind: "product", value: "Sennheiser HD 560S" },
    collectedAt: "2026-08-01T10:30:00.000Z",
    exactText: "Returns are allowed within seven days.",
    fingerprint: "sha256:test",
    retrievedVia: "senso",
    retrievalState: "current",
};
const evidence: ReadonlyArray<EvidenceSnapshot> = [evidenceSnapshot];

const policy = {
  offerId: "headphone-zone",
  changeOfMind: "unclear",
  defect: "none",
  remedyWindow: { kind: "unclear" },
  productCondition: "unclear",
  returnTransport: "unclear",
  reversalCost: { kind: "unstated" },
  materialConditions: [],
  supplementaryRemedies: [],
  quote: "Returns are allowed within seven days.",
  citations: [
    "remedy",
    "window",
    "product_condition",
    "return_transport",
    "buyer_paid_fees",
  ].map((fact) => ({
    fact: fact as PolicyAssessment["citations"][number]["fact"],
    quote: evidenceSnapshot.exactText,
    sourceUrl: evidenceSnapshot.sourceUrl,
  })),
} as const satisfies PolicyAssessment;

describe("browser OpenAI policy extraction boundary", () => {
  it("sends Policy Evidence only and returns server-validated policies", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ policies: [policy], model: "gpt-test" }), { status: 200 }),
    );
    const adapter = createOpenAiPolicyExtractionAdapter({ fetcher });

    await expect(adapter.extractPolicies(evidence, "trace-openai-1234")).resolves.toEqual({
      _tag: "ok",
      value: [policy],
    });
    expect(adapter.modelVersion()).toBe("openai/gpt-test");
    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBe("/api/policy-extraction");
    expect(request?.[1]?.body).toBe(JSON.stringify({ evidence }));
    expect(new Headers(request?.[1]?.headers).get("X-Undo-Trace-Id")).toBe(
      "trace-openai-1234",
    );
  });

  it("maps an invalid or unavailable response to the OpenAI dependency failure", async () => {
    const adapter = createOpenAiPolicyExtractionAdapter({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 })),
    });

    const result = await adapter.extractPolicies(evidence);

    expect(result._tag).toBe("err");
    if (result._tag === "err") expect(result.error.dependency).toBe("openai");
  });
});
