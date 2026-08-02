import { describe, expect, it } from "vitest";

import { SUPPORTED_OFFERS, SUPPORTED_PRODUCT } from "../domain";
import {
  checkoutWithPrava,
  OneTimePravaCheckoutCredential,
  parsePravaCheckoutRequest,
  parsePravaQuoteRequest,
  quoteOffersWithPrava,
  type PravaCommandRunner,
} from "./prava-shopping-server";

function jsonOutput(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

function credential() {
  return new OneTimePravaCheckoutCredential({
    token: "server-only-token",
    cryptogram: "server-only-cryptogram",
    expiryMonth: "12",
    expiryYear: "2028",
  });
}

describe("Prava shopping server boundary", () => {
  it("verifies exact catalog variants and returns reconciled INR checkout totals", async () => {
    const commands: Array<ReadonlyArray<string>> = [];
    const runner: PravaCommandRunner = (args) => {
      commands.push(args);
      const merchantIndex = args.indexOf("--merchant") + 1;
      const merchant = args[merchantIndex];
      if (args[1] === "product") {
        const headphoneZone = merchant === "headphonezone.in";
        return Promise.resolve(jsonOutput({
          product: {
            id: headphoneZone
              ? "gid://shopify/Product/4807978942527"
              : "gid://shopify/Product/8076382404682",
            merchant,
            description: headphoneZone
              ? "Sennheiser HD 560S Black BOX CONTENTS standard cable 2 Year Warranty warranty in India"
              : "Sennheiser HD 560S Black detachable cable with 6.3mm adapter",
            variants: [{
              id: headphoneZone
                ? "gid://shopify/ProductVariant/33115065450559"
                : "gid://shopify/ProductVariant/43111211499594",
              merchantDomain: merchant,
              available: true,
              currency: "INR",
              priceAmount: headphoneZone ? 1_299_000 : 1_398_900,
            }],
          },
        }));
      }
      return Promise.resolve(jsonOutput({
        merchant,
        checkout_session_id: `ches_${merchant}`,
        expires_at: "2026-08-02T18:00:00.000Z",
        final_price: { amount: merchant === "headphonezone.in" ? "13290.00" : "13989.00", currency: "INR" },
        price_breakdown: {
          subtotal_cents: merchant === "headphonezone.in" ? 1_299_000 : 1_398_900,
          shipping_cents: merchant === "headphonezone.in" ? 40_000 : 0,
          tax_cents: 0,
        },
      }));
    };

    const result = await quoteOffersWithPrava(SUPPORTED_OFFERS, "addr_home1", runner);

    expect(result).toMatchObject({
      _tag: "ok",
      value: [
        {
          offerId: "headphone-zone",
          itemTotalInr: 12_990,
          deliveryInr: 400,
          taxesInr: 0,
          appliedDiscounts: [{ amountInr: 100 }],
          totalInr: 13_290,
          purchaseAvailable: true,
        },
        {
          offerId: "concept-kart",
          totalInr: 13_989,
          purchaseAvailable: true,
        },
        {
          offerId: "flipkart",
          purchaseAvailable: false,
        },
      ],
    });
    const quoteCommands = commands.filter((args) => args[1] === "quote");
    expect(quoteCommands).toHaveLength(2);
    expect(quoteCommands.every((args) => args.includes("--yes"))).toBe(true);
    expect(quoteCommands.every((args) => args.includes("addr_home1"))).toBe(true);
  });

  it("omits an address id when the buyer confirms the Prava default destination", async () => {
    const commands: Array<ReadonlyArray<string>> = [];
    const runner: PravaCommandRunner = (args) => {
      commands.push(args);
      if (args[1] === "product") {
        return Promise.resolve(jsonOutput({ product: { id: "changed", merchant: "headphonezone.in" } }));
      }
      throw new Error("Quote must not run for an unverified product");
    };

    const result = await quoteOffersWithPrava(
      [SUPPORTED_OFFERS[0]].filter((offer) => offer !== undefined),
      "destination-ref-prava-default",
      runner,
    );

    expect(result).toMatchObject({ _tag: "ok", value: [{ purchaseAvailable: false }] });
    expect(commands).toHaveLength(1);
  });

  it("rejects browser requests that alter curated offers or send personal destinations", () => {
    expect(() => parsePravaQuoteRequest({
      offers: SUPPORTED_OFFERS,
      destinationReference: "addr_home1",
    })).not.toThrow();
    expect(() => parsePravaQuoteRequest({
      offers: SUPPORTED_OFFERS,
      destinationReference: "123 Example Street",
    })).toThrow("Invalid Prava quote request");
    expect(() => parsePravaCheckoutRequest({
      authorizationId: "authorization-extra-field",
      expiresAt: "2026-08-02T18:00:00.000Z",
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer: SUPPORTED_OFFERS[0],
      destinationReference: "destination-ref-prava-default",
      maximumTotalInr: 13_500,
      paymentMethod: "prava_one_time_prepaid",
      token: "must-not-cross-this-boundary",
    })).toThrow("Invalid Prava checkout request");
    expect(() => parsePravaQuoteRequest({
      offers: [{ ...SUPPORTED_OFFERS[0], seller: "changed" }, ...SUPPORTED_OFFERS.slice(1)],
      destinationReference: "addr_home1",
    })).toThrow("Invalid Prava quote request");
  });

  it("submits the exact authorized sandbox checkout and requires payment success plus an order id", async () => {
    const commands: Array<ReadonlyArray<string>> = [];
    const runner: PravaCommandRunner = (args) => {
      commands.push(args);
      if (args[1] === "product") {
        return Promise.resolve(jsonOutput({
          product: {
            id: "gid://shopify/Product/4807978942527",
            merchant: "headphonezone.in",
            description: "Sennheiser HD 560S Black BOX CONTENTS standard cable 2 Year Warranty warranty in India",
            variants: [{
              id: "gid://shopify/ProductVariant/33115065450559",
              merchantDomain: "headphonezone.in",
              available: true,
              currency: "INR",
              priceAmount: 1_299_000,
            }],
          },
        }));
      }
      if (args[1] === "quote") {
        return Promise.resolve(jsonOutput({
          merchant: "headphonezone.in",
          checkout_session_id: "ches_authorized_001",
          expires_at: "2026-08-02T18:00:00.000Z",
          final_price: { amount: "13290.00", currency: "INR" },
          price_breakdown: {
            subtotal_cents: 1_299_000,
            shipping_cents: 40_000,
            tax_cents: 0,
          },
        }));
      }
      return Promise.resolve(jsonOutput({
        success: true,
        data: { status: "paid", order_id: "merchant-order-001" },
      }));
    };
    const request = parsePravaCheckoutRequest({
      authorizationId: "authorization-001",
      expiresAt: "2026-08-02T18:00:00.000Z",
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer: SUPPORTED_OFFERS[0],
      destinationReference: "destination-ref-prava-default",
      maximumTotalInr: 13_500,
      paymentMethod: "prava_one_time_prepaid",
    });

    const checkoutCredential = credential();
    const beforeExpiry = () => Date.parse("2026-08-02T17:00:00.000Z");
    const result = await checkoutWithPrava(request, checkoutCredential, runner, beforeExpiry);
    const replay = await checkoutWithPrava(request, checkoutCredential, runner, beforeExpiry);

    expect(result).toEqual({
      _tag: "submitted",
      paymentStatus: "successful",
      merchantOrderIdentifier: "merchant-order-001",
      confirmedTotalInr: 13_290,
    });
    const checkoutCommand = commands.find((args) => args[1] === "checkout");
    expect(checkoutCommand).toContain("ches_authorized_001");
    expect(checkoutCommand).toContain("--yes");
    expect(commands.filter((args) => args[1] === "checkout")).toHaveLength(1);
    expect(replay).toMatchObject({
      _tag: "not_submitted",
      explanation: "The one-time Prava checkout credential was already consumed",
    });
    expect(JSON.stringify(request)).not.toMatch(/"(?:token|cryptogram|cvv|cardNumber|phone|street)"/i);
  });

  it("does not call checkout when the fresh total exceeds the authorized maximum", async () => {
    const commands: Array<ReadonlyArray<string>> = [];
    const runner: PravaCommandRunner = (args) => {
      commands.push(args);
      if (args[1] === "product") {
        return Promise.resolve(jsonOutput({
          product: {
            id: "gid://shopify/Product/4807978942527",
            merchant: "headphonezone.in",
            description: "Sennheiser HD 560S Black BOX CONTENTS standard cable 2 Year Warranty warranty in India",
            variants: [{ id: "gid://shopify/ProductVariant/33115065450559", merchantDomain: "headphonezone.in", available: true, currency: "INR", priceAmount: 1_299_000 }],
          },
        }));
      }
      return Promise.resolve(jsonOutput({
        merchant: "headphonezone.in",
        checkout_session_id: "ches_too_expensive",
        expires_at: "2026-08-02T18:00:00.000Z",
        final_price: { amount: "14000.00", currency: "INR" },
        price_breakdown: { subtotal_cents: 1_400_000, shipping_cents: 0, tax_cents: 0 },
      }));
    };

    const result = await checkoutWithPrava(parsePravaCheckoutRequest({
      authorizationId: "authorization-002",
      expiresAt: "2026-08-02T18:00:00.000Z",
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer: SUPPORTED_OFFERS[0],
      destinationReference: "destination-ref-prava-default",
      maximumTotalInr: 13_500,
      paymentMethod: "prava_one_time_prepaid",
    }), credential(), runner, () => Date.parse("2026-08-02T17:00:00.000Z"));

    expect(result).toMatchObject({ _tag: "not_submitted", reason: "blocked_by_price", confirmedTotalInr: 14_000 });
    expect(commands.some((args) => args[1] === "checkout")).toBe(false);
  });

  it("does not consume the credential or submit when authorization expires during fresh quote preparation", async () => {
    const commands: Array<ReadonlyArray<string>> = [];
    const expiresAt = "2026-08-02T18:00:00.000Z";
    let clockMilliseconds = Date.parse("2026-08-02T17:59:00.000Z");
    const runner: PravaCommandRunner = (args) => {
      commands.push(args);
      if (args[1] === "product") {
        return Promise.resolve(jsonOutput({
          product: {
            id: "gid://shopify/Product/4807978942527",
            merchant: "headphonezone.in",
            description: "Sennheiser HD 560S Black BOX CONTENTS standard cable 2 Year Warranty warranty in India",
            variants: [{ id: "gid://shopify/ProductVariant/33115065450559", merchantDomain: "headphonezone.in", available: true, currency: "INR", priceAmount: 1_299_000 }],
          },
        }));
      }
      if (args[1] === "quote") {
        clockMilliseconds = Date.parse(expiresAt);
        return Promise.resolve(jsonOutput({
          merchant: "headphonezone.in",
          checkout_session_id: "ches_expired_after_prepare",
          expires_at: "2026-08-02T18:30:00.000Z",
          final_price: { amount: "13290.00", currency: "INR" },
          price_breakdown: { subtotal_cents: 1_329_000, shipping_cents: 0, tax_cents: 0 },
        }));
      }
      return Promise.resolve(jsonOutput({ success: true, data: { status: "paid", order_id: "must-not-submit" } }));
    };
    const checkoutCredential = credential();
    const result = await checkoutWithPrava(
      parsePravaCheckoutRequest({
        authorizationId: "authorization-expired-after-prepare",
        expiresAt,
        product: SUPPORTED_PRODUCT,
        quantity: 1,
        offer: SUPPORTED_OFFERS[0],
        destinationReference: "destination-ref-prava-default",
        maximumTotalInr: 13_500,
        paymentMethod: "prava_one_time_prepaid",
      }),
      checkoutCredential,
      runner,
      () => clockMilliseconds,
    );

    expect(result).toMatchObject({
      _tag: "not_submitted",
      reason: "purchase_unavailable",
      confirmedTotalInr: 13_290,
    });
    if (result._tag === "not_submitted") expect(result.explanation).toMatch(/expired/i);
    expect(commands.some((args) => args[1] === "checkout")).toBe(false);
    expect(checkoutCredential.take()).toEqual({
      token: "server-only-token",
      cryptogram: "server-only-cryptogram",
      expiryMonth: "12",
      expiryYear: "2028",
    });
  });

  it("keeps timeout and missing order confirmation ambiguous", async () => {
    const baseRequest = parsePravaCheckoutRequest({
      authorizationId: "authorization-003",
      expiresAt: "2026-08-02T18:00:00.000Z",
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer: SUPPORTED_OFFERS[0],
      destinationReference: "destination-ref-prava-default",
      maximumTotalInr: 15_000,
      paymentMethod: "prava_one_time_prepaid",
    });
    const runnerFor = (checkoutOutput: ReturnType<typeof jsonOutput> & { readonly timedOut?: boolean }): PravaCommandRunner =>
      (args) => {
        if (args[1] === "product") return Promise.resolve(jsonOutput({
          product: {
            id: "gid://shopify/Product/4807978942527",
            merchant: "headphonezone.in",
            description: "Sennheiser HD 560S Black BOX CONTENTS standard cable 2 Year Warranty warranty in India",
            variants: [{ id: "gid://shopify/ProductVariant/33115065450559", merchantDomain: "headphonezone.in", available: true, currency: "INR", priceAmount: 1_299_000 }],
          },
        }));
        if (args[1] === "quote") return Promise.resolve(jsonOutput({
          merchant: "headphonezone.in",
          checkout_session_id: "ches_ambiguous",
          expires_at: "2026-08-02T18:00:00.000Z",
          final_price: { amount: "13290.00", currency: "INR" },
          price_breakdown: { subtotal_cents: 1_329_000, shipping_cents: 0, tax_cents: 0 },
        }));
        return Promise.resolve(checkoutOutput);
      };
    const missingOrder = await checkoutWithPrava(
      baseRequest,
      credential(),
      runnerFor(jsonOutput({ success: true, data: { status: "paid" } })),
      () => Date.parse("2026-08-02T17:00:00.000Z"),
    );
    const timeout = await checkoutWithPrava(
      baseRequest,
      credential(),
      runnerFor({ exitCode: 1, stdout: "", stderr: "", timedOut: true }),
      () => Date.parse("2026-08-02T17:00:00.000Z"),
    );

    expect(missingOrder).toMatchObject({ _tag: "submitted", paymentStatus: "unknown", merchantOrderIdentifier: null });
    expect(timeout).toMatchObject({ _tag: "submitted", paymentStatus: "unknown", merchantOrderIdentifier: null });
  });
});
