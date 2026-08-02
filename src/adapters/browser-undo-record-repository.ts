import type { PreviousSandboxPurchase, UndoRecord } from "../domain";
import type { UndoRecordRepository } from "../workflow";
import type { AuthorizationLockManager } from "./browser-purchase-authorization-repository";

const INDEX_KEY = "undo:records:index:v1";
const RECORD_PREFIX = "undo:record:v1:";

type RecordStorage = Pick<Storage, "getItem" | "setItem">;

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || finiteNonNegative(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validEvidenceSnapshot(value: unknown): boolean {
  const evidence = object(value);
  const scope = object(evidence?.scope);
  return evidence !== undefined && scope !== undefined &&
    hasOnlyKeys(evidence, [
      "offerId", "merchant", "sourceUrl", "scope", "collectedAt", "exactText", "fingerprint",
      "retrievedVia", "retrievalState",
    ]) && hasOnlyKeys(scope, ["kind", "value"]) &&
    (evidence.offerId === "headphone-zone" || evidence.offerId === "concept-kart" || evidence.offerId === "flipkart") &&
    typeof evidence.merchant === "string" && typeof evidence.sourceUrl === "string" &&
    (scope.kind === "product" || scope.kind === "category") && typeof scope.value === "string" &&
    typeof evidence.collectedAt === "string" && Number.isFinite(Date.parse(evidence.collectedAt)) &&
    typeof evidence.exactText === "string" && typeof evidence.fingerprint === "string" &&
    evidence.retrievedVia === "senso" &&
    (evidence.retrievalState === "current" || evidence.retrievalState === "cached" ||
      evidence.retrievalState === "stale");
}

function parseStoredRecord(serialized: string | null): UndoRecord | undefined {
  if (serialized === null) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    const record = object(value);
    const product = object(record?.product);
    const recommendation = object(record?.recommendation);
    const versions = object(record?.versions);
    const previousPurchase = record?.previousSandboxPurchase === undefined
      ? undefined
      : object(record.previousSandboxPurchase);
    const validOutcome = record?.outcome === "purchased" || record?.outcome === "buyer_declined" ||
      record?.outcome === "blocked_by_policy" || record?.outcome === "blocked_by_price" ||
      record?.outcome === "purchase_unavailable" || record?.outcome === "outcome_unknown";
    const validAuthorization = record?.authorizationState === "not_requested" ||
      record?.authorizationState === "authorized_not_submitted" ||
      record?.authorizationState === "used_without_submission" || record?.authorizationState === "used";
    const validPravaStatus = record?.pravaStatus === "not_submitted" ||
      record?.pravaStatus === "payment_succeeded" || record?.pravaStatus === "confirmed_failure" ||
      record?.pravaStatus === "outcome_unknown";
    if (
      record === undefined || product === undefined || recommendation === undefined || versions === undefined ||
      !hasOnlyKeys(record, [
        "id", "createdAt", "outcome", "product", "selectedMerchant", "selectedSeller",
        "confirmedCheckoutTotalInr", "premiumLimitInr", "destinationReference", "evidence",
        "recommendation", "authorizationId", "authorizationState", "approvedMaximumTotalInr",
        "pravaStatus", "merchantOrderIdentifier", "previousSandboxPurchase", "blockingReason",
        "assumptions", "versions",
      ]) ||
      !hasOnlyKeys(product, ["manufacturer", "model", "variant", "condition", "bundleContents", "warrantyRegion"]) ||
      !hasOnlyKeys(recommendation, ["rankedOfferIds", "selectedOfferId", "selection", "rankingRules"]) ||
      !hasOnlyKeys(versions, ["policySchema", "extractionPrompt", "model", "rankingRules"]) ||
      (previousPurchase !== undefined &&
        !hasOnlyKeys(previousPurchase, ["purchasedAt", "merchantOrderIdentifier"])) ||
      typeof record.id !== "string" || record.id.trim() === "" ||
      typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
      !validOutcome ||
      !["manufacturer", "model", "variant", "condition", "bundleContents", "warrantyRegion"]
        .every((key) => typeof product[key] === "string") ||
      !nullableString(record.selectedMerchant) || !nullableString(record.selectedSeller) ||
      !nullableFinite(record.confirmedCheckoutTotalInr) || !finiteNonNegative(record.premiumLimitInr) ||
      typeof record.destinationReference !== "string" || !Array.isArray(record.evidence) ||
      !record.evidence.every(validEvidenceSnapshot) ||
      !Array.isArray(recommendation.rankedOfferIds) ||
      !recommendation.rankedOfferIds.every((id) => typeof id === "string") ||
      !nullableString(recommendation.selectedOfferId) ||
      (recommendation.selection !== "ranking_winner" && recommendation.selection !== "buyer_selected_tie" &&
        recommendation.selection !== "buyer_override" && recommendation.selection !== "none") ||
      recommendation.rankingRules !== "remedy-ranking/1.0" ||
      !nullableString(record.authorizationId) || !validAuthorization ||
      !nullableFinite(record.approvedMaximumTotalInr) || !validPravaStatus ||
      !nullableString(record.merchantOrderIdentifier) ||
      (record.blockingReason !== undefined && typeof record.blockingReason !== "string") ||
      (previousPurchase !== undefined &&
        (typeof previousPurchase.purchasedAt !== "string" ||
          !Number.isFinite(Date.parse(previousPurchase.purchasedAt)) ||
          typeof previousPurchase.merchantOrderIdentifier !== "string" ||
          previousPurchase.merchantOrderIdentifier.trim() === "")) ||
      !Array.isArray(record.assumptions) || !record.assumptions.every((item) => typeof item === "string") ||
      versions.policySchema !== "policy-schema/1.0" ||
      versions.extractionPrompt !== "policy-extraction/1.0" ||
      typeof versions.model !== "string" || versions.rankingRules !== "remedy-ranking/1.0"
    ) return undefined;
    const purchased = record.outcome === "purchased" && record.authorizationState === "used" &&
      record.pravaStatus === "payment_succeeded" &&
      typeof record.authorizationId === "string" && record.authorizationId.trim() !== "" &&
      finiteNonNegative(record.approvedMaximumTotalInr) &&
      finiteNonNegative(record.confirmedCheckoutTotalInr) &&
      typeof record.merchantOrderIdentifier === "string" && record.merchantOrderIdentifier.trim() !== "";
    const unknown = record.outcome === "outcome_unknown" && record.authorizationState === "used" &&
      record.pravaStatus === "outcome_unknown";
    const declined = record.outcome === "buyer_declined" && record.pravaStatus === "not_submitted" &&
      (record.authorizationState === "not_requested" || record.authorizationState === "authorized_not_submitted") &&
      record.merchantOrderIdentifier === null;
    const assessmentBlocked =
      (record.outcome === "blocked_by_policy" || record.outcome === "blocked_by_price" ||
        record.outcome === "purchase_unavailable") &&
      record.authorizationState === "not_requested" && record.pravaStatus === "not_submitted" &&
      record.merchantOrderIdentifier === null;
    const rejectedBeforeSubmission =
      (record.outcome === "blocked_by_price" || record.outcome === "purchase_unavailable") &&
      record.authorizationState === "used_without_submission" && record.pravaStatus === "not_submitted" &&
      record.merchantOrderIdentifier === null;
    const confirmedFailure = record.outcome === "purchase_unavailable" &&
      record.authorizationState === "used" && record.pravaStatus === "confirmed_failure" &&
      record.merchantOrderIdentifier === null;
    if (!purchased && !unknown && !declined && !assessmentBlocked && !rejectedBeforeSubmission && !confirmedFailure) {
      return undefined;
    }
    // SAFETY: Every UndoRecord field used by persistence/history and all lifecycle discriminants are checked above.
    return record as UndoRecord;
  } catch {
    return undefined;
  }
}

