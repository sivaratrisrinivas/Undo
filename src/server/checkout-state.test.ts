import { describe, expect, it } from "vitest";

import { createMemoryCheckoutStateStore } from "./checkout-state.ts";

describe("checkout state", () => {
  it("registers and consumes an authorization exactly once", async () => {
    const store = createMemoryCheckoutStateStore();
    const state = { request: "exact-request", grant: "one-time-grant" };

    await expect(store.createAuthorization("auth-1", state, 60)).resolves.toBe(true);
    await expect(store.createAuthorization("auth-1", state, 60)).resolves.toBe(false);
    await expect(store.consumeAuthorization("auth-1", state, 60)).resolves.toBe("consumed");
    await expect(store.consumeAuthorization("auth-1", state, 60)).resolves.toBe("mismatch");
  });

  it("uses an owner-bound payment lock", async () => {
    const store = createMemoryCheckoutStateStore();
    await expect(store.acquirePaymentLock("session-1", "owner-1", 60_000)).resolves.toBe(true);
    await expect(store.acquirePaymentLock("session-1", "owner-2", 60_000)).resolves.toBe(false);
    await store.releasePaymentLock("session-1", "owner-2");
    await expect(store.acquirePaymentLock("session-1", "owner-2", 60_000)).resolves.toBe(false);
    await store.releasePaymentLock("session-1", "owner-1");
    await expect(store.acquirePaymentLock("session-1", "owner-2", 60_000)).resolves.toBe(true);
  });
});
