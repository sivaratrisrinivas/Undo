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
});
