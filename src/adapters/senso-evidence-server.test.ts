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
              { content_id: "hpz-policy", chunk_text: "Exact official return wording." },
              { content_id: "unrelated", chunk_text: "Do not include this." },
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
          sourceUrl: "https://www.headphonezone.in/pages/returns-refunds",
          scope: { kind: "product", value: "Sennheiser HD 560S" },
          contentIds: ["hpz-policy"],
        },
      ],
    });

    expect(requests[0]?.url).toBe("https://apiv2.senso.ai/api/v1/org/search");
    expect(requests[0]?.headers.get("X-API-Key")).toBe("test-key");
    expect(response).toEqual({
      documents: [
        {
          offerId: "headphone-zone",
          merchant: "Headphone Zone",
          sourceUrl: "https://www.headphonezone.in/pages/returns-refunds",
          scope: { kind: "product", value: "Sennheiser HD 560S" },
          collectedAt: "2026-08-02T09:00:00.000Z",
          exactText: "Exact official return wording.",
        },
      ],
    });
  });
});
