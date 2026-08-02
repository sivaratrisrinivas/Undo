import {
  POLICY_FACTS,
  SUPPORTED_OFFERS,
  type EvidenceReview,
  type EvidenceSnapshot,
  type PolicyAssessment,
  type ReviewedEvidenceCache,
} from "../domain";
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

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function oneOf<T extends string>(value: unknown, values: ReadonlyArray<T>): T | undefined {
  return typeof value === "string" ? values.find((candidate) => candidate === value) : undefined;
}

function parseSnapshot(value: unknown): EvidenceSnapshot | undefined {
  const snapshot = object(value);
  const scope = object(snapshot?.scope);
  const offerId = oneOf(snapshot?.offerId, SUPPORTED_OFFERS.map((offer) => offer.id));
  const retrievalState = oneOf(snapshot?.retrievalState, ["current", "cached"] as const);
  const scopeKind = oneOf(scope?.kind, ["product", "category"] as const);
  if (
    snapshot === undefined ||
    scope === undefined ||
    offerId === undefined ||
    scopeKind === undefined ||
    retrievalState === undefined ||
    !hasOnlyKeys(snapshot, [
      "offerId", "merchant", "sourceUrl", "scope", "collectedAt", "exactText", "fingerprint",
      "retrievedVia", "retrievalState",
    ]) ||
    !hasOnlyKeys(scope, ["kind", "value"]) ||
    !nonEmptyString(snapshot.merchant) ||
    !nonEmptyString(snapshot.sourceUrl) ||
    !nonEmptyString(snapshot.collectedAt) ||
    !Number.isFinite(Date.parse(snapshot.collectedAt)) ||
    !nonEmptyString(snapshot.exactText) ||
    !nonEmptyString(snapshot.fingerprint) ||
    snapshot.retrievedVia !== "senso" ||
    !nonEmptyString(scope.value)
  ) return undefined;
  return {
    offerId,
    merchant: snapshot.merchant,
    sourceUrl: snapshot.sourceUrl,
    scope: { kind: scopeKind, value: scope.value },
    collectedAt: snapshot.collectedAt,
    exactText: snapshot.exactText,
    fingerprint: snapshot.fingerprint,
    retrievedVia: "senso",
    retrievalState,
  };
}

function parseCitation(value: unknown): PolicyAssessment["citations"][number] | undefined {
  const citation = object(value);
  const fact = oneOf(citation?.fact, POLICY_FACTS);
  if (
    citation === undefined ||
    fact === undefined ||
    !hasOnlyKeys(citation, ["fact", "quote", "sourceUrl"]) ||
    !nonEmptyString(citation.quote) ||
    !nonEmptyString(citation.sourceUrl)
  ) return undefined;
  return { fact, quote: citation.quote, sourceUrl: citation.sourceUrl };
}

function parseEvidenceCitation(value: unknown): { readonly quote: string; readonly sourceUrl: string } | undefined {
  const citation = object(value);
  if (
    citation === undefined ||
    !hasOnlyKeys(citation, ["quote", "sourceUrl"]) ||
    !nonEmptyString(citation.quote) ||
    !nonEmptyString(citation.sourceUrl)
  ) return undefined;
  return { quote: citation.quote, sourceUrl: citation.sourceUrl };
}

function parseWindow(value: unknown): PolicyAssessment["remedyWindow"] | undefined {
  const window = object(value);
  if (window === undefined || !hasOnlyKeys(window, ["kind", "days", "startsAt", "requiredAction"])) {
    return undefined;
  }
  const kind = oneOf(window.kind, ["known", "unclear"] as const);
  if (kind === "known") {
    const startsAt = oneOf(window.startsAt, ["ordered", "purchased", "delivered"] as const);
    const requiredAction = oneOf(
      window.requiredAction,
      ["request_submitted", "item_shipped", "item_received"] as const,
    );
    if (
      typeof window.days === "number" &&
      Number.isSafeInteger(window.days) &&
      window.days > 0 &&
      startsAt !== undefined &&
      requiredAction !== undefined
    ) {
      return { kind, days: window.days, startsAt, requiredAction };
    }
    return undefined;
  }
  if (
    kind === "unclear" &&
    ["days", "startsAt", "requiredAction"].every(
      (key) => !Object.hasOwn(window, key) || window[key] === null,
    )
  ) return { kind };
  return undefined;
}

