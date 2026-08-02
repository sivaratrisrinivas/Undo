import { beforeEach, describe, expect, it } from "vitest";

import type {
  EvidenceReview,
  EvidenceSnapshot,
  PolicyAssessment,
  ReviewedEvidenceCache,
} from "../domain";
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
        remedyWindow: { kind: "known" as const, days: 7, startsAt: "delivered" as const, requiredAction: "request_submitted" as const },
        returnTransport: "self_ship",
        reversalCost: { kind: "unstated" },
        materialConditions: [
          {
            detail: "Keep the Product sealed.",
            citation: { quote: "Policy text", sourceUrl: "https://merchant.example/policy" },
          },
        ],
        supplementaryRemedies: [],
        quote: "Policy text",
        citations: [
          ...[
            "remedy",
            "window",
            "product_condition",
            "return_transport",
            "buyer_paid_fees",
          ].map((fact) => ({
            fact: fact as PolicyAssessment["citations"][number]["fact"],
            quote: "Policy text",
            sourceUrl: "https://merchant.example/policy",
          })),
          {
            fact: "remedy",
            quote: "Policy text",
            sourceUrl: "https://merchant.example/policy",
          },
        ],
      },
    } satisfies EvidenceReview;
    const cache = { snapshots: [], reviews: [review] } satisfies ReviewedEvidenceCache;

    await repository.saveReview(review);
    await repository.saveCache(cache);

    const reloaded = createBrowserEvidenceRepository(localStorage);
    expect(await reloaded.findReview(review.fingerprint)).toEqual(review);
    expect(await reloaded.findReview("sha256:changed-content")).toBeUndefined();
    expect(await reloaded.loadCache({} as never)).toEqual(cache);

    const knownFieldDuplicate = {
      ...review,
      fingerprint: "sha256:known-field-duplicate",
      policy: {
        ...review.policy,
        citations: [
          ...review.policy.citations,
          { fact: "window" as const, quote: "Policy text", sourceUrl: "https://merchant.example/policy" },
        ],
      },
    } satisfies EvidenceReview;
    localStorage.setItem("undo.evidence-reviews.v1", JSON.stringify([knownFieldDuplicate]));
    expect(await reloaded.findReview(knownFieldDuplicate.fingerprint)).toBeUndefined();

    const contaminatedReview = {
      ...review,
      fingerprint: "sha256:contaminated-review",
      policy: { ...review.policy, paymentCredential: "review-secret-canary" },
    };
    await repository.saveReview(contaminatedReview);
    expect(localStorage.getItem("undo.evidence-reviews.v1")).not.toContain("review-secret-canary");
    expect(await reloaded.findReview(contaminatedReview.fingerprint)).toBeUndefined();
  });

  it("rejects cached text that no longer matches its fingerprint", async () => {
    const originalText = "Original official wording.";
    const snapshot = {
      offerId: "headphone-zone",
      merchant: "Headphone Zone",
      sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
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

  it("rejects contaminated cache snapshots and never writes their private fields", async () => {
    const exactText = "A complete official policy snapshot.";
    const snapshot = {
      offerId: "headphone-zone" as const,
      merchant: "Headphone Zone",
      sourceUrl: "https://www.headphonezone.in/pages/help-center-returns-exchanges",
      scope: { kind: "product" as const, value: "Sennheiser HD 560S" },
      collectedAt: "2026-08-02T09:00:00.000Z",
      exactText,
      fingerprint: await fingerprintEvidenceText(exactText),
      retrievedVia: "senso" as const,
      retrievalState: "current" as const,
      fullAddress: "cache-secret-canary",
    };
    const repository = createBrowserEvidenceRepository(localStorage);

    await repository.saveCache({ snapshots: [snapshot], reviews: [] });

    expect(localStorage.getItem("undo.reviewed-evidence-cache.v1")).toBeNull();
    expect(localStorage.getItem("undo.reviewed-evidence-cache.v1") ?? "").not.toContain("cache-secret-canary");

    localStorage.setItem(
      "undo.reviewed-evidence-cache.v1",
      JSON.stringify({
        snapshots: [{ ...snapshot, fullAddress: "cache-secret-canary" }],
        reviews: [],
      }),
    );
    expect(await repository.loadCache({} as never)).toBeUndefined();
  });
});
