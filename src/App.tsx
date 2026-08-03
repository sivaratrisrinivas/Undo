import { useEffect, useMemo, useRef, useState } from "react";

import { AssessmentConsole, EvidenceReviewStage } from "./components/AssessmentStages";
import { RecordStage } from "./components/DecisionStages";
import { ProductInputStage, type InputMode } from "./components/InputStages";
import { StageProgress } from "./components/StageProgress";
import {
  parsePremiumLimitInr,
  resolveSupportedProduct,
  type ApprovalSummary,
  type AuthorizedPaymentMethod,
  type BuyerOfferSelection,
  type EvidenceReview,
  type EvidenceSnapshot,
  type PolicyAssessment,
  type ReversibilityAssessment,
  type UndoRecord,
} from "./domain";
import { AssessmentWorkflow, type AssessmentAdapters } from "./workflow";
import "./styles.css";

type Stage = "setup" | "assessment" | "review" | "record";

const actionIndex: Readonly<Record<Stage, number>> = {
  setup: 0,
  assessment: 1,
  review: 1,
  record: 2,
};

const paymentMethod = {
  id: "prava_one_time_prepaid" satisfies AuthorizedPaymentMethod,
  label: "Prava hosted sandbox card",
} as const;

/** Renders Undo as a three-action assessment with injected external adapters. */
export function App({ adapters }: { readonly adapters: AssessmentAdapters }) {
  const workflow = useMemo(() => new AssessmentWorkflow(adapters), [adapters]);
  const workspaceRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState<Stage>("setup");
  const [inputMode, setInputMode] = useState<InputMode>("preset");
  const [url, setUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [premiumLimit, setPremiumLimit] = useState("2000");
  const [destinationReference, setDestinationReference] = useState("destination-ref-prava-default");
  const [assessment, setAssessment] = useState<ReversibilityAssessment>();
  const [selectedOffer, setSelectedOffer] = useState<BuyerOfferSelection>();
  const [approvalSummary, setApprovalSummary] = useState<ApprovalSummary>();
  const [record, setRecord] = useState<UndoRecord>();
  const [reviewCandidates, setReviewCandidates] = useState<ReadonlyArray<{
    readonly snapshot: EvidenceSnapshot;
    readonly policy: PolicyAssessment;
  }>>([]);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    workspaceRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [stage]);

  const stageStatus = loading
    ? "Undo is processing the current action."
    : {
        setup: "Action one: configure the purchase.",
        assessment: "Action two: assessment ready for review.",
        review: "Buyer flow paused for a separate operations evidence review.",
        record: "Action three complete. Undo Record ready.",
      }[stage];

  async function assessPurchase() {
    const traceId = adapters.pipeline?.nextTraceId();
    const logger = traceId === undefined ? undefined : adapters.pipeline?.logger(traceId);
    logger?.log("input_validation", "started", { inputMode });
    const input = inputMode === "preset" ? "preset" : inputMode === "url" ? url : productName;
    const resolved = resolveSupportedProduct(input);
    if (resolved === undefined) {
      logger?.log("input_validation", "failed", { reason: "unsupported_product" });
      logger?.log("assessment", "blocked", { reason: "unsupported_product" });
      setError("Not supported in this MVP");
      return;
    }
    const parsedPremiumLimit = parsePremiumLimitInr(premiumLimit);
    if (parsedPremiumLimit._tag === "err") {
      logger?.log("input_validation", "failed", { reason: "invalid_premium_limit" });
      logger?.log("assessment", "blocked", { reason: "invalid_premium_limit" });
      setError(parsedPremiumLimit.message);
      return;
    }
    logger?.log("input_validation", "succeeded", { productModel: resolved.model });
    setError(undefined);
    setLoading(true);
    const result = await workflow.assess(
      resolved,
      parsedPremiumLimit.value,
      destinationReference,
      traceId,
    );
    setLoading(false);
    if (result._tag === "err") {
      if (result.error._tag === "NoEligibleOffer" && result.error.record !== undefined) {
        if (await workflow.saveBlockedRecord(result.error.record) === "unavailable") {
          setError("Unable to save the Undo Record safely.");
          return;
        }
        setRecord(result.error.record);
        if (result.error.reviewCandidates !== undefined) {
          setReviewCandidates(result.error.reviewCandidates);
          setStage("review");
          return;
        }
        setStage("record");
        return;
      }
      setError(result.error.message);
      return;
    }
    setAssessment(result.value);
    const initialSelection =
      result.value.ranking._tag === "winner"
        ? workflow.selectOffer(result.value, result.value.ranking.offer.offer.id)
        : undefined;
    setSelectedOffer(
      initialSelection?._tag === "ok" ? initialSelection.value : undefined,
    );
    if (initialSelection?._tag === "ok") {
      const summary = workflow.createApprovalSummary(result.value, initialSelection.value);
      setApprovalSummary(summary._tag === "ok" ? summary.value : undefined);
    } else {
      setApprovalSummary(undefined);
    }
    setAcknowledgedWarnings(new Set());
    setStage("assessment");
  }

  function selectOffer(offerId: ReversibilityAssessment["offers"][number]["offer"]["id"]) {
    if (assessment === undefined) return;
    const result = workflow.selectOffer(assessment, offerId);
    if (result._tag === "err") return;
    setSelectedOffer(result.value);
    const summary = workflow.createApprovalSummary(assessment, result.value);
    setApprovalSummary(summary._tag === "ok" ? summary.value : undefined);
    setAcknowledgedWarnings(new Set());
  }

  async function authorizeAndSubmit() {
    if (assessment === undefined || selectedOffer === undefined || approvalSummary === undefined) return;
    adapters.prava.prepareCheckout?.();
    setError(undefined);
    setLoading(true);
    const authorizationResult = await workflow.authorizePurchase(
      assessment,
      selectedOffer,
      acknowledgedWarnings,
    );
    if (authorizationResult._tag === "err") {
      adapters.prava.cancelPreparedCheckout?.();
      setLoading(false);
      setError("Purchase Authorization is unavailable until the exact summary and every Material Warning are approved.");
      return;
    }

    const checkoutResult = await workflow.checkout({
      authorization: authorizationResult.value,
      assessment,
      selectedOffer,
      quote: selectedOffer.offer.checkoutQuote,
      quantity: 1,
      paymentMethod: paymentMethod.id,
    });
    setLoading(false);
    if (checkoutResult._tag === "err") {
      if (checkoutResult.reason === "record_unavailable") {
        setError("Checkout may have completed, but Undo could not persist this record. Do not retry.");
        setRecord(checkoutResult.record);
        setStage("record");
        return;
      }
      setError("Checkout was not submitted because the Purchase Authorization is no longer valid. Start again for a fresh quote and approval.");
      return;
    }
    setRecord(checkoutResult.value);
    setStage("record");
  }

  async function approveEvidence() {
    setLoading(true);
    await Promise.all(
      reviewCandidates.map((candidate): Promise<EvidenceReview> =>
        workflow.approveEvidence(candidate.snapshot, candidate.policy),
      ),
    );
    setReviewCandidates([]);
    setLoading(false);
    await assessPurchase();
  }

  async function declinePurchase() {
    if (assessment === undefined || selectedOffer === undefined) {
      return;
    }
    const result = await workflow.decline(assessment, selectedOffer);
    if (result._tag === "err") {
      if (result.reason === "record_unavailable") {
        setError("The decline was completed, but Undo could not persist this record.");
        setRecord(result.record);
        setStage("record");
        return;
      }
      setError("Unable to save the decline safely. No checkout was submitted.");
      return;
    }
    setError(undefined);
    setRecord(result.value);
    setStage("record");
  }

  function resetAssessment() {
    setError(undefined);
    setAssessment(undefined);
    setSelectedOffer(undefined);
    setApprovalSummary(undefined);
    setAcknowledgedWarnings(new Set());
    setRecord(undefined);
    setStage("setup");
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Undo home">
          <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32"><path d="M11 9 5 15l6 6" /><path d="M6 15h11a9 9 0 1 1-7.8 13.5" /></svg>
          <span>Undo</span>
        </a>
        <div className="header-status"><span aria-hidden="true" />Evidence-linked demo</div>
      </header>

      <main>
        <StageProgress current={actionIndex[stage]} />
        <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">{stageStatus}</p>

        <section className="workspace" aria-busy={loading} ref={workspaceRef}>
          {stage === "setup" && <ProductInputStage destinationReference={destinationReference} error={error} inputMode={inputMode} loading={loading} premiumLimit={premiumLimit} productName={productName} url={url} onAssess={() => void assessPurchase()} onDestinationChange={setDestinationReference} onInputModeChange={setInputMode} onPremiumLimitChange={setPremiumLimit} onProductNameChange={setProductName} onUrlChange={setUrl} />}
          {stage === "review" && <EvidenceReviewStage candidates={reviewCandidates} loading={loading} onApprove={() => void approveEvidence()} />}
          {stage === "assessment" && assessment !== undefined && <AssessmentConsole assessment={assessment} selectedOffer={selectedOffer} summary={approvalSummary} paymentMethodLabel={paymentMethod.label} purchaseEnabled={adapters.policyContract.purchaseEnabled()} acknowledgedWarnings={acknowledgedWarnings} error={error} loading={loading} onAcknowledgementChange={(warningId, checked) => setAcknowledgedWarnings((current) => { const next = new Set(current); if (checked) next.add(warningId); else next.delete(warningId); return next; })} onAuthorizeAndSubmit={() => void authorizeAndSubmit()} onDecline={() => void declinePurchase()} onEdit={resetAssessment} onSelect={(offer) => selectOffer(offer.offer.id)} />}
          {stage === "record" && record !== undefined && <RecordStage error={error} record={record} />}
        </section>
      </main>

      <footer><span>Undo informs a choice. It does not guarantee a merchant outcome.</span><span>Evidence over promises · Rules over scores</span></footer>
    </div>
  );
}
