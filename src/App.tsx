import { useMemo, useState } from "react";

import { ApprovalStage, ComparisonStage, EvidenceStage } from "./components/AssessmentStages";
import { CheckoutStage, RecordStage } from "./components/DecisionStages";
import { ConstraintsStage, ProductInputStage, type InputMode } from "./components/InputStages";
import { StageProgress } from "./components/StageProgress";
import {
  parsePremiumLimitInr,
  resolveSupportedProduct,
  type AssessedOffer,
  type Product,
  type ReversibilityAssessment,
  type UndoRecord,
} from "./domain";
import { AssessmentWorkflow, type AssessmentAdapters } from "./workflow";
import "./styles.css";

type Stage = "product" | "constraints" | "comparison" | "evidence" | "approval" | "checkout" | "record";

const stageIndex: Readonly<Record<Stage, number>> = {
  product: 0,
  constraints: 1,
  comparison: 2,
  evidence: 3,
  approval: 4,
  checkout: 5,
  record: 6,
};

/** Renders the seven-stage Undo walking skeleton with injected external adapters. */
export function App({ adapters }: { readonly adapters: AssessmentAdapters }) {
  const workflow = useMemo(() => new AssessmentWorkflow(adapters), [adapters]);
  const [stage, setStage] = useState<Stage>("product");
  const [inputMode, setInputMode] = useState<InputMode>("preset");
  const [url, setUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [product, setProduct] = useState<Product>();
  const [premiumLimit, setPremiumLimit] = useState("2000");
  const [destinationReference, setDestinationReference] = useState("Bengaluru · destination-ref-01");
  const [assessment, setAssessment] = useState<ReversibilityAssessment>();
  const [selectedOffer, setSelectedOffer] = useState<AssessedOffer>();
  const [record, setRecord] = useState<UndoRecord>();
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  function startAssessment() {
    const input = inputMode === "preset" ? "preset" : inputMode === "url" ? url : productName;
    const resolved = resolveSupportedProduct(input);
    if (resolved === undefined) {
      setError("Not supported in this MVP");
      return;
    }
    setError(undefined);
    setProduct(resolved);
    setStage("constraints");
  }

  async function compareOffers() {
    if (product === undefined) {
      return;
    }
    const parsedPremiumLimit = parsePremiumLimitInr(premiumLimit);
    if (parsedPremiumLimit._tag === "err") {
      setError(parsedPremiumLimit.message);
      return;
    }
    setError(undefined);
    setLoading(true);
    const result = await workflow.assess(
      product,
      parsedPremiumLimit.value,
      destinationReference,
    );
    setLoading(false);
    if (result._tag === "err") {
      if (result.error._tag === "NoEligibleOffer" && result.error.record !== undefined) {
        setRecord(result.error.record);
        setStage("record");
        return;
      }
      setError(result.error.message);
      return;
    }
    setAssessment(result.value);
    setSelectedOffer(
      result.value.ranking._tag === "winner" ? result.value.ranking.offer : undefined,
    );
    setStage("comparison");
  }

  function declinePurchase() {
    if (assessment === undefined || selectedOffer === undefined) {
      return;
    }
    setRecord(workflow.decline(assessment, selectedOffer));
    setStage("record");
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Undo home">
          <span className="brand-mark" aria-hidden="true">↶</span>
          Undo
        </a>
        <span className="demo-badge">Guided MVP demo</span>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">Before you buy, know the way back.</p>
          <h1 id="page-title">Reversibility Assessment</h1>
          <p className="lede">
            Compare evidenced exit rights, costs, and uncertainty across equivalent Offers.
            Undo informs your choice; it does not guarantee a merchant outcome.
          </p>
        </section>

        <StageProgress current={stageIndex[stage]} />

        <section className="workspace" aria-live="polite" aria-busy={loading}>
          {stage === "product" && <ProductInputStage error={error} inputMode={inputMode} productName={productName} url={url} onInputModeChange={setInputMode} onProductNameChange={setProductName} onStart={startAssessment} onUrlChange={setUrl} />}
          {stage === "constraints" && product !== undefined && <ConstraintsStage destinationReference={destinationReference} error={error} loading={loading} premiumLimit={premiumLimit} onCompare={() => void compareOffers()} onDestinationChange={setDestinationReference} onPremiumLimitChange={setPremiumLimit} />}
          {stage === "comparison" && assessment !== undefined && <ComparisonStage assessment={assessment} selectedOfferId={selectedOffer?.offer.id} onContinue={() => setStage("evidence")} onSelect={setSelectedOffer} />}
          {stage === "evidence" && assessment !== undefined && <EvidenceStage assessment={assessment} onContinue={() => setStage("approval")} />}
          {stage === "approval" && assessment !== undefined && selectedOffer !== undefined && <ApprovalStage assessment={assessment} selectedOffer={selectedOffer} acknowledgedWarnings={acknowledgedWarnings} onAcknowledgementChange={(warning, checked) => setAcknowledgedWarnings((current) => { const next = new Set(current); if (checked) next.add(warning); else next.delete(warning); return next; })} onContinue={() => setStage("checkout")} />}
          {stage === "checkout" && selectedOffer !== undefined && <CheckoutStage selectedOffer={selectedOffer} onDecline={declinePurchase} />}
          {stage === "record" && record !== undefined && <RecordStage record={record} />}
        </section>
      </main>

      <footer>Evidence over promises · Decision rules over scores</footer>
    </div>
  );
}
