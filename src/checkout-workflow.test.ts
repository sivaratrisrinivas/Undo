import { describe, expect, it } from "vitest";

import { createFakeAdapters } from "./adapters/fake-adapters";
import { parsePremiumLimitInr, SUPPORTED_PRODUCT } from "./domain";
import { AssessmentWorkflow } from "./workflow";
import { createPipelineLogger, type PipelineLogEntry } from "./pipeline-logging";

function premiumLimit(value: string) {
  const result = parsePremiumLimitInr(value);
  if (result._tag === "err") throw new Error("Invalid test Premium Limit");
  return result.value;
}

async function authorizedCheckout(workflow: AssessmentWorkflow) {
  const assessmentResult = await workflow.assess(
    SUPPORTED_PRODUCT,
    premiumLimit("2000"),
    "destination-ref-prava-default",
  );
  if (assessmentResult._tag === "err") throw new Error(assessmentResult.error.message);
  if (assessmentResult.value.ranking._tag !== "winner") throw new Error("Expected a winner");
  const selectionResult = workflow.selectOffer(
    assessmentResult.value,
    assessmentResult.value.ranking.offer.offer.id,
  );
  if (selectionResult._tag === "err") throw new Error(selectionResult.reason);
  const summaryResult = workflow.createApprovalSummary(
    assessmentResult.value,
    selectionResult.value,
  );
  if (summaryResult._tag === "err") throw new Error(summaryResult.reason);
  const authorizationResult = await workflow.authorizePurchase(
    assessmentResult.value,
    selectionResult.value,
    new Set(summaryResult.value.materialWarnings.map((warning) => warning.id)),
  );
  if (authorizationResult._tag === "err") throw new Error(authorizationResult.reason);
  return {
    authorization: authorizationResult.value,
    assessment: assessmentResult.value,
    selectedOffer: selectionResult.value,
    quote: selectionResult.value.offer.checkoutQuote,
    quantity: 1,
    paymentMethod: "prava_one_time_prepaid",
  } as const;
}

