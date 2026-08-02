import { describe, expect, it } from "vitest";

import {
  createFakeAdapters,
  createInMemoryPurchaseAuthorizationRepository,
} from "./adapters/fake-adapters";
import { parsePremiumLimitInr, SUPPORTED_PRODUCT, type PurchaseAuthorization } from "./domain";
import { AssessmentWorkflow } from "./workflow";

function premiumLimit(value: string) {
  const result = parsePremiumLimitInr(value);
  if (result._tag === "err") throw new Error("Invalid test Premium Limit");
  return result.value;
}

async function assessSelectedOffer(workflow: AssessmentWorkflow) {
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
  return { assessment: assessmentResult.value, selection: selectionResult.value };
}

async function authorizeSelectedOffer(workflow: AssessmentWorkflow) {
  const selected = await assessSelectedOffer(workflow);
  const summaryResult = workflow.createApprovalSummary(selected.assessment, selected.selection);
  if (summaryResult._tag === "err") throw new Error(summaryResult.reason);
  const authorizationResult = await workflow.authorizePurchase(
    selected.assessment,
    selected.selection,
    new Set(summaryResult.value.materialWarnings.map((warning) => warning.id)),
  );
  if (authorizationResult._tag === "err") throw new Error(authorizationResult.reason);
  return { ...selected, authorization: authorizationResult.value };
}

