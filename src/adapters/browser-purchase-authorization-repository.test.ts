import { describe, expect, it } from "vitest";

import {
  createBrowserPurchaseAuthorizationRepository,
  type AuthorizationLockManager,
} from "./browser-purchase-authorization-repository";

class SequentialLockManager implements AuthorizationLockManager {
  private readonly tails = new Map<string, Promise<void>>();

  async request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(name, previous.then(() => current));
    await previous;
    try {
      return await callback();
    } finally {
      release?.();
    }
  }
}

describe("browser Purchase Authorization repository", () => {
  it("persists state across instances and permits one atomic active transition", async () => {
    const id = "authorization-browser-repository";
    localStorage.removeItem(`undo:purchase-authorization:${id}`);
    const locks = new SequentialLockManager();
    const first = createBrowserPurchaseAuthorizationRepository(localStorage, locks);
    const stored = {
      authorizationSnapshot: '{"id":"authorization-browser-repository"}',
      assessmentSnapshot: '{"premiumLimitInr":2000}',
      state: "active" as const,
    };
    expect(await first.create(id, stored)).toBe("created");

    const reconstructed = createBrowserPurchaseAuthorizationRepository(localStorage, locks);
    const transitions = await Promise.all([
      first.transition(id, stored.authorizationSnapshot, "used"),
      reconstructed.transition(id, stored.authorizationSnapshot, "used"),
    ]);

    expect(transitions.sort()).toEqual(["updated", "used"]);
    expect(await reconstructed.read(id, stored.authorizationSnapshot)).toEqual({
      _tag: "ok",
      value: { ...stored, state: "used" },
    });
  });

  it("atomically activates exactly one pending registration", async () => {
    const id = "authorization-browser-pending-registration";
    localStorage.removeItem(`undo:purchase-authorization:${id}`);
    const locks = new SequentialLockManager();
    const first = createBrowserPurchaseAuthorizationRepository(localStorage, locks);
    const stored = {
      authorizationSnapshot: '{"id":"authorization-browser-pending-registration"}',
      assessmentSnapshot: '{"premiumLimitInr":2000}',
      state: "pending_registration" as const,
    };
    expect(await first.create(id, stored)).toBe("created");

    const reconstructed = createBrowserPurchaseAuthorizationRepository(localStorage, locks);
    const transitions = await Promise.all([
      first.transition(id, stored.authorizationSnapshot, "active"),
      reconstructed.transition(id, stored.authorizationSnapshot, "active"),
    ]);

    expect(transitions.sort()).toEqual(["active", "updated"]);
    expect(await reconstructed.read(id, stored.authorizationSnapshot)).toEqual({
      _tag: "ok",
      value: { ...stored, state: "active" },
    });
  });

  it.each(["invalidated", "used"] as const)(
    "keeps terminal %s authorizations terminal when activation is attempted",
    async (state) => {
      const id = `authorization-browser-terminal-${state}`;
      localStorage.removeItem(`undo:purchase-authorization:${id}`);
      const locks = new SequentialLockManager();
      const repository = createBrowserPurchaseAuthorizationRepository(localStorage, locks);
      const stored = {
        authorizationSnapshot: `{"id":"${id}"}`,
        assessmentSnapshot: '{"premiumLimitInr":2000}',
        state,
      } as const;
      expect(await repository.create(id, stored)).toBe("created");

      expect(await repository.transition(id, stored.authorizationSnapshot, "active")).toBe(state);
      expect(await repository.read(id, stored.authorizationSnapshot)).toEqual({
        _tag: "ok",
        value: stored,
      });
    },
  );

  it("accepts pending registration and rejects unknown persisted states", async () => {
    const pendingId = "authorization-browser-parser-pending";
    const invalidId = "authorization-browser-parser-invalid";
    localStorage.removeItem(`undo:purchase-authorization:${pendingId}`);
    localStorage.removeItem(`undo:purchase-authorization:${invalidId}`);
    const repository = createBrowserPurchaseAuthorizationRepository(
      localStorage,
      new SequentialLockManager(),
    );
    const pending = {
      authorizationSnapshot: '{"id":"authorization-browser-parser-pending"}',
      assessmentSnapshot: '{"premiumLimitInr":2000}',
      state: "pending_registration" as const,
    };
    expect(await repository.create(pendingId, pending)).toBe("created");
    expect(await repository.read(pendingId, pending.authorizationSnapshot)).toEqual({
      _tag: "ok",
      value: pending,
    });

    localStorage.setItem(
      `undo:purchase-authorization:${invalidId}`,
      JSON.stringify({
        authorizationSnapshot: '{"id":"authorization-browser-parser-invalid"}',
        assessmentSnapshot: '{"premiumLimitInr":2000}',
        state: "unexpected",
      }),
    );
    expect(
      await repository.read(invalidId, '{"id":"authorization-browser-parser-invalid"}'),
    ).toEqual({ _tag: "invalid" });
  });
});
