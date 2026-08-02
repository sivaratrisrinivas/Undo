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
    const contradictory = { ...completedRecord(), pravaStatus: "not_submitted" as const };
    const repository = createBrowserUndoRecordRepository(storage, locks);

    expect(await repository.save(contradictory)).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    storage.setItem("undo:records:index:v1", JSON.stringify([contradictory.id]));
    storage.setItem("undo:record:v1:undo-record-001", JSON.stringify(contradictory));

    expect(await repository.find(contradictory.id)).toBeUndefined();
    expect(await repository.latestCompletedPurchase()).toBeUndefined();
  });

  it("round-trips every valid workflow lifecycle variant", async () => {
    const base = completedRecord();
    const selectedRecommendation = base.recommendation;
    const assessmentBlocked: UndoRecord = {
      ...base,
      id: "undo-record-blocked",
      outcome: "blocked_by_policy",
      selectedMerchant: null,
      selectedSeller: null,
      confirmedCheckoutTotalInr: null,
      recommendation: { ...selectedRecommendation, rankedOfferIds: [], selectedOfferId: null, selection: "none" },
      authorizationId: null,
      authorizationState: "not_requested",
      approvedMaximumTotalInr: null,
      pravaStatus: "not_submitted",
      merchantOrderIdentifier: null,
    };
    const blockedByPriceWithRankedCandidates: UndoRecord = {
      ...assessmentBlocked,
      id: "undo-record-price-blocked",
      outcome: "blocked_by_price",
      recommendation: {
        ...assessmentBlocked.recommendation,
        rankedOfferIds: ["headphone-zone", "concept-kart"],
      },
    };
    const buyerDeclined: UndoRecord = {
      ...base,
      id: "undo-record-declined",
      outcome: "buyer_declined",
      authorizationId: null,
      authorizationState: "not_requested",
      approvedMaximumTotalInr: null,
      pravaStatus: "not_submitted",
      merchantOrderIdentifier: null,
    };
    const authorizedBuyerDeclined: UndoRecord = {
      ...base,
      id: "undo-record-authorized-declined",
      outcome: "buyer_declined",
      authorizationState: "authorized_not_submitted",
      pravaStatus: "not_submitted",
      merchantOrderIdentifier: null,
    };
    const outcomeUnknown: UndoRecord = {
      ...base,
      id: "undo-record-unknown",
      outcome: "outcome_unknown",
      confirmedCheckoutTotalInr: null,
      authorizationState: "used",
      pravaStatus: "outcome_unknown",
      merchantOrderIdentifier: null,
    };
    const rejectedBeforeSubmission: UndoRecord = {
      ...base,
      id: "undo-record-rejected",
      outcome: "purchase_unavailable",
      authorizationState: "used_without_submission",
      pravaStatus: "not_submitted",
      merchantOrderIdentifier: null,
    };
    const confirmedFailure: UndoRecord = {
      ...base,
      id: "undo-record-failure",
      outcome: "purchase_unavailable",
      authorizationState: "used",
      pravaStatus: "confirmed_failure",
      merchantOrderIdentifier: null,
    };

    for (const record of [
      assessmentBlocked,
      blockedByPriceWithRankedCandidates,
      buyerDeclined,
      authorizedBuyerDeclined,
      outcomeUnknown,
      rejectedBeforeSubmission,
      confirmedFailure,
      base,
    ]) {
      const storage = memoryStorage();
      const repository = createBrowserUndoRecordRepository(storage, locks);
      expect(await repository.save(record)).toBe("saved");
      expect(await repository.find(record.id)).toEqual(record);
    }
  });

  it("rejects ranking_winner records whose selected offer is not ranked first", async () => {
    const storage = memoryStorage();
    const repository = createBrowserUndoRecordRepository(storage, locks);
    const record: UndoRecord = {
      ...completedRecord(),
      id: "undo-record-winner-not-first",
      recommendation: {
        ...completedRecord().recommendation,
        rankedOfferIds: ["concept-kart", "headphone-zone"],
        selectedOfferId: "headphone-zone",
      },
    };

    expect(await repository.save(record)).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    storage.setItem("undo:record:v1:undo-record-winner-not-first", JSON.stringify(record));

    expect(await repository.find(record.id)).toBeUndefined();
  });

  it("rejects ranking_winner records with more than one ranked offer", async () => {
    const storage = memoryStorage();
    const repository = createBrowserUndoRecordRepository(storage, locks);
    const record: UndoRecord = {
      ...completedRecord(),
      id: "undo-record-winner-with-extra-ranked-offer",
      recommendation: {
        ...completedRecord().recommendation,
        rankedOfferIds: ["headphone-zone", "concept-kart"],
        selectedOfferId: "headphone-zone",
      },
    };

    expect(await repository.save(record)).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    storage.setItem("undo:record:v1:undo-record-winner-with-extra-ranked-offer", JSON.stringify(record));

    expect(await repository.find(record.id)).toBeUndefined();
  });

  it("rejects buyer_selected_tie records whose selection is absent from the tie IDs", async () => {
    const storage = memoryStorage();
    const repository = createBrowserUndoRecordRepository(storage, locks);
    const record: UndoRecord = {
      ...completedRecord(),
      id: "undo-record-tie-selection-absent",
      recommendation: {
        ...completedRecord().recommendation,
        rankedOfferIds: ["concept-kart", "flipkart"],
        selectedOfferId: "headphone-zone",
        selection: "buyer_selected_tie",
      },
    };

    expect(await repository.save(record)).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    storage.setItem("undo:record:v1:undo-record-tie-selection-absent", JSON.stringify(record));

    expect(await repository.find(record.id)).toBeUndefined();
  });

  it("rejects buyer_override records with an empty ranking", async () => {
    const storage = memoryStorage();
    const repository = createBrowserUndoRecordRepository(storage, locks);
    const record: UndoRecord = {
      ...completedRecord(),
      id: "undo-record-override-without-ranking",
      recommendation: {
        ...completedRecord().recommendation,
        rankedOfferIds: [],
        selection: "buyer_override",
      },
    };

    expect(await repository.save(record)).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    storage.setItem("undo:record:v1:undo-record-override-without-ranking", JSON.stringify(record));

    expect(await repository.find(record.id)).toBeUndefined();
  });

  it("rejects buyer_override records whose selection remains ranked", async () => {
    const storage = memoryStorage();
    const repository = createBrowserUndoRecordRepository(storage, locks);
    const record: UndoRecord = {
      ...completedRecord(),
      id: "undo-record-override-still-ranked",
      recommendation: {
        ...completedRecord().recommendation,
        rankedOfferIds: ["headphone-zone", "concept-kart"],
        selectedOfferId: "headphone-zone",
        selection: "buyer_override",
      },
    };

    expect(await repository.save(record)).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    storage.setItem("undo:record:v1:undo-record-override-still-ranked", JSON.stringify(record));

    expect(await repository.find(record.id)).toBeUndefined();
  });

  it("rejects duplicate ranked offer IDs on save and load", async () => {
    const storage = memoryStorage();
    const repository = createBrowserUndoRecordRepository(storage, locks);
    const record: UndoRecord = {
      ...completedRecord(),
      id: "undo-record-duplicate-ranking",
      recommendation: {
        ...completedRecord().recommendation,
        rankedOfferIds: ["headphone-zone", "headphone-zone"],
        selection: "buyer_override",
      },
    };

    expect(await repository.save(record)).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    storage.setItem("undo:record:v1:undo-record-duplicate-ranking", JSON.stringify(record));

    expect(await repository.find(record.id)).toBeUndefined();
  });

  it("rejects submitted records whose checkout total exceeds authorization", async () => {
    const base = completedRecord();
    const authorizationMaximum = base.approvedMaximumTotalInr;
    if (authorizationMaximum === null) throw new Error("Test record must have an authorization ceiling");
    const overCeilingTotal = authorizationMaximum + 1;
    const records: ReadonlyArray<UndoRecord> = [
      {
        ...base,
        id: "undo-record-over-ceiling-unknown",
        outcome: "outcome_unknown",
        confirmedCheckoutTotalInr: overCeilingTotal,
        authorizationState: "used",
        pravaStatus: "outcome_unknown",
        merchantOrderIdentifier: null,
      },
      {
        ...base,
        id: "undo-record-over-ceiling-failure",
        outcome: "purchase_unavailable",
        confirmedCheckoutTotalInr: overCeilingTotal,
        authorizationState: "used",
        pravaStatus: "confirmed_failure",
        merchantOrderIdentifier: null,
      },
      {
        ...base,
        id: "undo-record-over-ceiling-purchased",
        outcome: "purchased",
        confirmedCheckoutTotalInr: overCeilingTotal,
        authorizationState: "used",
        pravaStatus: "payment_succeeded",
        merchantOrderIdentifier: "merchant-order-over-ceiling",
      },
    ];

    for (const record of records) {
      const storage = memoryStorage();
      const repository = createBrowserUndoRecordRepository(storage, locks);

      expect(await repository.save(record)).toBe("unavailable");
      expect(storage.values.size).toBe(0);
      storage.setItem("undo:records:index:v1", JSON.stringify([record.id]));
      storage.setItem(`undo:record:v1:${record.id}`, JSON.stringify(record));

      expect(await repository.find(record.id)).toBeUndefined();
      if (record.outcome === "purchased") {
        expect(await repository.latestCompletedPurchase()).toBeUndefined();
      }
    }
  });

  it("rejects negative monetary totals on save and load", async () => {
    const base = completedRecord();
    const records: ReadonlyArray<UndoRecord> = [
      {
        ...base,
        id: "undo-record-negative-confirmed-total",
        confirmedCheckoutTotalInr: -1,
      },
      {
        ...base,
        id: "undo-record-negative-approved-maximum",
        approvedMaximumTotalInr: -1,
      },
      {
        ...base,
        id: "undo-record-unknown-negative-maximum",
        outcome: "outcome_unknown",
        confirmedCheckoutTotalInr: null,
        authorizationState: "used",
        approvedMaximumTotalInr: -1,
        pravaStatus: "outcome_unknown",
        merchantOrderIdentifier: null,
      },
    ];

    for (const record of records) {
      const storage = memoryStorage();
      const repository = createBrowserUndoRecordRepository(storage, locks);

      expect(await repository.save(record)).toBe("unavailable");
      expect(storage.values.size).toBe(0);
      expect(await repository.save(base)).toBe("saved");
      storage.setItem("undo:records:index:v1", JSON.stringify([base.id, record.id]));
      storage.setItem(`undo:record:v1:${record.id}`, JSON.stringify(record));

      expect(await repository.find(record.id)).toBeUndefined();
      expect(await repository.latestCompletedPurchase()).toEqual({
        purchasedAt: base.createdAt,
        merchantOrderIdentifier: base.merchantOrderIdentifier,
      });
    }
  });

  it("rejects unsupported offers on save without writing and on find", async () => {
    const storage = memoryStorage();
    const repository = createBrowserUndoRecordRepository(storage, locks);
    const unsupported = {
      ...completedRecord(),
      id: "undo-record-unsupported",
      recommendation: {
        ...completedRecord().recommendation,
        rankedOfferIds: ["unsupported-offer"],
        selectedOfferId: "unsupported-offer",
      },
    };

    // SAFETY: This fixture intentionally crosses the repository boundary with invalid persisted data.
    expect(await repository.save(unsupported as unknown as UndoRecord)).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    storage.setItem("undo:record:v1:undo-record-unsupported", JSON.stringify(unsupported));

    expect(await repository.find("undo-record-unsupported")).toBeUndefined();
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
    const addressLike = "addr_12_example_street_bengaluru_560001";
    expect(await repository.save({ ...completedRecord(), destinationReference: addressLike })).toBe("unavailable");
    expect(await repository.save({ ...completedRecord(), pravaStatus: "not_submitted" })).toBe("unavailable");
    expect(storage.values.size).toBe(0);
    expect([...storage.values.values()].join(" ")).not.toMatch(/record-secret-canary|nested-address-canary/i);

    storage.setItem("undo:record:v1:undo-record-001", JSON.stringify({
      ...completedRecord(),
      destinationReference: addressLike,
    }));
    expect(await repository.find("undo-record-001")).toBeUndefined();
  });
});