describe("checkout workflow", () => {
  it("records a Completed Purchase only for successful payment with a merchant order identifier", async () => {
    const adapters = createFakeAdapters({
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "successful",
        merchantOrderIdentifier: "order-prava-001",
        confirmedTotalInr: 14_990,
      },
    });
    const workflow = new AssessmentWorkflow(adapters);

    const result = await workflow.checkout(await authorizedCheckout(workflow));

    expect(result).toMatchObject({
      _tag: "ok",
      value: {
        outcome: "purchased",
        authorizationState: "used",
        pravaStatus: "payment_succeeded",
        merchantOrderIdentifier: "order-prava-001",
        approvedMaximumTotalInr: 14_990,
      },
    });
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  });

  it("durably records outcome_unknown before crossing the irreversible checkout boundary", async () => {
    const base = createFakeAdapters();
    let pendingWasDurable = false;
    const adapters = {
      ...base,
      prava: {
        ...base.prava,
        async submitCheckout(request: Parameters<typeof base.prava.submitCheckout>[0]) {
          const pending = await base.records.find("undo-demo-record");
          pendingWasDurable = pending?.outcome === "outcome_unknown" &&
            pending.authorizationState === "used" && pending.pravaStatus === "outcome_unknown";
          return await base.prava.submitCheckout(request);
        },
      },
    };
    const workflow = new AssessmentWorkflow(adapters);

    const result = await workflow.checkout(await authorizedCheckout(workflow));

    expect(pendingWasDurable).toBe(true);
    expect(result).toMatchObject({ _tag: "ok", value: { outcome: "purchased" } });
    expect(await adapters.records.find("undo-demo-record")).toMatchObject({ outcome: "purchased" });
  });

  it("records outcome_unknown when Prava reports success without an order identifier", async () => {
    const baseAdapters = createFakeAdapters({
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "unknown",
        merchantOrderIdentifier: null,
        confirmedTotalInr: 14_990,
        failureReason: "Prava reported successful payment without a merchant order identifier",
      },
    });
    const entries: PipelineLogEntry[] = [];
    const adapters = {
      ...baseAdapters,
      pipeline: {
        nextTraceId: () => "trace-checkout-unknown-1234",
        logger: (traceId: string) => createPipelineLogger({
          traceId,
          scope: "browser",
          sink: (entry) => { entries.push(entry); },
        }),
      },
    };
    const workflow = new AssessmentWorkflow(adapters);

    const result = await workflow.checkout(await authorizedCheckout(workflow));

    expect(result).toMatchObject({
      _tag: "ok",
      value: {
        outcome: "outcome_unknown",
        pravaStatus: "outcome_unknown",
        merchantOrderIdentifier: null,
      },
    });
    expect(entries.some((entry) =>
      entry.stage === "prava.checkout" &&
      entry.status === "failed" &&
      entry.details?.paymentStatus === "unknown"
    )).toBe(true);
    expect(entries).toContainEqual(expect.objectContaining({
      stage: "checkout",
      status: "failed",
      details: { outcome: "outcome_unknown" },
    }));
  });

  it("records a confirmed failure without retrying or reusing authorization", async () => {
    const adapters = createFakeAdapters({
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "failed",
        merchantOrderIdentifier: null,
        confirmedTotalInr: 14_990,
        failureReason: "Merchant declined the sandbox checkout",
      },
    });
    const workflow = new AssessmentWorkflow(adapters);
    const claim = await authorizedCheckout(workflow);

    const first = await workflow.checkout(claim);
    const retry = await workflow.checkout(claim);

    expect(first).toMatchObject({
      _tag: "ok",
      value: {
        outcome: "purchase_unavailable",
        pravaStatus: "confirmed_failure",
        blockingReason: "Merchant declined the sandbox checkout",
      },
    });
    expect(retry).toEqual({ _tag: "err", reason: "authorization_used" });
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  });

  it("records outcome_unknown after a timeout and never retries automatically", async () => {
    const adapters = createFakeAdapters({
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "unknown",
        merchantOrderIdentifier: null,
        confirmedTotalInr: null,
        failureReason: "Prava did not confirm whether the merchant accepted the order",
      },
    });
    const workflow = new AssessmentWorkflow(adapters);

    const result = await workflow.checkout(await authorizedCheckout(workflow));

    expect(result).toMatchObject({
      _tag: "ok",
      value: {
        outcome: "outcome_unknown",
        pravaStatus: "outcome_unknown",
        blockingReason: "Prava did not confirm whether the merchant accepted the order",
      },
    });
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  });

  it("records a higher fresh total as blocked_by_price without claiming checkout was submitted", async () => {
    const adapters = createFakeAdapters({
      checkoutResult: {
        _tag: "not_submitted",
        reason: "blocked_by_price",
        confirmedTotalInr: 15_500,
        explanation: "The fresh Prava total exceeds the authorized maximum",
      },
    });
    const workflow = new AssessmentWorkflow(adapters);

    const result = await workflow.checkout(await authorizedCheckout(workflow));

    expect(result).toMatchObject({
      _tag: "ok",
      value: {
        outcome: "blocked_by_price",
        authorizationState: "used_without_submission",
        pravaStatus: "not_submitted",
        blockingReason: "The fresh Prava total exceeds the authorized maximum",
      },
    });
  });

  it("allows only one concurrent submission for one Purchase Authorization", async () => {
    const adapters = createFakeAdapters();
    const workflow = new AssessmentWorkflow(adapters);
    const claim = await authorizedCheckout(workflow);

    const results = await Promise.all([
      workflow.checkout(claim),
      new AssessmentWorkflow(adapters).checkout(claim),
    ]);

    expect(results.filter((result) => result._tag === "ok")).toHaveLength(1);
    expect(results).toContainEqual({ _tag: "err", reason: "authorization_used" });
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  });

  it("keeps a Previous Sandbox Purchase historical and separate from the current failed attempt", async () => {
    const adapters = createFakeAdapters({
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "failed",
        merchantOrderIdentifier: null,
        confirmedTotalInr: 14_990,
        failureReason: "Sandbox checkout unavailable",
      },
      previousSandboxPurchase: {
        purchasedAt: "2026-07-31T09:30:00.000Z",
        merchantOrderIdentifier: "historical-order-001",
      },
    });
    const workflow = new AssessmentWorkflow(adapters);

    const result = await workflow.checkout(await authorizedCheckout(workflow));

    expect(result).toMatchObject({
      _tag: "ok",
      value: {
        outcome: "purchase_unavailable",
        merchantOrderIdentifier: null,
        previousSandboxPurchase: {
          purchasedAt: "2026-07-31T09:30:00.000Z",
          merchantOrderIdentifier: "historical-order-001",
        },
      },
    });
  });
});
