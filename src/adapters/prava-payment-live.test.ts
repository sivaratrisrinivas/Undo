import { describe, expect, it } from "vitest";
import { loadEnv } from "vite";

import { SUPPORTED_OFFERS, SUPPORTED_PRODUCT, type PravaCheckoutRequest } from "../domain.ts";
import { createPravaPaymentSession } from "./prava-payment-server.ts";

const runLive = process.env.RUN_PRAVA_PAYMENT_LIVE_TESTS === "1";
const liveEnv = loadEnv("development", process.cwd(), "");

describe.skipIf(!runLive)("Prava hosted sandbox session live preflight", () => {
  it("creates a short-lived hosted session without submitting merchant checkout", async () => {
    const offer = SUPPORTED_OFFERS[0];
    if (offer === undefined) throw new Error("Missing supported Offer");
    const request: PravaCheckoutRequest = {
      authorizationId: `live-preflight-${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer,
      destinationReference: "destination-ref-prava-default",
      maximumTotalInr: 12_990,
      paymentMethod: "prava_one_time_prepaid",
    };

    const session = await createPravaPaymentSession(request, liveEnv);

    expect(session.sessionId).toMatch(/^ses{1,2}_/);
    expect(new URL(session.iframeUrl).protocol).toBe("https:");
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
  });
});
