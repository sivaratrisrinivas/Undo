import { describe, expect, it, vi } from "vitest";

import type { EvidenceSnapshot, PolicyAssessment } from "../domain";
import { createOpenAiPolicyExtractionAdapter } from "./openai-policy-extraction";

const evidence: ReadonlyArray<EvidenceSnapshot> = [
  {
    offerId: "headphone-zone",
    merchant: "Headphone Zone",
    sourceUrl: "https://merchant.example/policy",
    scope: { kind: "product", value: "Sennheiser HD 560S" },
    collectedAt: "2026-08-01T10:30:00.000Z",
    exactText: "Returns are allowed within seven days.",
    fingerprint: "sha256:test",
    retrievedVia: "senso",
    retrievalState: "current",
  },
];

const policy = {
  offerId: "headphone-zone",
  changeOfMind: "unclear",
  defect: "none",
  remedyWindow: {
    kind: "unclear",
    days: null,
    startsAt: null,
    requiredAction: null,
  },
  productCondition: "unclear",
  returnTransport: "unclear",
  reversalCost: { kind: "none_stated" },
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
    quote: evidence[0]!.exactText,
    sourceUrl: evidence[0]!.sourceUrl,
  })),
} as const satisfies PolicyAssessment;

describe("browser OpenAI policy extraction boundary", () => {
  it("sends Policy Evidence only and returns server-validated policies", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ policies: [policy], model: "gpt-test" }), { status: 200 }),
    );
    const adapter = createOpenAiPolicyExtractionAdapter({ fetcher });

    await expect(adapter.extractPolicies(evidence)).resolves.toEqual({
      _tag: "ok",
      value: [policy],
    });
    expect(adapter.modelVersion()).toBe("openai/gpt-test");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/policy-extraction",
      expect.objectContaining({ body: JSON.stringify({ evidence }) }),
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
