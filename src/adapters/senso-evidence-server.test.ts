import { describe, expect, it } from "vitest";

import { SUPPORTED_PRODUCT } from "../domain";
import { retrievePolicyEvidenceFromSenso } from "./senso-evidence-server";

describe("Senso evidence backend", () => {
  it("retrieves complete configured KB documents in order and uses the oldest capture time", async () => {
    const requests: Request[] = [];
    const responses = new Map([
      [
        "hpz-policy-node-1",
        {
          id: "hpz-content-1",
          type: "raw",
          processing_status: "complete",
          updated_at: "2026-08-02T09:00:00.000Z",
          text: "Exact official return wording.",
        },
      ],
      [
        "hpz-policy-node-2",
        {
          id: "hpz-content-2",
          type: "raw",
          processing_status: "complete",
          updated_at: "2026-08-02T08:00:00.000Z",
          text: "More exact official wording.",
        },
      ],
    ]);
    const fetcher: typeof fetch = (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const nodeId = new URL(request.url).pathname.split("/").at(-2);
      return Promise.resolve(
        new Response(JSON.stringify(responses.get(nodeId ?? "")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };

    const response = await retrievePolicyEvidenceFromSenso(SUPPORTED_PRODUCT, {
      apiKey: "test-key",
      fetcher,
      now: () => "2026-08-02T09:00:00.000Z",
      sources: [
        {
          offerId: "headphone-zone",
          merchant: "Headphone Zone",
          sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
          scope: { kind: "category", value: "Selected Easy Exchange products" },
          requiredTextMarkers: ["wording."],
          kbNodeIds: ["hpz-policy-node-1", "hpz-policy-node-2"],
        },
      ],
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://apiv2.senso.ai/api/v1/org/kb/nodes/hpz-policy-node-1/content",
      "https://apiv2.senso.ai/api/v1/org/kb/nodes/hpz-policy-node-2/content",
    ]);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(requests.every((request) => request.headers.get("X-API-Key") === "test-key")).toBe(true);
    expect(response).toEqual({
      documents: [
        {
          offerId: "headphone-zone",
          merchant: "Headphone Zone",
          sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
          scope: { kind: "category", value: "Selected Easy Exchange products" },
          collectedAt: "2026-08-02T08:00:00.000Z",
          exactText: "Exact official return wording.\n\nMore exact official wording.",
        },
      ],
    });
  });

  it("rejects a misassigned node even when another node has the expected provenance marker", async () => {
    const payloads = [
      { id: "correct", type: "raw", processing_status: "complete", updated_at: "2026-08-02T08:00:00.000Z", text: "Headphone Zone policy" },
      { id: "wrong", type: "raw", processing_status: "complete", updated_at: "2026-08-02T08:00:00.000Z", text: "Unrelated merchant policy" },
    ];
    let responseIndex = 0;

    await expect(retrievePolicyEvidenceFromSenso(SUPPORTED_PRODUCT, {
      apiKey: "test-key",
      fetcher: () => Promise.resolve(Response.json(payloads[responseIndex++])),
      now: () => "2026-08-02T09:00:00.000Z",
      sources: [{
        offerId: "headphone-zone",
        merchant: "Headphone Zone",
        sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
        scope: { kind: "category", value: "Selected Easy Exchange products" },
        requiredTextMarkers: ["Headphone Zone"],
        kbNodeIds: ["correct-node", "wrong-node"],
      }],
    })).rejects.toThrow("invalid provenance for Headphone Zone");
  });

  it("fails before retrieval when an official source has no configured Senso KB node IDs", async () => {
    let requestCount = 0;
    const fetcher: typeof fetch = () => {
      requestCount += 1;
      return Promise.reject(new Error("Unexpected Senso request"));
    };

    await expect(
      retrievePolicyEvidenceFromSenso(SUPPORTED_PRODUCT, {
        apiKey: "test-key",
        fetcher,
        sources: [
          {
            offerId: "headphone-zone",
            merchant: "Headphone Zone",
            sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
            scope: { kind: "product", value: "Sennheiser HD 560S" },
            requiredTextMarkers: ["Policy"],
            kbNodeIds: [],
          },
        ],
      }),
    ).rejects.toThrow("Senso KB node IDs are not configured for Headphone Zone");
    expect(requestCount).toBe(0);
  });

  it.each([
    ["missing text", { id: "raw-1", type: "raw", processing_status: "complete", updated_at: "2026-08-02T08:00:00.000Z" }],
    ["unfinished processing", { id: "raw-1", type: "raw", processing_status: "processing", updated_at: "2026-08-02T08:00:00.000Z", text: "Policy" }],
    ["invalid capture time", { id: "raw-1", type: "raw", processing_status: "complete", updated_at: "not-a-date", text: "Policy" }],
    ["capture time beyond the allowed clock skew", { id: "raw-1", type: "raw", processing_status: "complete", updated_at: "2026-08-02T09:06:00.000Z", text: "Policy" }],
  ])("rejects %s from the Senso raw-content boundary", async (_case, payload) => {
    await expect(
      retrievePolicyEvidenceFromSenso(SUPPORTED_PRODUCT, {
        apiKey: "test-key",
        fetcher: () => Promise.resolve(Response.json(payload)),
        now: () => "2026-08-02T09:00:00.000Z",
        sources: [
          {
            offerId: "headphone-zone",
            merchant: "Headphone Zone",
            sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
            scope: { kind: "product", value: "Sennheiser HD 560S" },
            requiredTextMarkers: ["Policy"],
            kbNodeIds: ["hpz-policy-node"],
          },
        ],
      }),
    ).rejects.toThrow("Senso returned invalid raw Policy Evidence");
  });
});
