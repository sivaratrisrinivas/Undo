import { SUPPORTED_OFFERS } from "../domain";
import type {
  EvidenceSnapshot,
  Offer,
  PreviousSandboxPurchase,
  Product,
  UndoRecord,
} from "../domain";
import type { UndoRecordRepository } from "../workflow";
import type { AuthorizationLockManager } from "./browser-purchase-authorization-repository";

const INDEX_KEY = "undo:records:index:v1";
const RECORD_PREFIX = "undo:record:v1:";

type RecordStorage = Pick<Storage, "getItem" | "setItem">;

type UnknownRecord = { readonly [key: string]: unknown };

function object(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    // SAFETY: The runtime object check establishes that property reads are safe; each property is parsed below.
    ? value as UnknownRecord
    : undefined;
}

function hasOnlyKeys(value: UnknownRecord, allowed: ReadonlyArray<string>): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function stringAt(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmptyStringAt(value: unknown): string | undefined {
  const parsed = stringAt(value);
  return parsed === undefined || parsed.trim() === "" ? undefined : parsed;
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

function isOpaqueDestinationReference(value: unknown): value is string {
  return (
    value === "destination-ref-prava-default" ||
    (typeof value === "string" && /^destination-ref-[0-9a-f]{8}$/.test(value))
  );
}

function supportedOfferAt(value: unknown): Offer | undefined {
  return SUPPORTED_OFFERS.find((offer) => offer.id === value);
}

function parseProduct(value: unknown): Product | undefined {
  const product = object(value);
  if (
    product === undefined ||
    !hasOnlyKeys(product, ["manufacturer", "model", "variant", "condition", "bundleContents", "warrantyRegion"])
  ) {
    return undefined;
  }
  const manufacturer = stringAt(product.manufacturer);
  const model = stringAt(product.model);
  const variant = stringAt(product.variant);
  const condition = stringAt(product.condition);
  const bundleContents = stringAt(product.bundleContents);
  const warrantyRegion = stringAt(product.warrantyRegion);
  return manufacturer === undefined || model === undefined || variant === undefined ||
      condition === undefined || bundleContents === undefined || warrantyRegion === undefined
    ? undefined
    : { manufacturer, model, variant, condition, bundleContents, warrantyRegion };
}

function parseEvidenceSnapshot(value: unknown): EvidenceSnapshot | undefined {
  const evidence = object(value);
  const scope = object(evidence?.scope);
  const offer = supportedOfferAt(evidence?.offerId);
  const merchant = stringAt(evidence?.merchant);
  const sourceUrl = stringAt(evidence?.sourceUrl);
  const scopeValue = stringAt(scope?.value);
  const collectedAt = stringAt(evidence?.collectedAt);
  const exactText = stringAt(evidence?.exactText);
  const fingerprint = stringAt(evidence?.fingerprint);
  if (
    evidence === undefined ||
    scope === undefined ||
    offer === undefined ||
    !hasOnlyKeys(evidence, [
      "offerId", "merchant", "sourceUrl", "scope", "collectedAt", "exactText", "fingerprint",
      "retrievedVia", "retrievalState",
    ]) ||
    !hasOnlyKeys(scope, ["kind", "value"]) ||
    merchant === undefined ||
    sourceUrl === undefined ||
    (scope.kind !== "product" && scope.kind !== "category") ||
    scopeValue === undefined ||
    collectedAt === undefined ||
    !Number.isFinite(Date.parse(collectedAt)) ||
    exactText === undefined ||
    fingerprint === undefined ||
    evidence.retrievedVia !== "senso" ||
    (evidence.retrievalState !== "current" &&
      evidence.retrievalState !== "cached" &&
      evidence.retrievalState !== "stale")
  ) {
    return undefined;
  }
  return {
    offerId: offer.id,
    merchant,
    sourceUrl,
    scope: { kind: scope.kind, value: scopeValue },
    collectedAt,
    exactText,
    fingerprint,
    retrievedVia: "senso",
    retrievalState: evidence.retrievalState,
  };
}

function parseEvidence(value: unknown): ReadonlyArray<EvidenceSnapshot> | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: Array<EvidenceSnapshot> = [];
  for (const item of value) {
    const snapshot = parseEvidenceSnapshot(item);
    if (snapshot === undefined) return undefined;
    parsed.push(snapshot);
  }
  return parsed;
}

function parseStrings(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: Array<string> = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    parsed.push(item);
  }
  return parsed;
}