describe("Purchase Authorization", () => {
  it("derives a complete Approval Summary and requires every Material Warning acknowledgement", async () => {
    const workflow = new AssessmentWorkflow(createFakeAdapters());
    const { assessment, selection } = await assessSelectedOffer(workflow);

    const summaryResult = workflow.createApprovalSummary(assessment, selection);

    expect(summaryResult).toMatchObject({
      _tag: "ok",
      value: {
        product: SUPPORTED_PRODUCT,
        quantity: 1,
        merchant: "Headphone Zone",
        seller: "Headphone Zone",
        confirmedCheckoutTotalInr: 14_990,
        maximumTotalInr: 14_990,
        premiumLimitInr: 2_000,
        remedy: "money_back",
        trialPermission: false,
        remedyWindow: {
          days: 7,
          startsAt: "delivered",
          requiredAction: "request_submitted",
        },
        returnTransport: "self_ship",
        buyerPaidCosts: { kind: "unstated" },
        evidence: {
          collectedAt: "2026-08-01T10:30:00.000Z",
          retrievalState: "current",
        },
        materialConditions: ["Product must remain sealed and unopened."],
      },
    });
    if (summaryResult._tag === "err") throw new Error(summaryResult.reason);
    expect(summaryResult.value.materialWarnings).toEqual([
      {
        id: "unopened-only",
        kind: "unopened_only",
        detail: "Product must remain sealed and unopened.",
      },
      {
        id: "unstated-cost",
        kind: "unstated_cost",
        detail: "No fee stated—cost uncertain.",
      },
    ]);

    expect(
      await workflow.authorizePurchase(
        assessment,
        selection,
        new Set(["unopened-only"]),
      ),
    ).toEqual({
      _tag: "err",
      reason: "missing_warning_acknowledgements",
      missingWarningIds: ["unstated-cost"],
    });
  });

  it("binds approval to the exact purchase while allowing only a lower final total", async () => {
    const workflow = new AssessmentWorkflow(
      createFakeAdapters({ authorizationId: "authorization-001" }),
    );
    const { assessment, selection } = await assessSelectedOffer(workflow);
    const summaryResult = workflow.createApprovalSummary(assessment, selection);
    if (summaryResult._tag === "err") throw new Error(summaryResult.reason);
    const acknowledgedWarningIds = new Set(
      summaryResult.value.materialWarnings.map((warning) => warning.id),
    );

    const authorizationResult = await workflow.authorizePurchase(
      assessment,
      selection,
      acknowledgedWarningIds,
    );

    expect(authorizationResult).toMatchObject({
      _tag: "ok",
      value: {
        id: "authorization-001",
        state: "active",
        issuedAt: "2026-08-01T12:00:00.000Z",
        expiresAt: "2026-08-01T12:10:00.000Z",
        binding: {
          product: SUPPORTED_PRODUCT,
          quantity: 1,
          offerId: "headphone-zone",
          merchant: "Headphone Zone",
          seller: "Headphone Zone",
          destinationReference: "destination-ref-prava-default",
          maximumTotalInr: 14_990,
          premiumLimitInr: 2_000,
        },
        paymentMethod: "prava_one_time_prepaid",
        acknowledgedWarningIds: ["unopened-only", "unstated-cost"],
      },
    });
    if (authorizationResult._tag === "err") throw new Error(authorizationResult.reason);

    const lowerQuote = {
      ...selection.offer.checkoutQuote,
      appliedDiscounts: [{ label: "Fresh quote saving", amountInr: 490 }],
      totalInr: 14_500,
    };
    expect(
      await workflow.claimCheckoutSubmission({
        authorization: authorizationResult.value,
        assessment,
        selectedOffer: selection,
        quote: lowerQuote,
        quantity: 1,
        paymentMethod: "prava_one_time_prepaid",
      }),
    ).toMatchObject({
      _tag: "ok",
      value: {
        authorization: { state: "used", usedAt: "2026-08-01T12:00:00.000Z" },
        quote: { totalInr: 14_500 },
      },
    });

    const secondWorkflow = new AssessmentWorkflow(
      createFakeAdapters({ authorizationId: "authorization-002" }),
    );
    const second = await assessSelectedOffer(secondWorkflow);
    const secondSummary = secondWorkflow.createApprovalSummary(
      second.assessment,
      second.selection,
    );
    if (secondSummary._tag === "err") throw new Error(secondSummary.reason);
    const secondAuthorization = await secondWorkflow.authorizePurchase(
      second.assessment,
      second.selection,
      new Set(secondSummary.value.materialWarnings.map((warning) => warning.id)),
    );
    if (secondAuthorization._tag === "err") throw new Error(secondAuthorization.reason);

    expect(
      await secondWorkflow.claimCheckoutSubmission({
        authorization: secondAuthorization.value,
        assessment: second.assessment,
        selectedOffer: second.selection,
        quote: {
          ...second.selection.offer.checkoutQuote,
          itemTotalInr: 14_491,
          totalInr: 14_991,
        },
        quantity: 1,
        paymentMethod: "prava_one_time_prepaid",
      }),
    ).toEqual({ _tag: "err", reason: "total_exceeded" });
    expect(
      await secondWorkflow.claimCheckoutSubmission({
        authorization: secondAuthorization.value,
        assessment: second.assessment,
        selectedOffer: second.selection,
        quote: second.selection.offer.checkoutQuote,
        quantity: 1,
        paymentMethod: "prava_one_time_prepaid",
      }),
    ).toEqual({ _tag: "err", reason: "authorization_invalid" });
  });

  it("expires at the exact 10-minute boundary", async () => {
    let now = "2026-08-01T12:00:00.000Z";
    const workflow = new AssessmentWorkflow({
      ...createFakeAdapters({ authorizationId: "authorization-expiry" }),
      now: () => now,
    });
    const authorized = await authorizeSelectedOffer(workflow);
    now = "2026-08-01T12:10:00.000Z";

    expect(
      await workflow.claimCheckoutSubmission({
        authorization: authorized.authorization,
        assessment: authorized.assessment,
        selectedOffer: authorized.selection,
        quote: authorized.selection.offer.checkoutQuote,
        quantity: 1,
        paymentMethod: "prava_one_time_prepaid",
      }),
    ).toEqual({ _tag: "err", reason: "authorization_expired" });
  });

  it("permits exactly one checkout claim and rejects attempted reuse", async () => {
    const adapters = createFakeAdapters({ authorizationId: "authorization-single-use" });
    const workflow = new AssessmentWorkflow(adapters);
    const authorized = await authorizeSelectedOffer(workflow);
    const claim = {
      authorization: authorized.authorization,
      assessment: authorized.assessment,
      selectedOffer: authorized.selection,
      quote: authorized.selection.offer.checkoutQuote,
      quantity: 1,
      paymentMethod: "prava_one_time_prepaid",
    } as const;

    const reconstructedWorkflow = new AssessmentWorkflow(adapters);
    const [firstClaim, concurrentClaim] = await Promise.all([
      workflow.claimCheckoutSubmission(claim),
      reconstructedWorkflow.claimCheckoutSubmission(claim),
    ]);
    expect([firstClaim._tag, concurrentClaim._tag].sort()).toEqual(["err", "ok"]);
    expect([firstClaim, concurrentClaim]).toContainEqual({
      _tag: "err",
      reason: "authorization_used",
    });
  });

  it("rejects a pending registration before any checkout submission", async () => {
    const authorizationRepository = createInMemoryPurchaseAuthorizationRepository();
    const baseAdapters = createFakeAdapters({ authorizationId: "authorization-pending-registration" });
    const adapters = { ...baseAdapters, authorization: authorizationRepository };
    const workflow = new AssessmentWorkflow(adapters);
    const selected = await assessSelectedOffer(workflow);
    const summaryResult = workflow.createApprovalSummary(selected.assessment, selected.selection);
    if (summaryResult._tag === "err") throw new Error(summaryResult.reason);
    const authorization: PurchaseAuthorization = {
      id: "authorization-pending-registration",
      state: "active",
      issuedAt: "2026-08-01T12:00:00.000Z",
      expiresAt: "2026-08-01T12:10:00.000Z",
      binding: {
        product: selected.assessment.product,
        quantity: 1,
        offerId: selected.selection.offer.offer.id,
        merchant: selected.selection.offer.offer.merchant,
        seller: selected.selection.offer.offer.seller,
        destinationReference: selected.assessment.destinationReference,
        maximumTotalInr: selected.selection.offer.checkoutQuote.totalInr,
        premiumLimitInr: selected.assessment.premiumLimitInr,
        assessmentFingerprint: "test-fingerprint",
      },
      paymentMethod: "prava_one_time_prepaid",
      acknowledgedWarningIds: summaryResult.value.materialWarnings.map((warning) => warning.id),
    };
    const authorizationSnapshot = JSON.stringify(authorization);
    expect(
      await authorizationRepository.create("authorization-pending-registration", {
        authorizationSnapshot,
        assessmentSnapshot: JSON.stringify(selected.assessment),
        state: "pending_registration",
      }),
    ).toBe("created");

    const result = await workflow.checkout({
      authorization,
      assessment: selected.assessment,
      selectedOffer: selected.selection,
      quote: selected.selection.offer.checkoutQuote,
      quantity: 1,
      paymentMethod: "prava_one_time_prepaid",
    });

    expect(result).toEqual({ _tag: "err", reason: "authorization_invalid" });
    expect(baseAdapters.activity.pravaCheckoutRequests).toBe(0);
    expect(await authorizationRepository.read("authorization-pending-registration", authorizationSnapshot)).toEqual({
      _tag: "ok",
      value: {
        authorizationSnapshot,
        assessmentSnapshot: JSON.stringify(selected.assessment),
        state: "pending_registration",
      },
    });
  });

  it.each([
    {
      boundary: "Product identity",
      change: "product" as const,
      reason: "product_changed",
    },
    {
      boundary: "merchant",
      change: "merchant" as const,
      reason: "merchant_changed",
    },
    {
      boundary: "seller",
      change: "seller" as const,
      reason: "seller_changed",
    },
    {
      boundary: "destination",
      change: "destination" as const,
      reason: "destination_changed",
    },
    {
      boundary: "quoted destination",
      change: "quote_destination" as const,
      reason: "destination_changed",
    },
    {
      boundary: "quantity",
      change: "quantity" as const,
      reason: "quantity_changed",
    },
    {
      boundary: "payment method",
      change: "payment" as const,
      reason: "unsupported_payment_method",
    },
  ])("rejects a changed $boundary", async ({ change, reason }) => {
    const workflow = new AssessmentWorkflow(
      createFakeAdapters({ authorizationId: `authorization-${change}` }),
    );
    const authorized = await authorizeSelectedOffer(workflow);
    const quote =
      change === "product"
        ? {
            ...authorized.selection.offer.checkoutQuote,
            product: { ...SUPPORTED_PRODUCT, variant: "White" },
          }
        : change === "merchant"
          ? { ...authorized.selection.offer.checkoutQuote, merchant: "Changed merchant" }
          : change === "seller"
            ? { ...authorized.selection.offer.checkoutQuote, seller: "Changed seller" }
            : change === "quote_destination"
              ? {
                  ...authorized.selection.offer.checkoutQuote,
                  destinationReference: "destination-ref-changed",
                }
            : authorized.selection.offer.checkoutQuote;
    const assessment =
      change === "destination"
        ? { ...authorized.assessment, destinationReference: "destination-ref-changed" }
        : authorized.assessment;

    expect(
      await workflow.claimCheckoutSubmission({
        authorization: authorized.authorization,
        assessment,
        selectedOffer: authorized.selection,
        quote,
        quantity: change === "quantity" ? 2 : 1,
        paymentMethod: change === "payment" ? "cash_on_delivery" : "prava_one_time_prepaid",
      }),
    ).toEqual({ _tag: "err", reason });
  });

  it("invalidates approval when the Premium Limit or a material comparison input changes", async () => {
    const workflow = new AssessmentWorkflow(
      createFakeAdapters({ authorizationId: "authorization-comparison" }),
    );
    const authorized = await authorizeSelectedOffer(workflow);
    const changedAssessment = {
      ...authorized.assessment,
      premiumLimitInr: premiumLimit("2500"),
    };

    expect(
      await workflow.claimCheckoutSubmission({
        authorization: authorized.authorization,
        assessment: changedAssessment,
        selectedOffer: authorized.selection,
        quote: authorized.selection.offer.checkoutQuote,
        quantity: 1,
        paymentMethod: "prava_one_time_prepaid",
      }),
    ).toEqual({ _tag: "err", reason: "approval_changed" });
  });

  it("invalidates approval when the selected Offer or its material policy changes", async () => {
    const workflow = new AssessmentWorkflow(
      createFakeAdapters({
        authorizationId: "authorization-material-input",
        scenario: "override",
      }),
    );
    const authorized = await authorizeSelectedOffer(workflow);
    const overrideResult = workflow.selectOffer(authorized.assessment, "concept-kart");
    if (overrideResult._tag === "err") throw new Error(overrideResult.reason);

    expect(
      await workflow.claimCheckoutSubmission({
        authorization: authorized.authorization,
        assessment: authorized.assessment,
        selectedOffer: overrideResult.value,
        quote: overrideResult.value.offer.checkoutQuote,
        quantity: 1,
        paymentMethod: "prava_one_time_prepaid",
      }),
    ).toEqual({ _tag: "err", reason: "merchant_changed" });

    const materialWorkflow = new AssessmentWorkflow(
      createFakeAdapters({
        authorizationId: "authorization-material-policy",
        scenario: "override",
      }),
    );
    const materialAuthorized = await authorizeSelectedOffer(materialWorkflow);
    const changedOffer = {
      ...materialAuthorized.selection.offer,
      policy: {
        ...materialAuthorized.selection.offer.policy,
        materialConditions: [
          ...materialAuthorized.selection.offer.policy.materialConditions,
          {
            detail: "Keep every accessory.",
            citation: materialAuthorized.selection.offer.policy.materialConditions[0]?.citation ?? {
              quote: materialAuthorized.selection.offer.policy.quote,
              sourceUrl: materialAuthorized.selection.offer.evidence.sourceUrl,
            },
          },
        ],
      },
    };
    const changedAssessment = {
      ...materialAuthorized.assessment,
      offers: materialAuthorized.assessment.offers.map((offer) =>
        offer.offer.id === changedOffer.offer.id ? changedOffer : offer,
      ),
      ranking: {
        _tag: "winner" as const,
        offer: changedOffer,
        reason: materialAuthorized.assessment.ranking.reason,
      },
    };

    expect(
      await materialWorkflow.claimCheckoutSubmission({
        authorization: materialAuthorized.authorization,
        assessment: changedAssessment,
        selectedOffer: { offer: changedOffer, selection: "ranking_winner" },
        quote: changedOffer.checkoutQuote,
        quantity: 1,
        paymentMethod: "prava_one_time_prepaid",
      }),
    ).toEqual({ _tag: "err", reason: "approval_changed" });
  });

  it("shows a blocked summary but creates no authorization or reusable payment secret", async () => {
    const baseAdapters = createFakeAdapters({ authorizationId: "authorization-blocked" });
    const workflow = new AssessmentWorkflow({
      ...baseAdapters,
      policyContract: { purchaseEnabled: () => false },
    });
    const { assessment, selection } = await assessSelectedOffer(workflow);
    const summaryResult = workflow.createApprovalSummary(assessment, selection);
    expect(summaryResult._tag).toBe("ok");
    if (summaryResult._tag === "err") throw new Error(summaryResult.reason);

    expect(
      await workflow.authorizePurchase(
        assessment,
        selection,
        new Set(summaryResult.value.materialWarnings.map((warning) => warning.id)),
      ),
    ).toEqual({ _tag: "err", reason: "purchase_blocked" });

    const enabledWorkflow = new AssessmentWorkflow(
      createFakeAdapters({ authorizationId: "authorization-redacted" }),
    );
    const enabled = await authorizeSelectedOffer(enabledWorkflow);
    expect(JSON.stringify(enabled.authorization)).not.toMatch(
      /card(number)?|cvv|secret|credential|token|one[-_ ]?time[-_ ]?password/i,
    );
  });

  it("refuses an Approval Summary with a blank Material Remedy Condition", async () => {
    const workflow = new AssessmentWorkflow(createFakeAdapters());
    const selected = await assessSelectedOffer(workflow);
    const incompleteOffer = {
      ...selected.selection.offer,
      policy: {
        ...selected.selection.offer.policy,
        materialConditions: selected.selection.offer.policy.materialConditions.map(
          (condition) => ({ ...condition, detail: "" }),
        ),
      },
    };
    const incompleteAssessment = {
      ...selected.assessment,
      offers: selected.assessment.offers.map((offer) =>
        offer.offer.id === incompleteOffer.offer.id ? incompleteOffer : offer,
      ),
      ranking: {
        _tag: "winner" as const,
        offer: incompleteOffer,
        reason: selected.assessment.ranking.reason,
      },
    };
    const incompleteSelection = {
      offer: incompleteOffer,
      selection: "ranking_winner" as const,
    };

    expect(
      workflow.createApprovalSummary(incompleteAssessment, incompleteSelection),
    ).toEqual({ _tag: "err", reason: "summary_incomplete" });
    expect(
      await workflow.authorizePurchase(incompleteAssessment, incompleteSelection, new Set()),
    ).toEqual({ _tag: "err", reason: "summary_incomplete" });
  });

  it("does not record or invalidate an authorization for an altered decline selection", async () => {
    const workflow = new AssessmentWorkflow(
      createFakeAdapters({ authorizationId: "authorization-decline-validation" }),
    );
    const authorized = await authorizeSelectedOffer(workflow);
    const alteredSelection = {
      ...authorized.selection,
      offer: {
        ...authorized.selection.offer,
        checkoutQuote: {
          ...authorized.selection.offer.checkoutQuote,
          itemTotalInr: 1,
          totalInr: 1,
        },
      },
    };

    expect(
      await workflow.decline(
        authorized.assessment,
        alteredSelection,
        authorized.authorization,
      ),
    ).toEqual({ _tag: "err", reason: "selection_mismatch" });
    expect(
      (
        await workflow.claimCheckoutSubmission({
          authorization: authorized.authorization,
          assessment: authorized.assessment,
          selectedOffer: authorized.selection,
          quote: authorized.selection.offer.checkoutQuote,
          quantity: 1,
          paymentMethod: "prava_one_time_prepaid",
        })
      )._tag,
    ).toBe("ok");
  });
});
