import { describe, expect, it } from "vitest";

import { createFakeAdapters, createInMemoryPurchaseAuthorizationRepository } from "./adapters/fake-adapters";
import {
  parsePremiumLimitInr,
  SUPPORTED_PRODUCT,
  type EvidenceReview,
  type ReviewedEvidenceCache,
} from "./domain";
import { AssessmentWorkflow, type AssessmentAdapters, type StoredPurchaseAuthorization } from "./workflow";

function premiumLimit() {
  const parsed = parsePremiumLimitInr("2000");
  if (parsed._tag === "err") throw new Error(parsed.message);
  return parsed.value;
}

async function assessSelected(adapters: AssessmentAdapters) {
  const workflow = new AssessmentWorkflow(adapters);
  const result = await workflow.assess(SUPPORTED_PRODUCT, premiumLimit(), "destination-ref-prava-default");
  if (result._tag === "err") throw new Error(result.error.message);
  if (result.value.ranking._tag !== "winner") throw new Error("Expected a deterministic winner");
  const selection = workflow.selectOffer(result.value, result.value.ranking.offer.offer.id);
  if (selection._tag === "err") throw new Error(selection.reason);
  return { workflow, assessment: result.value, selection: selection.value };
}

async function authorizeSelected(
  workflow: AssessmentWorkflow,
  assessment: Awaited<ReturnType<typeof assessSelected>>["assessment"],
  selection: Awaited<ReturnType<typeof assessSelected>>["selection"],
) {
  const summary = workflow.createApprovalSummary(assessment, selection);
  if (summary._tag === "err") throw new Error(summary.reason);
  const authorization = await workflow.authorizePurchase(
    assessment,
    selection,
    new Set(summary.value.materialWarnings.map((warning) => warning.id)),
  );
  if (authorization._tag === "err") throw new Error(authorization.reason);
  return authorization.value;
}

async function reviewedCache(): Promise<ReviewedEvidenceCache> {
  const source = createFakeAdapters();
  const evidence = await source.senso.retrieveEvidence(SUPPORTED_PRODUCT);
  if (evidence._tag === "err") throw new Error("Expected deterministic evidence");
  const policies = await source.openAi.extractPolicies(evidence.value);
  if (policies._tag === "err") throw new Error("Expected deterministic policies");
  const reviews = evidence.value.map((snapshot): EvidenceReview => {
    const policy = policies.value.find((candidate) => candidate.offerId === snapshot.offerId);
    if (policy === undefined) throw new Error("Expected one policy per Offer");
    return { fingerprint: snapshot.fingerprint, approvedAt: "2026-08-01T11:00:00.000Z", policy };
  });
  return { snapshots: evidence.value, reviews };
}

