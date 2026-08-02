import { describe, expect, it } from "vitest";

import { createInMemoryPurchaseAuthorizationRepository } from "./fake-adapters";

describe("in-memory Purchase Authorization repository", () => {
  it("activates exactly one pending registration when competing transitions race", async () => {
    const repository = createInMemoryPurchaseAuthorizationRepository();
    const stored = {
      authorizationSnapshot: '{"id":"authorization-memory-pending-registration"}',
      assessmentSnapshot: '{"premiumLimitInr":2000}',
      state: "pending_registration" as const,
    };
    expect(await repository.create("authorization-memory-pending-registration", stored)).toBe("created");

    const transitions = await Promise.all([
      repository.transition(
        "authorization-memory-pending-registration",
        stored.authorizationSnapshot,
        "active",
      ),
      repository.transition(
        "authorization-memory-pending-registration",
        stored.authorizationSnapshot,
        "active",
      ),
    ]);

    expect(transitions.sort()).toEqual(["active", "updated"]);
    expect(
      await repository.read(
        "authorization-memory-pending-registration",
        stored.authorizationSnapshot,
      ),
    ).toEqual({
      _tag: "ok",
      value: { ...stored, state: "active" },
    });
  });

  it.each(["invalidated", "used"] as const)(
    "never reactivates terminal %s authorizations",
    async (state) => {
      const repository = createInMemoryPurchaseAuthorizationRepository();
      const id = `authorization-memory-terminal-${state}`;
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
});
