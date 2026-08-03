import { describe, expect, it } from "vitest";

import {
  SUPPORTED_OFFERS,
  SUPPORTED_PRODUCT,
  type CheckoutQuote,
  type PravaCheckoutRequest,
} from "../domain";
import { createPravaShoppingAdapter } from "./prava-shopping";

const quote: CheckoutQuote = {
  offerId: "headphone-zone",
  merchant: "Headphone Zone",
  seller: "Headphone Zone",
  destinationReference: "addr_home1",
  product: SUPPORTED_PRODUCT,
  itemTotalInr: 12_990,
  deliveryInr: 0,
  taxesInr: 0,
  appliedDiscounts: [],
  advertisedDiscounts: [],
  cashbackInr: 0,
  rewardPoints: 0,
  totalInr: 12_990,
  purchaseAvailable: true,
};

describe("Prava shopping browser boundary", () => {
  it("sends only curated offers and an opaque destination to the server", async () => {
    const requests: Array<RequestInit> = [];
    const fetcher: typeof fetch = (_url, init) => {
      requests.push(init ?? {});
      return Promise.resolve(new Response(JSON.stringify({ quotes: [quote] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    };

    const result = await createPravaShoppingAdapter({ fetcher }).quoteOffers(
      SUPPORTED_OFFERS,
      "addr_home1",
      "trace-prava-1234",
    );

    expect(result).toEqual({ _tag: "ok", value: [quote] });
    const body = requests[0]?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(body)).toEqual({ offers: SUPPORTED_OFFERS, destinationReference: "addr_home1" });
    expect(new Headers(requests[0]?.headers).get("X-Undo-Trace-Id")).toBe("trace-prava-1234");
    expect(body).not.toMatch(/secretKey|publishableKey|"street"|"phone"|"card"/i);
  });

  it("rejects malformed quote responses instead of trusting decoded JSON", async () => {
    const fetcher: typeof fetch = () => Promise.resolve(
      new Response(JSON.stringify({ quotes: [{ ...quote, totalInr: "12990" }] }), { status: 200 }),
    );

    const result = await createPravaShoppingAdapter({ fetcher }).quoteOffers(
      SUPPORTED_OFFERS,
      "addr_home1",
    );

    expect(result).toMatchObject({
      _tag: "err",
      error: { dependency: "prava" },
    });
  });

  it("submits only secret-free authorized facts and parses the final Prava result", async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const fetcher: typeof fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      requests.push({ url, init: init ?? {} });
      if (url === "/api/checkout-authorizations") {
        return Promise.resolve(new Response(JSON.stringify({ checkoutGrant: "opaque-server-grant" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        result: {
          _tag: "submitted",
          paymentStatus: "successful",
          merchantOrderIdentifier: "merchant-order-001",
          confirmedTotalInr: 12_990,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    };
    const offer = SUPPORTED_OFFERS[0];
    if (offer === undefined) throw new Error("Missing Offer");
    const request: PravaCheckoutRequest = {
      authorizationId: "authorization-001",
      expiresAt: "2026-08-01T12:10:00.000Z",
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer,
      destinationReference: "addr_home1",
      maximumTotalInr: 12_990,
      paymentMethod: "prava_one_time_prepaid",
    };

    const adapter = createPravaShoppingAdapter({ fetcher });
    expect(await adapter.registerCheckout(request)).toBe("registered");
    const result = await adapter.submitCheckout(request);

    expect(result).toMatchObject({
      paymentStatus: "successful",
      merchantOrderIdentifier: "merchant-order-001",
    });
    expect(requests.map(({ url }) => url)).toEqual(["/api/checkout-authorizations", "/api/checkout"]);
    const registrationBody = requests[0]?.init.body;
    if (typeof registrationBody !== "string") throw new Error("Expected a JSON registration body");
    expect(JSON.parse(registrationBody)).toEqual(request);
    const body = requests[1]?.init.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(body)).toEqual({ request, checkoutGrant: "opaque-server-grant" });
    expect(body).not.toMatch(/"(?:token|cryptogram|cvv|cardNumber|phone|street)"/i);
  });

  it("treats an unreadable pre-payment response as not submitted", async () => {
    let call = 0;
    const fetcher: typeof fetch = () => {
      call += 1;
      return Promise.resolve(call === 1
        ? new Response(JSON.stringify({ checkoutGrant: "opaque-server-grant" }), { status: 201 })
        : new Response(
            JSON.stringify({ result: { _tag: "submitted", paymentStatus: "successful" } }),
            { status: 200 },
          ));
    };
    const offer = SUPPORTED_OFFERS[0];
    if (offer === undefined) throw new Error("Missing Offer");

    const request: PravaCheckoutRequest = {
      authorizationId: "authorization-002",
      expiresAt: "2026-08-01T12:10:00.000Z",
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer,
      destinationReference: "addr_home1",
      maximumTotalInr: 12_990,
      paymentMethod: "prava_one_time_prepaid",
    };
    const adapter = createPravaShoppingAdapter({ fetcher });
    expect(await adapter.registerCheckout(request)).toBe("registered");
    const result = await adapter.submitCheckout(request);

    expect(result).toMatchObject({
      _tag: "not_submitted",
      reason: "purchase_unavailable",
      explanation: "Prava payment approval did not reach merchant checkout",
    });
  });

  it("opens the hosted Prava surface and polls without exposing payment credentials", async () => {
    const offer = SUPPORTED_OFFERS[0];
    if (offer === undefined) throw new Error("Missing Offer");
    const request: PravaCheckoutRequest = {
      authorizationId: "authorization-hosted-001",
      expiresAt: "2026-08-03T12:10:00.000Z",
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer,
      destinationReference: "addr_home1",
      maximumTotalInr: 12_990,
      paymentMethod: "prava_one_time_prepaid",
    };
    const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const fetcher: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push({ url, init: init ?? {} });
      if (url === "/api/checkout-authorizations") {
        return Promise.resolve(new Response(JSON.stringify({ checkoutGrant: "checkout-grant" }), { status: 201 }));
      }
      if (url === "/api/checkout") {
        return Promise.resolve(new Response(JSON.stringify({
          paymentSession: {
            sessionId: "sess_hosted_001",
            iframeUrl: "https://checkout.prava.space/s/sess_hosted_001",
            expiresAt: "2026-08-03T12:10:00.000Z",
            paymentGrant: "payment-grant",
          },
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        status: "completed",
        result: {
          _tag: "submitted",
          paymentStatus: "successful",
          merchantOrderIdentifier: "merchant-order-hosted-001",
          confirmedTotalInr: 12_990,
        },
      }), { status: 200 }));
    };
    const paymentWindow = {
      closed: false,
      location: { href: "about:blank" },
      close() { this.closed = true; },
    };
    const adapter = createPravaShoppingAdapter({
      fetcher,
      openPaymentWindow: () => paymentWindow,
      now: () => Date.parse("2026-08-03T12:00:00.000Z"),
      wait: () => Promise.resolve(),
    });

    adapter.prepareCheckout?.();
    expect(await adapter.registerCheckout(request, "trace-hosted-001")).toBe("registered");
    await expect(adapter.submitCheckout(request, "trace-hosted-001")).resolves.toMatchObject({
      paymentStatus: "successful",
      merchantOrderIdentifier: "merchant-order-hosted-001",
    });
    expect(paymentWindow.location.href).toBe("https://checkout.prava.space/s/sess_hosted_001");
    expect(paymentWindow.closed).toBe(true);
    expect(requests.map(({ url }) => url)).toEqual([
      "/api/checkout-authorizations",
      "/api/checkout",
      "/api/checkout-result",
    ]);
    const pollBody = requests[2]?.init.body;
    if (typeof pollBody !== "string") throw new Error("Expected a JSON poll body");
    expect(JSON.parse(pollBody)).toEqual({
      sessionId: "sess_hosted_001",
      paymentGrant: "payment-grant",
    });
    expect(JSON.stringify(requests)).not.toMatch(/411111|dynamic_cvv|cryptogram/i);
  });

  it("records a typed pre-checkout polling outage as not submitted", async () => {
    const offer = SUPPORTED_OFFERS[0];
    if (offer === undefined) throw new Error("Missing Offer");
    const request: PravaCheckoutRequest = {
      authorizationId: "authorization-hosted-expired",
      expiresAt: "2026-08-03T12:10:00.000Z",
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer,
      destinationReference: "addr_home1",
      maximumTotalInr: 12_990,
      paymentMethod: "prava_one_time_prepaid",
    };
    let call = 0;
    const fetcher: typeof fetch = () => {
      call += 1;
      if (call === 1) return Promise.resolve(new Response(JSON.stringify({ checkoutGrant: "checkout-grant" }), { status: 201 }));
      if (call === 2) return Promise.resolve(new Response(JSON.stringify({
        paymentSession: {
          sessionId: "ses_expiring_001",
          iframeUrl: "https://checkout.prava.space/s/ses_expiring_001",
          expiresAt: "2026-08-03T12:00:02.000Z",
          paymentGrant: "payment-grant",
        },
      }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        error: "Prava payment status unavailable",
        merchantCheckoutMayHaveStarted: false,
      }), { status: 503 }));
    };
    const paymentWindow = {
      closed: false,
      location: { href: "about:blank" },
      close() { this.closed = true; },
    };
    let clock = Date.parse("2026-08-03T12:00:00.000Z");
    const adapter = createPravaShoppingAdapter({
      fetcher,
      openPaymentWindow: () => paymentWindow,
      now: () => clock,
      wait: () => { clock += 2_000; return Promise.resolve(); },
    });

    adapter.prepareCheckout?.();
    expect(await adapter.registerCheckout(request)).toBe("registered");
    const result = await adapter.submitCheckout(request);
    expect(result).toMatchObject({
      _tag: "not_submitted",
      reason: "purchase_unavailable",
    });
    if (result._tag === "not_submitted") {
      expect(result.explanation).toMatch(/expired before merchant checkout/i);
    }
    expect(paymentWindow.closed).toBe(true);
    expect(call).toBe(3);
  });
});
