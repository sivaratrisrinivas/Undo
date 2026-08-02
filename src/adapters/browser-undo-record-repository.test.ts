import { describe, expect, it } from "vitest";

import { SUPPORTED_PRODUCT, type UndoRecord } from "../domain";
import { createBrowserUndoRecordRepository } from "./browser-undo-record-repository";

function completedRecord(): UndoRecord {
  return {
    id: "undo-record-001",
    createdAt: "2026-08-01T12:00:00.000Z",
    outcome: "purchased",
    product: SUPPORTED_PRODUCT,
    selectedMerchant: "Headphone Zone",
    selectedSeller: "Headphone Zone",
    confirmedCheckoutTotalInr: 14_990,
    premiumLimitInr: 2_000,
    destinationReference: "destination-ref-prava-default",
    evidence: [],
    recommendation: {
      rankedOfferIds: ["headphone-zone"],
      selectedOfferId: "headphone-zone",
      selection: "ranking_winner",
      rankingRules: "remedy-ranking/1.0",
    },
    authorizationId: "authorization-001",
    authorizationState: "used",
    approvedMaximumTotalInr: 14_990,
    pravaStatus: "payment_succeeded",
    merchantOrderIdentifier: "merchant-order-001",
    assumptions: ["Deterministic test record"],
    versions: {
      policySchema: "policy-schema/1.0",
      extractionPrompt: "policy-extraction/1.0",
      model: "fake-openai/deterministic-1",
      rankingRules: "remedy-ranking/1.0",
    },
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    values,
  };
}

const locks = {
  async request<T>(_name: string, callback: () => T | PromiseLike<T>): Promise<T> {
    return await callback();
  },
};

describe("browser Undo Record repository", () => {
  it("persists an auditable record and projects its historical purchase after reconstruction", async () => {
    const storage = memoryStorage();
    const repository = createBrowserUndoRecordRepository(storage, locks);

    expect(await repository.save(completedRecord())).toBe("saved");

    const reconstructed = createBrowserUndoRecordRepository(storage, locks);
    expect(await reconstructed.find("undo-record-001")).toEqual(completedRecord());
    expect(await reconstructed.latestCompletedPurchase()).toEqual({
      purchasedAt: "2026-08-01T12:00:00.000Z",
      merchantOrderIdentifier: "merchant-order-001",
    });
    const serialized = [...storage.values.values()].join("");
    expect(serialized).not.toMatch(/"(?:cardNumber|cvv|cryptogram|token|fullAddress|phone|name)"/i);
  });

  it("does not present malformed storage as a historical purchase", async () => {
    const storage = memoryStorage();
    storage.setItem("undo:records:index:v1", "not-json");

    expect(await createBrowserUndoRecordRepository(storage, locks).latestCompletedPurchase()).toBeUndefined();
  });

  it("rejects a structurally plausible record with a contradictory checkout lifecycle", async () => {
    const storage = memoryStorage();
    const contradictory = { ...completedRecord(), pravaStatus: "not_submitted" };
    storage.setItem("undo:records:index:v1", JSON.stringify([contradictory.id]));
    storage.setItem("undo:record:v1:undo-record-001", JSON.stringify(contradictory));

    const repository = createBrowserUndoRecordRepository(storage, locks);
    expect(await repository.find(contradictory.id)).toBeUndefined();
    expect(await repository.latestCompletedPurchase()).toBeUndefined();
  });

  it("rejects records carrying fields outside the secret-free schema", async () => {
    const storage = memoryStorage();
    const contaminated = { ...completedRecord(), cardNumber: "4111111111111111" };
    storage.setItem("undo:records:index:v1", JSON.stringify([contaminated.id]));
    storage.setItem("undo:record:v1:undo-record-001", JSON.stringify(contaminated));

    expect(await createBrowserUndoRecordRepository(storage, locks).find(contaminated.id)).toBeUndefined();
  });

  it("validates and projects the complete record before writing any contaminated or non-opaque data", async () => {
    const storage = memoryStorage();
    const repository = createBrowserUndoRecordRepository(storage, locks);
    const evidence = {
      offerId: "headphone-zone" as const,
      merchant: "Headphone Zone",
      sourceUrl: "https://merchant.example/policy",
      scope: { kind: "category" as const, value: "Headphones" },
      collectedAt: "2026-08-01T10:00:00.000Z",
      exactText: "Official policy wording.",
      fingerprint: "sha256:record-evidence",
      retrievedVia: "senso" as const,
      retrievalState: "current" as const,
    };

    const contaminatedRecord = { ...completedRecord(), paymentCredential: "record-secret-canary" };
    expect(await repository.save(contaminatedRecord)).toBe("unavailable");
    const contaminatedEvidence = { ...evidence, fullAddress: "nested-address-canary" };
    expect(
      await repository.save({
        ...completedRecord(),
        evidence: [contaminatedEvidence],
      }),
    ).toBe("unavailable");
    expect(
      await repository.save({
        ...completedRecord(),
        destinationReference: "destination-ref-12-example-street-bengaluru-560001",
      }),
    ).toBe("unavailable");
    expect(await repository.save({ ...completedRecord(), pravaStatus: "not_submitted" })).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    expect([...storage.values.values()].join(" ")).not.toMatch(/record-secret-canary|nested-address-canary/i);
  });
});
