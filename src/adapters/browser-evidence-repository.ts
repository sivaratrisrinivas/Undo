import { POLICY_FACTS, type EvidenceReview, type EvidenceSnapshot, type PolicyAssessment } from "../domain";
import type { AssessmentAdapters } from "../workflow";
import { fingerprintEvidenceText } from "./senso-evidence";

const reviewsKey = "undo.evidence-reviews.v1";
const cacheKey = "undo.reviewed-evidence-cache.v1";

function readJson(storage: Storage, key: string): unknown {
  const value = storage.getItem(key);
  if (value === null) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readReviews(storage: Storage): ReadonlyArray<EvidenceReview> {
  const value = readJson(storage, reviewsKey);
  return Array.isArray(value) ? value.filter(isReview) : [];
}

function isSnapshot(value: unknown): value is EvidenceSnapshot {
  if (typeof value !== "object" || value === null) return false;
  // SAFETY: The object/null check above establishes a record for property-by-property validation.
  const snapshot = value as Record<string, unknown>;
  // SAFETY: scope remains unknown in substance and is fully validated below.
  const scope = snapshot.scope as Record<string, unknown> | undefined;
  return (
    typeof snapshot.offerId === "string" &&
    typeof snapshot.merchant === "string" &&
    typeof snapshot.sourceUrl === "string" &&
    typeof snapshot.collectedAt === "string" &&
    typeof snapshot.exactText === "string" &&
    typeof snapshot.fingerprint === "string" &&
    snapshot.retrievedVia === "senso" &&
    (snapshot.retrievalState === "current" || snapshot.retrievalState === "cached") &&
    typeof scope === "object" &&
    scope !== null &&
    (scope.kind === "product" || scope.kind === "category") &&
    typeof scope.value === "string"
  );
}

function isPolicy(value: unknown): value is PolicyAssessment {
  if (typeof value !== "object" || value === null) return false;
  // SAFETY: The object/null check above establishes a record for property-by-property validation.
  const policy = value as Record<string, unknown>;
  // SAFETY: Nested records remain unknown in substance and are fully validated below.
  const window = policy.remedyWindow as Record<string, unknown> | undefined;
  const cost = policy.reversalCost as Record<string, unknown> | undefined;
  return (
    typeof policy.offerId === "string" &&
    ["money_back", "store_credit", "none", "unclear"].includes(String(policy.changeOfMind)) &&
    ["replacement", "money_back", "none", "unclear"].includes(String(policy.defect)) &&
    ["unopened_only", "opened_unused", "trial_allowed", "unclear"].includes(String(policy.productCondition)) &&
    ["doorstep_pickup", "self_ship", "unclear"].includes(String(policy.returnTransport)) &&
    Array.isArray(policy.materialConditions) &&
    policy.materialConditions.every((condition) => {
      if (typeof condition !== "object" || condition === null) return false;
      // SAFETY: The object/null check above establishes a record for validation.
      const entry = condition as Record<string, unknown>;
      // SAFETY: citation remains unknown in substance and is fully validated below.
      const citation = entry.citation as Record<string, unknown> | undefined;
      return (
        typeof entry.detail === "string" &&
        typeof citation === "object" &&
        citation !== null &&
        typeof citation.quote === "string" &&
        typeof citation.sourceUrl === "string"
      );
    }) &&
    Array.isArray(policy.supplementaryRemedies) &&
    policy.supplementaryRemedies.every((remedy) => {
      if (typeof remedy !== "object" || remedy === null) return false;
      // SAFETY: The object/null check above establishes a record for validation.
      const entry = remedy as Record<string, unknown>;
      // SAFETY: citation remains unknown in substance and is fully validated below.
      const citation = entry.citation as Record<string, unknown> | undefined;
      return (
        ["warranty", "replacement", "pre_dispatch_cancellation", "refund_processing_timing"].includes(
          String(entry.kind),
        ) &&
        typeof entry.detail === "string" &&
        typeof citation === "object" &&
        citation !== null &&
        typeof citation.quote === "string" &&
        typeof citation.sourceUrl === "string"
      );
    }) &&
    typeof policy.quote === "string" &&
    Array.isArray(policy.citations) &&
    policy.citations.length === 5 &&
    new Set(
      policy.citations.map((citation) =>
        typeof citation === "object" && citation !== null
          // SAFETY: The object/null check establishes a record used only to read an unknown fact.
          ? String((citation as Record<string, unknown>).fact)
          : "",
      ),
    ).size === 5 &&
    policy.citations.every((citation) => {
      if (typeof citation !== "object" || citation === null) return false;
      // SAFETY: The object/null check above establishes a record for validation.
      const entry = citation as Record<string, unknown>;
      return (
        POLICY_FACTS.some((fact) => fact === entry.fact) &&
        typeof entry.quote === "string" &&
        typeof entry.sourceUrl === "string"
      );
    }) &&
    typeof window === "object" &&
    window !== null &&
    ((window.kind === "known" &&
      typeof window.days === "number" &&
      ["ordered", "purchased", "delivered"].includes(String(window.startsAt)) &&
      ["request_submitted", "item_shipped", "item_received"].includes(
        String(window.requiredAction),
      )) ||
      (window.kind === "unclear" &&
        (window.days === undefined || window.days === null) &&
        (window.startsAt === undefined || window.startsAt === null) &&
        (window.requiredAction === undefined || window.requiredAction === null))) &&
    typeof cost === "object" &&
    cost !== null &&
    ["explicit_none", "known", "unstated", "unpriced_required", "unclear"].includes(String(cost.kind)) &&
    (cost.kind === "known" ? typeof cost.amountInr === "number" : cost.amountInr === undefined)
  );
}

function isReview(value: unknown): value is EvidenceReview {
  if (typeof value !== "object" || value === null) return false;
  // SAFETY: The object/null check above establishes a record for validation.
  const review = value as Record<string, unknown>;
  return (
    typeof review.fingerprint === "string" &&
    typeof review.approvedAt === "string" &&
    isPolicy(review.policy)
  );
}

/** Persists exact-fingerprint human reviews and the most recent complete cache in the browser. */
export function createBrowserEvidenceRepository(
  storage: Storage,
): NonNullable<AssessmentAdapters["evidence"]> {
  return {
    findReview(fingerprint) {
      return Promise.resolve(readReviews(storage).find((review) => review.fingerprint === fingerprint));
    },
    saveReview(review) {
      const reviews = readReviews(storage).filter(
        (candidate) => candidate.fingerprint !== review.fingerprint,
      );
      storage.setItem(reviewsKey, JSON.stringify([...reviews, review]));
      return Promise.resolve();
    },
    async loadCache() {
      const value = readJson(storage, cacheKey);
      if (typeof value !== "object" || value === null) return undefined;
      // SAFETY: The object/null check establishes a record whose fields are validated below.
      const candidate = value as { snapshots?: unknown; reviews?: unknown };
      if (
        !Array.isArray(candidate.snapshots) ||
        !candidate.snapshots.every(isSnapshot) ||
        !Array.isArray(candidate.reviews) ||
        !candidate.reviews.every(isReview)
      ) {
        return undefined;
      }
      const fingerprintsMatch = await Promise.all(
        candidate.snapshots.map(async (snapshot) =>
          (await fingerprintEvidenceText(snapshot.exactText)) === snapshot.fingerprint,
        ),
      );
      return fingerprintsMatch.every(Boolean)
        ? { snapshots: candidate.snapshots, reviews: candidate.reviews }
        : undefined;
    },
    saveCache(cache) {
      storage.setItem(cacheKey, JSON.stringify(cache));
      return Promise.resolve();
    },
  };
}
