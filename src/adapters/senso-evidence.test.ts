import { describe, expect, it } from "vitest";

import { SUPPORTED_PRODUCT } from "../domain";
import { createSensoEvidenceAdapter } from "./senso-evidence";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

describe("Senso Policy Evidence adapter", () => {
  it("retrieves official sources without sending buyer checkout data and fingerprints exact text", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = (url, init) => {
      const requestUrl =
        typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      requests.push({ url: requestUrl, init: init ?? {} });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            documents: [
              {
                offerId: "headphone-zone",
                merchant: "Headphone Zone",
                sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
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

    const runtimeProduct = {
      ...SUPPORTED_PRODUCT,
      buyerName: "buyer-secret-canary",
      fullAddress: "full-address-canary",
      paymentData: "payment-data-canary",
      oneTimeCredential: "credential-canary",
    };
    const result = await createSensoEvidenceAdapter({ fetcher }).retrieveEvidence(
      runtimeProduct,
      "trace-senso-1234",
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/api/policy-evidence");
    expect(new Headers(requests[0]?.init.headers).get("X-Undo-Trace-Id")).toBe(
      "trace-senso-1234",
    );
    const requestBody = requests[0]?.init.body;
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body");
    const parsedRequest: unknown = JSON.parse(requestBody) as unknown;
    if (!isRecord(parsedRequest) || !isRecord(parsedRequest.product)) {
      throw new Error("Expected a projected product request");
    }
    expect(parsedRequest).toEqual({ product: SUPPORTED_PRODUCT });
    expect(requestBody).not.toMatch(
      /buyer-secret-canary|full-address-canary|payment-data-canary|credential-canary/i,
    );
    expect(Object.keys(parsedRequest.product)).toEqual([
      "manufacturer",
      "model",
      "variant",
      "condition",
      "bundleContents",
      "warrantyRegion",
    ]);
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
