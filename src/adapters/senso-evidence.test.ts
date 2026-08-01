import { describe, expect, it } from "vitest";

import { SUPPORTED_PRODUCT } from "../domain";
import { createSensoEvidenceAdapter } from "./senso-evidence";

describe("Senso Policy Evidence adapter", () => {
  it("retrieves official sources without sending buyer checkout data and fingerprints exact text", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            documents: [
              {
                offerId: "headphone-zone",
                merchant: "Headphone Zone",
                sourceUrl: "https://www.headphonezone.in/pages/returns-refunds",
                scope: { kind: "product", value: "Sennheiser HD 560S" },
                collectedAt: "2026-08-02T08:00:00.000Z",
                exactText: "Official return wording.",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };

    const result = await createSensoEvidenceAdapter({ fetcher }).retrieveEvidence(
      SUPPORTED_PRODUCT,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/api/policy-evidence");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ product: SUPPORTED_PRODUCT });
    expect(String(requests[0]?.init.body)).not.toMatch(/destination|address|phone|payment/i);
    expect(result).toMatchObject({
      _tag: "ok",
      value: [
        {
          merchant: "Headphone Zone",
          exactText: "Official return wording.",
          retrievedVia: "senso",
          retrievalState: "current",
        },
      ],
    });
    if (result._tag === "ok") {
      expect(result.value[0]?.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });
});