function parseCost(value: unknown): PolicyAssessment["reversalCost"] | undefined {
  const cost = object(value);
  if (cost === undefined || !hasOnlyKeys(cost, ["kind", "amountInr"])) return undefined;
  const kind = oneOf(cost.kind, ["explicit_none", "known", "unstated", "unpriced_required", "unclear"] as const);
  if (kind === "known") {
    return typeof cost.amountInr === "number" && Number.isFinite(cost.amountInr) && cost.amountInr >= 0
      ? { kind, amountInr: cost.amountInr }
      : undefined;
  }
  return kind !== undefined && (!Object.hasOwn(cost, "amountInr") || cost.amountInr === null)
    ? { kind }
    : undefined;
}

function parseMaterialCondition(value: unknown): PolicyAssessment["materialConditions"][number] | undefined {
  const condition = object(value);
  const citation = parseEvidenceCitation(condition?.citation);
  return condition !== undefined &&
    citation !== undefined &&
    hasOnlyKeys(condition, ["detail", "citation"]) &&
    nonEmptyString(condition.detail)
    ? { detail: condition.detail, citation }
    : undefined;
}

function parseSupplementaryRemedy(
  value: unknown,
): PolicyAssessment["supplementaryRemedies"][number] | undefined {
  const remedy = object(value);
  const citation = parseEvidenceCitation(remedy?.citation);
  const kind = oneOf(
    remedy?.kind,
    ["warranty", "replacement", "pre_dispatch_cancellation", "refund_processing_timing"] as const,
  );
  return remedy !== undefined &&
    citation !== undefined &&
    kind !== undefined &&
    hasOnlyKeys(remedy, ["kind", "detail", "citation"]) &&
    nonEmptyString(remedy.detail)
    ? { kind, detail: remedy.detail, citation }
    : undefined;
}

function parsePolicy(value: unknown): PolicyAssessment | undefined {
  const policy = object(value);
  if (
    policy === undefined ||
    !hasOnlyKeys(policy, [
      "offerId", "changeOfMind", "defect", "productCondition", "remedyWindow", "returnTransport",
      "reversalCost", "materialConditions", "supplementaryRemedies", "quote", "citations",
    ])
  ) return undefined;
  const offerId = oneOf(policy.offerId, SUPPORTED_OFFERS.map((offer) => offer.id));
  const changeOfMind = oneOf(policy.changeOfMind, ["money_back", "store_credit", "none", "unclear"] as const);
  const defect = oneOf(policy.defect, ["replacement", "money_back", "none", "unclear"] as const);
  const productCondition = oneOf(
    policy.productCondition,
    ["unopened_only", "opened_unused", "trial_allowed", "unclear"] as const,
  );
  const returnTransport = oneOf(policy.returnTransport, ["doorstep_pickup", "self_ship", "unclear"] as const);
  const remedyWindow = parseWindow(policy.remedyWindow);
  const reversalCost = parseCost(policy.reversalCost);
  const rawMaterialConditions = Array.isArray(policy.materialConditions)
    ? policy.materialConditions.map(parseMaterialCondition)
    : undefined;
  const rawSupplementaryRemedies = Array.isArray(policy.supplementaryRemedies)
    ? policy.supplementaryRemedies.map(parseSupplementaryRemedy)
    : undefined;
  const rawCitations = Array.isArray(policy.citations) ? policy.citations.map(parseCitation) : undefined;
  if (
    offerId === undefined ||
    changeOfMind === undefined ||
    defect === undefined ||
    productCondition === undefined ||
    remedyWindow === undefined ||
    reversalCost === undefined ||
    returnTransport === undefined ||
    !nonEmptyString(policy.quote) ||
    rawMaterialConditions === undefined ||
    rawMaterialConditions.some((condition) => condition === undefined) ||
    rawSupplementaryRemedies === undefined ||
    rawSupplementaryRemedies.some((remedy) => remedy === undefined) ||
    rawCitations === undefined ||
    rawCitations.some((citation) => citation === undefined)
  ) return undefined;
  const materialConditions = rawMaterialConditions.flatMap((condition) =>
    condition === undefined ? [] : [condition],
  );
  const supplementaryRemedies = rawSupplementaryRemedies.flatMap((remedy) =>
    remedy === undefined ? [] : [remedy],
  );
  const citations = rawCitations.flatMap((citation) => citation === undefined ? [] : [citation]);
  const citationCardinality = POLICY_FACTS.every((fact) => {
    const count = citations.filter((citation) => citation.fact === fact).length;
    const allowsMultiple =
      fact === "remedy" ||
      (fact === "window" && remedyWindow.kind === "unclear") ||
      (fact === "product_condition" && productCondition === "unclear") ||
      (fact === "return_transport" && returnTransport === "unclear") ||
      (fact === "buyer_paid_fees" && reversalCost.kind === "unclear");
    return allowsMultiple ? count > 0 : count === 1;
  });
  if (
    citations.length < POLICY_FACTS.length ||
    !citationCardinality ||
    new Set(citations.map((citation) => citation.fact)).size !== POLICY_FACTS.length
  ) return undefined;
  return {
    offerId,
    changeOfMind,
    defect,
    productCondition,
    remedyWindow,
    returnTransport,
    reversalCost,
    materialConditions,
    supplementaryRemedies,
    quote: policy.quote,
    citations,
  };
}

