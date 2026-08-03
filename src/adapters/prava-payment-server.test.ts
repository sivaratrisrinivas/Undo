import { describe, expect, it, vi } from "vitest";

import { SUPPORTED_OFFERS, SUPPORTED_PRODUCT, type PravaCheckoutRequest } from "../domain.ts";
import {
  createPravaPaymentSession,
  pollPravaPaymentCredential,
  reportPravaPaymentStatus,
} from "./prava-payment-server.ts";

const env = {
  PRAVA_API_BASE_URL: "https://sandbox.api.prava.space",
  PRAVA_SECRET_KEY: "sk_test_secret",
  PRAVA_DEMO_USER_ID: "undo-solo-team",
  PRAVA_DEMO_USER_EMAIL: "solo@undo.demo",
};

const request: PravaCheckoutRequest = {
  authorizationId: "authorization-001",
  expiresAt: "2026-08-03T12:10:00.000Z",
  product: SUPPORTED_PRODUCT,
  quantity: 1,
  offer: SUPPORTED_OFFERS[0]!,
  destinationReference: "destination-ref-prava-default",
  maximumTotalInr: 12_990,
  paymentMethod: "prava_one_time_prepaid",
};

describe("Prava hosted sandbox payment boundary", () => {
  it("creates one exact INR session without exposing the secret in the body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      session_id: "sess_demo_001",
      iframe_url: "https://checkout.prava.space/s/sess_demo_001",
      expires_at: "2026-08-03T12:10:00.000Z",
    }), { status: 201 }));

    await expect(createPravaPaymentSession(request, env, fetcher)).resolves.toEqual({
      sessionId: "sess_demo_001",
      iframeUrl: "https://checkout.prava.space/s/sess_demo_001",
      expiresAt: "2026-08-03T12:10:00.000Z",
    });
    const init = fetcher.mock.calls[0]?.[1];
    const body = init?.body;
    if (typeof body !== "string") throw new Error("Expected JSON session body");
    expect(JSON.parse(body)).toMatchObject({
      user_id: "undo-solo-team",
      total_amount: "12990.00",
      currency: "INR",
      external_order_ref: "authorization-001",
      integration_type: "full_checkout",
      purchase_context: [{
        merchant_details: { name: "Headphone Zone", url: "https://www.headphonezone.in" },
        product_details: [{ product_id: "headphone-zone", quantity: 1 }],
      }],
    });
    expect(body).not.toContain(env.PRAVA_SECRET_KEY);
  });

  it("keeps generated credentials server-side and makes them consumable once", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      session_id: "sess_demo_001",
      status: "awaiting_result",
      transactions: [{
        status: "awaiting_result",
        line_items: [{
          txn_ref_id: "tli_001",
          merchant_name: "Headphone Zone",
          total_amount: "12990.00",
          token: "4111111111111111",
          dynamic_cvv: "123",
          expiry_month: "12",
          expiry_year: "2027",
        }],
      }],
    }), { status: 200 }));

    const result = await pollPravaPaymentCredential("sess_demo_001", request, env, fetcher);
    expect(result._tag).toBe("ready");
    if (result._tag !== "ready") return;
    expect(String(result.credential)).toBe("[REDACTED Prava checkout credential]");
    expect(result.credential.take()).toEqual({
      token: "4111111111111111",
      cryptogram: "123",
      expiryMonth: "12",
      expiryYear: "2027",
    });
    expect(result.credential.take()).toBeUndefined();
  });

  it("reports a confirmed checkout and leaves an unknown outcome unresolved", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "confirmed",
    }), { status: 200 }));
    await reportPravaPaymentStatus("sess_demo_001", "tli_001", {
      _tag: "submitted",
      paymentStatus: "successful",
      merchantOrderIdentifier: "order-001",
      confirmedTotalInr: 12_990,
    }, env, fetcher);
    const reportBody = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof reportBody !== "string") throw new Error("Expected JSON report body");
    expect(JSON.parse(reportBody)).toMatchObject({
      txn_ref_id: "tli_001",
      txn_status: "APPROVED",
      response_code: "00",
    });

    await reportPravaPaymentStatus("sess_demo_002", "tli_002", {
      _tag: "submitted",
      paymentStatus: "unknown",
      merchantOrderIdentifier: null,
      confirmedTotalInr: null,
      failureReason: "Checkout timed out",
    }, env, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
