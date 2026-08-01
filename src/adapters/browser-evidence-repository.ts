import type { EvidenceReview, ReviewedEvidenceCache } from "../domain";
import type { AssessmentAdapters } from "../workflow";

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
  return Array.isArray(value) ? (value as ReadonlyArray<EvidenceReview>) : [];
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
    loadCache() {
      const cache = readJson(storage, cacheKey);
      return Promise.resolve(
        typeof cache === "object" && cache !== null
          ? (cache as ReviewedEvidenceCache)
          : undefined,
      );
    },
    saveCache(cache) {
      storage.setItem(cacheKey, JSON.stringify(cache));
      return Promise.resolve();
    },
  };
}