function parseReview(value: unknown): EvidenceReview | undefined {
  const review = object(value);
  const policy = parsePolicy(review?.policy);
  if (
    review === undefined ||
    policy === undefined ||
    !hasOnlyKeys(review, ["fingerprint", "approvedAt", "policy"]) ||
    !nonEmptyString(review.fingerprint) ||
    !nonEmptyString(review.approvedAt) ||
    !Number.isFinite(Date.parse(review.approvedAt))
  ) return undefined;
  return { fingerprint: review.fingerprint, approvedAt: review.approvedAt, policy };
}

function parseCache(value: unknown): ReviewedEvidenceCache | undefined {
  const cache = object(value);
  if (
    cache === undefined ||
    !hasOnlyKeys(cache, ["snapshots", "reviews"]) ||
    !Array.isArray(cache.snapshots) ||
    !Array.isArray(cache.reviews)
  ) return undefined;
  const snapshots = cache.snapshots.map(parseSnapshot);
  const reviews = cache.reviews.map(parseReview);
  if (snapshots.some((snapshot) => snapshot === undefined) || reviews.some((review) => review === undefined)) {
    return undefined;
  }
  return {
    snapshots: snapshots.flatMap((snapshot) => snapshot === undefined ? [] : [snapshot]),
    reviews: reviews.flatMap((review) => review === undefined ? [] : [review]),
  };
}

function readReviews(storage: Storage): ReadonlyArray<EvidenceReview> {
  const value = readJson(storage, reviewsKey);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const review = parseReview(item);
    return review === undefined ? [] : [review];
  });
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
      const parsed = parseReview(review);
      if (parsed === undefined) return Promise.resolve();
      const reviews = readReviews(storage).filter(
        (candidate) => candidate.fingerprint !== parsed.fingerprint,
      );
      storage.setItem(reviewsKey, JSON.stringify([...reviews, parsed]));
      return Promise.resolve();
    },
    async loadCache() {
      const cache = parseCache(readJson(storage, cacheKey));
      if (cache === undefined) return undefined;
      const fingerprintsMatch = await Promise.all(
        cache.snapshots.map(async (snapshot) =>
          (await fingerprintEvidenceText(snapshot.exactText)) === snapshot.fingerprint,
        ),
      );
      return fingerprintsMatch.every(Boolean) ? cache : undefined;
    },
    async saveCache(cache) {
      const parsed = parseCache(cache);
      if (parsed === undefined) return;
      const fingerprintsMatch = await Promise.all(
        parsed.snapshots.map(async (snapshot) =>
          (await fingerprintEvidenceText(snapshot.exactText)) === snapshot.fingerprint,
        ),
      );
      if (!fingerprintsMatch.every(Boolean)) return;
      storage.setItem(cacheKey, JSON.stringify(parsed));
    },
  };
}
