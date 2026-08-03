import { describe, expect, it } from "vitest";

import { SUPPORTED_OFFERS, SUPPORTED_PRODUCT } from "../domain.ts";
import { createMemoryCheckoutStateStore } from "./checkout-state.ts";
import { handleUndoApi } from "./undo-api.ts";

describe("Undo server API", () => {
  it("registers a valid Purchase Authorization once", async () => {
    const state = createMemoryCheckoutStateStore();
    const payload = {
      authorizationId: "authorization-vercel-001",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      product: SUPPORTED_PRODUCT,
      quantity: 1,
      offer: SUPPORTED_OFFERS[0],
      destinationReference: "destination-ref-prava-default",
      maximumTotalInr: 13_500,
      paymentMethod: "prava_one_time_prepaid",
    };
    const send = () => handleUndoApi(
      "checkout-authorizations",
      new Request("https://undo.test/api/checkout-authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Undo-Trace-Id": "trace-vercel-001" },
        body: JSON.stringify(payload),
      }),
      { env: {}, state },
    );

    const first = await send();
    expect(first.status).toBe(201);
    const result: unknown = await first.json();
    expect(typeof result === "object" && result !== null && "checkoutGrant" in result).toBe(true);
    expect((await send()).status).toBe(422);
  });

  it("rejects unsupported methods without reaching dependencies", async () => {
    const response = await handleUndoApi(
      "policy-evidence",
      new Request("https://undo.test/api/policy-evidence"),
      { env: {}, state: createMemoryCheckoutStateStore() },
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
