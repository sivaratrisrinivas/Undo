import { describe, expect, it } from "vitest";

import { SUPPORTED_PRODUCT } from "../domain";
import { retrievePolicyEvidenceFromSenso } from "./senso-evidence-server";

describe("Senso evidence backend", () => {
  it("queries Senso for the configured official source and returns exact chunks", async () => {
    const requests: Request[] = [];
    const fetcher: typeof fetch = (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                content_id: "hpz-policy",
                chunk_index: 1,
                chunk_text: "More exact official wording.",
              },
              { content_id: "unrelated", chunk_index: 0, chunk_text: "Do not include this." },
              {
                content_id: "hpz-policy",
                chunk_index: 0,
                chunk_text: "Exact official return wording.",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
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
          scope: { kind: "product", value: "Sennheiser HD 560S" },
          contentIds: ["hpz-policy"],
        },
      ],
    });

    expect(requests[0]?.url).toBe("https://apiv2.senso.ai/api/v1/org/search/context");
    expect(requests[0]?.headers.get("X-API-Key")).toBe("test-key");
    await expect(requests[0]?.json()).resolves.toEqual({
      query:
        "Return, refund, exchange, replacement, condition, window, transport, and fee terms for Headphone Zone Sennheiser HD 560S",
      max_results: 20,
      content_ids: ["hpz-policy"],
      require_scoped_ids: true,
    });
    expect(response).toEqual({
      documents: [
        {
          offerId: "headphone-zone",
          merchant: "Headphone Zone",
          sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
          scope: { kind: "product", value: "Sennheiser HD 560S" },
          collectedAt: "2026-08-02T09:00:00.000Z",
          exactText: "Exact official return wording.\n\nMore exact official wording.",
        },
      ],
    });
  });

  it("fails before searching when an official source has no configured Senso content IDs", async () => {
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
            contentIds: [],
          },
        ],
      }),
    ).rejects.toThrow("Senso content IDs are not configured for Headphone Zone");
    expect(requestCount).toBe(0);
  });
});
