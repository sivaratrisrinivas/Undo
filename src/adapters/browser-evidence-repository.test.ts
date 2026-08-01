import { beforeEach, describe, expect, it } from "vitest";

import type { EvidenceReview, EvidenceSnapshot, ReviewedEvidenceCache } from "../domain";
import { createBrowserEvidenceRepository } from "./browser-evidence-repository";
import { fingerprintEvidenceText } from "./senso-evidence";

describe("browser evidence repository", () => {
  beforeEach(() => localStorage.clear());

  it("persists reviews by exact fingerprint and the last complete cache", async () => {
    const repository = createBrowserEvidenceRepository(localStorage);
    const review = {
      fingerprint: "sha256:exact-content",
      approvedAt: "2026-08-02T09:00:00.000Z",
      policy: {
        offerId: "headphone-zone",
        changeOfMind: "money_back",
        defect: "none",
        productCondition: "unopened_only",
        remedyWindow: { days: 7, startsAt: "delivered", requiredAction: "request_submitted" },
        returnTransport: "self_ship",
        reversalCost: { kind: "unstated" },
        materialConditions: ["Keep the Product sealed."],
        quote: "Return within 7 days when sealed.",
        citations: [],
      },
    } satisfies EvidenceReview;
    const cache = { snapshots: [], reviews: [review] } satisfies ReviewedEvidenceCache;

    await repository.saveReview(review);
    await repository.saveCache(cache);

    const reloaded = createBrowserEvidenceRepository(localStorage);
    expect(await reloaded.findReview(review.fingerprint)).toEqual(review);
    expect(await reloaded.findReview("sha256:changed-content")).toBeUndefined();
    expect(await reloaded.loadCache({} as never)).toEqual(cache);
  });

  it("rejects cached text that no longer matches its fingerprint", async () => {
    const originalText = "Original official wording.";
    const snapshot = {
      offerId: "headphone-zone",
      merchant: "Headphone Zone",
      sourceUrl: "https://www.headphonezone.in/pages/returns-refunds",
      scope: { kind: "product", value: "Sennheiser HD 560S" },
      collectedAt: "2026-08-02T09:00:00.000Z",
      exactText: "Changed text inserted into storage.",
      fingerprint: await fingerprintEvidenceText(originalText),
      retrievedVia: "senso",
      retrievalState: "current",
    } satisfies EvidenceSnapshot;
    localStorage.setItem(
      "undo.reviewed-evidence-cache.v1",
      JSON.stringify({ snapshots: [snapshot], reviews: [] }),
    );

    expect(
      await createBrowserEvidenceRepository(localStorage).loadCache({} as never),
    ).toBeUndefined();
  });
});