describe("complete deterministic safety paths", () => {
  it("records a confirmed success through one authorization and one checkout submission", async () => {
    const adapters = createFakeAdapters({
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "successful",
        merchantOrderIdentifier: "safety-success-001",
        confirmedTotalInr: 14_990,
      },
    });
    const selected = await assessSelected(adapters);
    const authorization = await authorizeSelected(selected.workflow, selected.assessment, selected.selection);
    const result = await selected.workflow.checkout({
      authorization,
      assessment: selected.assessment,
      selectedOffer: selected.selection,
      quote: selected.selection.offer.checkoutQuote,
      quantity: 1,
      paymentMethod: "prava_one_time_prepaid",
    });

    expect(result).toMatchObject({
      _tag: "ok",
      value: {
        outcome: "purchased",
        pravaStatus: "payment_succeeded",
        merchantOrderIdentifier: "safety-success-001",
      },
    });
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  });

  it("records an honest buyer refusal without authorization or checkout", async () => {
    const adapters = createFakeAdapters();
    const selected = await assessSelected(adapters);
    const result = await selected.workflow.decline(selected.assessment, selected.selection);

    expect(result).toMatchObject({ _tag: "ok", value: { outcome: "buyer_declined" } });
    expect(adapters.activity.pravaCheckoutRequests).toBe(0);
  });

  it("uses clearly labelled Reviewed Evidence cache during a Senso failure", async () => {
    const cache = await reviewedCache();
    const base = createFakeAdapters({ failSenso: true });
    const adapters: AssessmentAdapters = {
      ...base,
      evidence: {
        ...base.evidence,
        loadCache: () => Promise.resolve(cache),
      },
    };

    const result = await new AssessmentWorkflow(adapters).assess(
      SUPPORTED_PRODUCT,
      premiumLimit(),
      "destination-ref-prava-default",
    );

    expect(result).toMatchObject({ _tag: "ok" });
    if (result._tag === "ok") {
      expect(result.value.offers.every((offer) => offer.evidence.retrievalState === "cached")).toBe(true);
      expect(result.value.offers.every((offer) => offer.evidenceReview.state === "reviewed")).toBe(true);
    }
    expect(base.activity.openAiRequests).toBe(0);
    expect(base.activity.pravaCheckoutRequests).toBe(0);
  });

  it("fails closed on quote or authorization dependency failure with zero checkout submissions", async () => {
    const quoteFailure = createFakeAdapters({ failPravaQuote: true });
    const quoteResult = await new AssessmentWorkflow(quoteFailure).assess(
      SUPPORTED_PRODUCT,
      premiumLimit(),
      "destination-ref-prava-default",
    );
    expect(quoteResult).toMatchObject({ _tag: "err", error: { message: "Checkout quote unavailable" } });
    expect(quoteFailure.activity.pravaCheckoutRequests).toBe(0);

    const base = createFakeAdapters();
    const authorizationFailure: AssessmentAdapters = {
      ...base,
      authorization: {
        ...base.authorization,
        create: () => Promise.resolve("unavailable" as const),
      },
    };
    const selected = await assessSelected(authorizationFailure);
    const summary = selected.workflow.createApprovalSummary(selected.assessment, selected.selection);
    if (summary._tag === "err") throw new Error(summary.reason);
    expect(
      await selected.workflow.authorizePurchase(
        selected.assessment,
        selected.selection,
        new Set(summary.value.materialWarnings.map((warning) => warning.id)),
      ),
    ).toEqual({ _tag: "err", reason: "authorization_unavailable" });
    expect(base.activity.pravaCheckoutRequests).toBe(0);
  });

  it("records checkout timeout as Purchase Outcome Unknown and never retries the consumed authorization", async () => {
    const adapters = createFakeAdapters({
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "unknown",
        merchantOrderIdentifier: null,
        confirmedTotalInr: null,
        failureReason: "Prava did not confirm whether the merchant accepted the order",
      },
    });
    const selected = await assessSelected(adapters);
    const authorization = await authorizeSelected(selected.workflow, selected.assessment, selected.selection);
    const claim = {
      authorization,
      assessment: selected.assessment,
      selectedOffer: selected.selection,
      quote: selected.selection.offer.checkoutQuote,
      quantity: 1,
      paymentMethod: "prava_one_time_prepaid",
    } as const;

    const first = await selected.workflow.checkout(claim);
    const retry = await selected.workflow.checkout(claim);

    expect(first).toMatchObject({ _tag: "ok", value: { outcome: "outcome_unknown" } });
    expect(retry).toEqual({ _tag: "err", reason: "authorization_used" });
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  });

  it("keeps a Previous Sandbox Purchase separate from the failed current attempt", async () => {
    const adapters = createFakeAdapters({
      previousSandboxPurchase: {
        purchasedAt: "2026-07-31T09:30:00.000Z",
        merchantOrderIdentifier: "historical-order-001",
      },
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "failed",
        merchantOrderIdentifier: null,
        confirmedTotalInr: 14_990,
        failureReason: "Sandbox checkout unavailable",
      },
    });
    const selected = await assessSelected(adapters);
    const authorization = await authorizeSelected(selected.workflow, selected.assessment, selected.selection);
    const result = await selected.workflow.checkout({
      authorization,
      assessment: selected.assessment,
      selectedOffer: selected.selection,
      quote: selected.selection.offer.checkoutQuote,
      quantity: 1,
      paymentMethod: "prava_one_time_prepaid",
    });

    expect(result).toMatchObject({
      _tag: "ok",
      value: {
        outcome: "purchase_unavailable",
        previousSandboxPurchase: {
          purchasedAt: "2026-07-31T09:30:00.000Z",
          merchantOrderIdentifier: "historical-order-001",
        },
      },
    });
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  });

  it("does not leave a usable authorization when Prava registration fails", async () => {
    const underlying = createInMemoryPurchaseAuthorizationRepository();
    let stored: { readonly id: string; readonly value: StoredPurchaseAuthorization } | undefined;
    let transitionAttempts = 0;
    const base = createFakeAdapters();
    const adapters: AssessmentAdapters = {
      ...base,
      prava: { ...base.prava, registerCheckout: () => Promise.resolve("unavailable" as const) },
      authorization: {
        create: async (id, value) => {
          stored = { id, value };
          return underlying.create(id, value);
        },
        read: (id, snapshot) => underlying.read(id, snapshot),
        transition: (id, snapshot, nextState) => {
          transitionAttempts += 1;
          return nextState === "invalidated"
            ? Promise.resolve("unavailable" as const)
            : underlying.transition(id, snapshot, nextState);
        },
      },
    };
    const selected = await assessSelected(adapters);
    const summary = selected.workflow.createApprovalSummary(selected.assessment, selected.selection);
    if (summary._tag === "err") throw new Error(summary.reason);
    const result = await selected.workflow.authorizePurchase(
      selected.assessment,
      selected.selection,
      new Set(summary.value.materialWarnings.map((warning) => warning.id)),
    );

    expect(result).toEqual({ _tag: "err", reason: "authorization_unavailable" });
    if (stored === undefined) throw new Error("Expected an authorization persistence attempt");
    expect(await underlying.read(stored.id, stored.value.authorizationSnapshot)).toMatchObject({
      _tag: "ok",
      value: { state: "pending_registration" },
    });
    expect(transitionAttempts).toBe(0);
    expect(base.activity.pravaCheckoutRequests).toBe(0);
  });
});