function parsePreviousPurchase(value: unknown): PreviousSandboxPurchase | undefined {
  const purchase = object(value);
  const purchasedAt = stringAt(purchase?.purchasedAt);
  const merchantOrderIdentifier = nonEmptyStringAt(purchase?.merchantOrderIdentifier);
  return purchase !== undefined &&
      hasOnlyKeys(purchase, ["purchasedAt", "merchantOrderIdentifier"]) &&
      purchasedAt !== undefined && Number.isFinite(Date.parse(purchasedAt)) &&
      merchantOrderIdentifier !== undefined
    ? { purchasedAt, merchantOrderIdentifier }
    : undefined;
}

function outcomeAt(value: unknown): UndoRecord["outcome"] | undefined {
  switch (value) {
    case "buyer_declined":
    case "blocked_by_policy":
    case "blocked_by_price":
    case "purchase_unavailable":
    case "purchased":
    case "outcome_unknown":
      return value;
    default:
      return undefined;
  }
}

function authorizationStateAt(value: unknown): UndoRecord["authorizationState"] | undefined {
  switch (value) {
    case "not_requested":
    case "authorized_not_submitted":
    case "used_without_submission":
    case "used":
      return value;
    default:
      return undefined;
  }
}

function pravaStatusAt(value: unknown): UndoRecord["pravaStatus"] | undefined {
  switch (value) {
    case "not_submitted":
    case "payment_succeeded":
    case "confirmed_failure":
    case "outcome_unknown":
      return value;
    default:
      return undefined;
  }
}

function selectionAt(value: unknown): UndoRecord["recommendation"]["selection"] | undefined {
  switch (value) {
    case "ranking_winner":
    case "buyer_selected_tie":
    case "buyer_override":
    case "none":
      return value;
    default:
      return undefined;
  }
}

function isTotalWithinAuthorization(
  confirmedCheckoutTotalInr: number | null,
  approvedMaximumTotalInr: number | null,
): boolean {
  return confirmedCheckoutTotalInr === null ||
    (approvedMaximumTotalInr !== null && confirmedCheckoutTotalInr <= approvedMaximumTotalInr);
}

function parseRecommendation(value: unknown): UndoRecord["recommendation"] | undefined {
  const recommendation = object(value);
  if (
    recommendation === undefined ||
    !hasOnlyKeys(recommendation, ["rankedOfferIds", "selectedOfferId", "selection", "rankingRules"]) ||
    !Array.isArray(recommendation.rankedOfferIds)
  ) {
    return undefined;
  }
  const rankedOfferIds: Array<Offer["id"]> = [];
  const seenOfferIds = new Set<Offer["id"]>();
  for (const value of recommendation.rankedOfferIds) {
    const offer = supportedOfferAt(value);
    if (offer === undefined || seenOfferIds.has(offer.id)) return undefined;
    seenOfferIds.add(offer.id);
    rankedOfferIds.push(offer.id);
  }
  const selectedOffer =
    recommendation.selectedOfferId === null
      ? undefined
      : supportedOfferAt(recommendation.selectedOfferId);
  if (recommendation.selectedOfferId !== null && selectedOffer === undefined) return undefined;
  const selectedOfferId = selectedOffer?.id ?? null;
  const selection = selectionAt(recommendation.selection);
  if (selection === undefined || recommendation.rankingRules !== "remedy-ranking/1.0") {
    return undefined;
  }
  const selectionIsCoherent =
    selection === "ranking_winner"
      ? rankedOfferIds.length === 1 && selectedOfferId !== null && selectedOfferId === rankedOfferIds[0]
      : selection === "buyer_selected_tie"
        ? rankedOfferIds.length >= 2 && selectedOfferId !== null && rankedOfferIds.includes(selectedOfferId)
        : selection === "buyer_override"
          ? rankedOfferIds.length > 0 && selectedOfferId !== null && !rankedOfferIds.includes(selectedOfferId)
          : selectedOfferId === null;
  if (!selectionIsCoherent) return undefined;
  return {
    rankedOfferIds,
    selectedOfferId,
    selection,
    rankingRules: "remedy-ranking/1.0",
  };
}