function parseIndex(serialized: string | null): ReadonlyArray<string> {
  if (serialized === null) return [];
  const value: unknown = JSON.parse(serialized);
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) {
    throw new Error("Stored Undo Record index is invalid");
  }
  return value;
}

function recordKey(id: string): string {
  return `${RECORD_PREFIX}${encodeURIComponent(id)}`;
}

/** Persists and retrieves parsed, secret-free Undo Records with cross-tab atomic writes. */
export function createBrowserUndoRecordRepository(
  storage: RecordStorage,
  locks: AuthorizationLockManager,
): UndoRecordRepository {
  return {
    async save(record) {
      try {
        return await locks.request(INDEX_KEY, () => {
          const ids = parseIndex(storage.getItem(INDEX_KEY));
          storage.setItem(recordKey(record.id), JSON.stringify(record));
          if (!ids.includes(record.id)) storage.setItem(INDEX_KEY, JSON.stringify([...ids, record.id]));
          return "saved" as const;
        });
      } catch {
        return "unavailable";
      }
    },
    async find(id) {
      try {
        return await locks.request(recordKey(id), () => parseStoredRecord(storage.getItem(recordKey(id))));
      } catch {
        return undefined;
      }
    },
    async latestCompletedPurchase() {
      try {
        return await locks.request(INDEX_KEY, () => {
          const ids = parseIndex(storage.getItem(INDEX_KEY));
          for (let index = ids.length - 1; index >= 0; index -= 1) {
            const id = ids[index];
            if (id === undefined) continue;
            const candidate = parseStoredRecord(storage.getItem(recordKey(id)));
            if (candidate?.outcome === "purchased" && candidate.merchantOrderIdentifier !== null) {
              const purchase: PreviousSandboxPurchase = {
                purchasedAt: candidate.createdAt,
                merchantOrderIdentifier: candidate.merchantOrderIdentifier,
              };
              return purchase;
            }
          }
          return undefined;
        });
      } catch {
        return undefined;
      }
    },
  };
}