function parseVersions(value: unknown): UndoRecord["versions"] | undefined {
  const versions = object(value);
  const model = stringAt(versions?.model);
  if (
    versions === undefined ||
    !hasOnlyKeys(versions, ["policySchema", "extractionPrompt", "model", "rankingRules"]) ||
    versions.policySchema !== "policy-schema/1.0" ||
    versions.extractionPrompt !== "policy-extraction/1.0" ||
    model === undefined ||
    versions.rankingRules !== "remedy-ranking/1.0"
  ) {
    return undefined;
  }
  return {
    policySchema: "policy-schema/1.0",
    extractionPrompt: "policy-extraction/1.0",
    model,
    rankingRules: "remedy-ranking/1.0",
  };
}

function parseStoredRecordValue(value: unknown): UndoRecord | undefined {
  const record = object(value);
  if (
    record === undefined ||
    !hasOnlyKeys(record, [
      "id", "createdAt", "outcome", "product", "selectedMerchant", "selectedSeller",
      "confirmedCheckoutTotalInr", "premiumLimitInr", "destinationReference", "evidence",
      "recommendation", "authorizationId", "authorizationState", "approvedMaximumTotalInr",
      "pravaStatus", "merchantOrderIdentifier", "previousSandboxPurchase", "blockingReason",
      "assumptions", "versions",
    ])
  ) {
    return undefined;
  }
  const id = nonEmptyStringAt(record.id);
  const createdAt = stringAt(record.createdAt);
  const outcome = outcomeAt(record.outcome);
  const product = parseProduct(record.product);
  const selectedMerchant = nullableString(record.selectedMerchant) ? record.selectedMerchant : undefined;
  const selectedSeller = nullableString(record.selectedSeller) ? record.selectedSeller : undefined;
  const confirmedCheckoutTotalInr = nullableFinite(record.confirmedCheckoutTotalInr)
    ? record.confirmedCheckoutTotalInr
    : undefined;
  const premiumLimitInr = finiteNonNegative(record.premiumLimitInr) ? record.premiumLimitInr : undefined;
  const evidence = parseEvidence(record.evidence);
  const recommendation = parseRecommendation(record.recommendation);
  const authorizationId = nullableString(record.authorizationId) ? record.authorizationId : undefined;
  const authorizationState = authorizationStateAt(record.authorizationState);
  const approvedMaximumTotalInr = nullableFinite(record.approvedMaximumTotalInr)
    ? record.approvedMaximumTotalInr
    : undefined;
  const pravaStatus = pravaStatusAt(record.pravaStatus);
  const merchantOrderIdentifier = nullableString(record.merchantOrderIdentifier)
    ? record.merchantOrderIdentifier
    : undefined;
  const assumptions = parseStrings(record.assumptions);
  const versions = parseVersions(record.versions);
  const previousSandboxPurchase = record.previousSandboxPurchase === undefined
    ? undefined
    : parsePreviousPurchase(record.previousSandboxPurchase);
  const blockingReason = record.blockingReason === undefined ? undefined : stringAt(record.blockingReason);
  if (
    id === undefined ||
    createdAt === undefined ||
    !Number.isFinite(Date.parse(createdAt)) ||
    outcome === undefined ||
    product === undefined ||
    selectedMerchant === undefined ||
    selectedSeller === undefined ||
    confirmedCheckoutTotalInr === undefined ||
    premiumLimitInr === undefined ||
    !isOpaqueDestinationReference(record.destinationReference) ||
    evidence === undefined ||
    recommendation === undefined ||
    authorizationId === undefined ||
    authorizationState === undefined ||
    approvedMaximumTotalInr === undefined ||
    pravaStatus === undefined ||
    merchantOrderIdentifier === undefined ||
    assumptions === undefined ||
    versions === undefined ||
    (record.previousSandboxPurchase !== undefined && previousSandboxPurchase === undefined) ||
    (record.blockingReason !== undefined && blockingReason === undefined)
  ) {
    return undefined;
  }

  const selectedOffer = recommendation.selectedOfferId === null
    ? undefined
    : supportedOfferAt(recommendation.selectedOfferId);
  const selectedOfferIsCoherent = recommendation.selection === "none"
    ? recommendation.selectedOfferId === null && selectedMerchant === null && selectedSeller === null
    : selectedOffer !== undefined &&
      selectedMerchant === selectedOffer.merchant &&
      selectedSeller === selectedOffer.seller;
  if (!selectedOfferIsCoherent) return undefined;

  const hasSelectedOffer = selectedOffer !== undefined && recommendation.selection !== "none";
  const hasAuthorization = authorizationId !== null && authorizationId.trim() !== "" &&
    approvedMaximumTotalInr !== null;
  const assessmentBlocked =
    (outcome === "blocked_by_policy" || outcome === "blocked_by_price" || outcome === "purchase_unavailable") &&
    authorizationState === "not_requested" &&
    pravaStatus === "not_submitted" &&
    recommendation.selection === "none" &&
    selectedMerchant === null &&
    selectedSeller === null &&
    confirmedCheckoutTotalInr === null &&
    authorizationId === null &&
    approvedMaximumTotalInr === null &&
    merchantOrderIdentifier === null;
  const buyerDeclined = outcome === "buyer_declined" &&
    hasSelectedOffer &&
    confirmedCheckoutTotalInr !== null &&
    pravaStatus === "not_submitted" &&
    merchantOrderIdentifier === null &&
    ((authorizationState === "not_requested" && authorizationId === null && approvedMaximumTotalInr === null) ||
      (authorizationState === "authorized_not_submitted" && hasAuthorization));
  const outcomeUnknown = outcome === "outcome_unknown" &&
    hasSelectedOffer &&
    authorizationState === "used" &&
    pravaStatus === "outcome_unknown" &&
    hasAuthorization &&
    isTotalWithinAuthorization(confirmedCheckoutTotalInr, approvedMaximumTotalInr);
  const rejectedBeforeSubmission =
    (outcome === "blocked_by_price" || outcome === "purchase_unavailable") &&
    hasSelectedOffer &&
    authorizationState === "used_without_submission" &&
    pravaStatus === "not_submitted" &&
    hasAuthorization &&
    merchantOrderIdentifier === null;
  const confirmedFailure = outcome === "purchase_unavailable" &&
    hasSelectedOffer &&
    authorizationState === "used" &&
    pravaStatus === "confirmed_failure" &&
    hasAuthorization &&
    confirmedCheckoutTotalInr !== null &&
    isTotalWithinAuthorization(confirmedCheckoutTotalInr, approvedMaximumTotalInr) &&
    merchantOrderIdentifier === null;
  const purchased = outcome === "purchased" &&
    hasSelectedOffer &&
    authorizationState === "used" &&
    pravaStatus === "payment_succeeded" &&
    hasAuthorization &&
    confirmedCheckoutTotalInr !== null &&
    isTotalWithinAuthorization(confirmedCheckoutTotalInr, approvedMaximumTotalInr) &&
    merchantOrderIdentifier !== null &&
    merchantOrderIdentifier.trim() !== "";
  if (!assessmentBlocked && !buyerDeclined && !outcomeUnknown && !rejectedBeforeSubmission && !confirmedFailure && !purchased) {
    return undefined;
  }

  return {
    id,
    createdAt,
    outcome,
    product,
    selectedMerchant,
    selectedSeller,
    confirmedCheckoutTotalInr,
    premiumLimitInr,
    destinationReference: record.destinationReference,
    evidence,
    recommendation: {
      rankedOfferIds: [...recommendation.rankedOfferIds],
      selectedOfferId: recommendation.selectedOfferId,
      selection: recommendation.selection,
      rankingRules: recommendation.rankingRules,
    },
    authorizationId,
    authorizationState,
    approvedMaximumTotalInr,
    pravaStatus,
    merchantOrderIdentifier,
    ...(previousSandboxPurchase === undefined ? {} : { previousSandboxPurchase }),
    ...(blockingReason === undefined ? {} : { blockingReason }),
    assumptions: [...assumptions],
    versions: {
      policySchema: versions.policySchema,
      extractionPrompt: versions.extractionPrompt,
      model: versions.model,
      rankingRules: versions.rankingRules,
    },
  };
}

function parseStoredRecord(serialized: string | null): UndoRecord | undefined {
  if (serialized === null) return undefined;
  try {
    return parseStoredRecordValue(JSON.parse(serialized));
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
          const projected = parseStoredRecordValue(record);
          if (projected === undefined) return "unavailable" as const;
          const ids = parseIndex(storage.getItem(INDEX_KEY));
          storage.setItem(recordKey(projected.id), JSON.stringify(projected));
          if (!ids.includes(projected.id)) storage.setItem(INDEX_KEY, JSON.stringify([...ids, projected.id]));
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
