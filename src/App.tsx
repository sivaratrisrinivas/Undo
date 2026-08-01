import { useMemo, useState } from "react";

import { StageProgress } from "./components/StageProgress";
import {
  resolveSupportedProduct,
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
  const [inputMode, setInputMode] = useState<"preset" | "url">("preset");
  const [url, setUrl] = useState("");
  const [product, setProduct] = useState<Product>();
  const [premiumLimit, setPremiumLimit] = useState(2_000);
  const [destinationReference, setDestinationReference] = useState("Bengaluru · destination-ref-01");
  const [assessment, setAssessment] = useState<ReversibilityAssessment>();
  const [record, setRecord] = useState<UndoRecord>();
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  function startAssessment() {
    const resolved = resolveSupportedProduct(inputMode === "preset" ? "preset" : url);
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
    setLoading(true);
    const result = await workflow.assess(product, premiumLimit, destinationReference);
    setAssessment(result);
    setLoading(false);
    setStage("comparison");
  }

  function declinePurchase() {
    if (assessment === undefined) {
      return;
    }
    setRecord(workflow.decline(assessment));
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
          {stage === "product" && (
            <div className="stage-card compact">
              <p className="step-kicker">Step 1 of 7</p>
              <h2>Choose a Product</h2>
              <p className="stage-copy">This MVP supports one precisely matched Product and three approved Offer URLs.</p>

              <fieldset className="choice-stack">
                <legend className="sr-only">Product input method</legend>
                <label className={inputMode === "preset" ? "choice selected" : "choice"}>
                  <input
                    aria-label="Sennheiser HD 560S"
                    checked={inputMode === "preset"}
                    name="input-mode"
                    onChange={() => setInputMode("preset")}
                    type="radio"
                  />
                  <span>
                    <strong>Sennheiser HD 560S</strong>
                    <small>New · Black · India warranty region</small>
                  </span>
                  <span className="supported">Supported</span>
                </label>

                <label className={inputMode === "url" ? "choice selected" : "choice"}>
                  <input
                    aria-label="Paste an approved Offer URL"
                    checked={inputMode === "url"}
                    name="input-mode"
                    onChange={() => setInputMode("url")}
                    type="radio"
                  />
                  <span><strong>Paste an approved Offer URL</strong><small>Headphone Zone, Concept Kart, or Flipkart</small></span>
                </label>
              </fieldset>

              {inputMode === "url" && (
                <label className="field">
                  <span>Offer URL</span>
                  <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://merchant.example/product" type="url" />
                </label>
              )}
              {error !== undefined && <p role="alert" className="error-message">{error}</p>}
              <button className="primary-button" onClick={startAssessment} type="button">Start assessment <span aria-hidden="true">→</span></button>
            </div>
          )}

          {stage === "constraints" && product !== undefined && (
            <div className="stage-card compact">
              <p className="step-kicker">Step 2 of 7</p>
              <h2>Set your boundaries</h2>
              <p className="stage-copy">Quotes use a masked destination reference. No full address enters the assessment.</p>
              <div className="form-grid">
                <label className="field">
                  <span>Delivery Destination</span>
                  <select value={destinationReference} onChange={(event) => setDestinationReference(event.target.value)}>
                    <option value="Bengaluru · destination-ref-01">Bengaluru · saved destination •01</option>
                    <option value="Hyderabad · destination-ref-02">Hyderabad · saved destination •02</option>
                  </select>
                </label>
                <label className="field">
                  <span>Premium Limit (₹)</span>
                  <input min="0" onChange={(event) => setPremiumLimit(Number(event.target.value))} type="number" value={premiumLimit} />
                  <small>Maximum extra live total you permit for stronger reversibility.</small>
                </label>
              </div>
              <button className="primary-button" disabled={loading} onClick={() => void compareOffers()} type="button">
                {loading ? "Building assessment…" : "Compare offers"} <span aria-hidden="true">→</span>
              </button>
            </div>
          )}

          {stage === "comparison" && assessment !== undefined && (
            <div className="stage-card wide">
              <p className="step-kicker">Step 3 of 7</p>
              <h2>Offer comparison</h2>
              <p className="stage-copy">Equivalent Product identity confirmed. Ranking follows explicit remedy rules—not an AI score.</p>
              <div className="offer-table" role="table" aria-label="Equivalent Offer comparison">
                {assessment.offers.map((offer) => (
                  <article className={offer.eligible ? "offer-row winner" : "offer-row"} key={offer.offer.id} role="row">
                    <div><span className="merchant">{offer.offer.merchant}</span><small>Seller: {offer.offer.seller}</small></div>
                    <div><span className="cell-label">Confirmed total</span><strong>₹{offer.checkoutQuote.totalInr.toLocaleString("en-IN")}</strong></div>
                    <div><span className="cell-label">Change of mind</span><strong>{offer.policy.changeOfMind === "money_back" ? "Money back" : "Not evidenced"}</strong></div>
                    <div><span className="cell-label">Assessment</span><strong>{offer.explanation}</strong></div>
                  </article>
                ))}
              </div>
              <button className="primary-button" onClick={() => setStage("evidence")} type="button">Inspect evidence <span aria-hidden="true">→</span></button>
            </div>
          )}

          {stage === "evidence" && assessment !== undefined && (
            <div className="stage-card wide">
              <p className="step-kicker">Step 4 of 7</p>
              <h2>Policy Evidence</h2>
              <p className="stage-copy">Deterministic demo snapshots stand in for the normal Senso → OpenAI path.</p>
              <div className="evidence-grid">
                {assessment.offers.map((offer) => (
                  <article className="evidence-card" key={offer.offer.id}>
                    <div className="evidence-header"><h3>{offer.offer.merchant}</h3><span>Current fixture</span></div>
                    <blockquote>“{offer.evidence.exactText}”</blockquote>
                    <dl>
                      <div><dt>Collected</dt><dd>{new Date(offer.evidence.collectedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd></div>
                      <div><dt>Fingerprint</dt><dd>{offer.evidence.fingerprint}</dd></div>
                    </dl>
                    <a href={offer.evidence.sourceUrl}>Source reference <span aria-hidden="true">↗</span></a>
                  </article>
                ))}
              </div>
              <button className="primary-button" onClick={() => setStage("approval")} type="button">Review approval summary <span aria-hidden="true">→</span></button>
            </div>
          )}

          {stage === "approval" && assessment !== undefined && (
            <div className="stage-card compact">
              <p className="step-kicker">Step 5 of 7</p>
              <h2>Approval Summary</h2>
              <p className="stage-copy">The exact choice that a Purchase Authorization would cover.</p>
              <dl className="summary-list">
                <div><dt>Product</dt><dd>Sennheiser HD 560S · New · Black</dd></div>
                <div><dt>Merchant / seller</dt><dd>{assessment.recommendedOffer.offer.merchant} / {assessment.recommendedOffer.offer.seller}</dd></div>
                <div><dt>Quantity / destination</dt><dd>1 / {assessment.destinationReference}</dd></div>
                <div><dt>Confirmed Checkout Total</dt><dd>₹{assessment.recommendedOffer.checkoutQuote.totalInr.toLocaleString("en-IN")}</dd></div>
                <div><dt>Premium Limit</dt><dd>₹{assessment.premiumLimitInr.toLocaleString("en-IN")}</dd></div>
                <div><dt>Evidenced remedy</dt><dd>Change-of-mind money back · 7 days from delivery</dd></div>
                <div><dt>Trial Permission</dt><dd>Not permitted · sealed and unopened only</dd></div>
                <div><dt>Transport / fees</dt><dd>Self-ship · No fee stated—cost uncertain</dd></div>
              </dl>
              <label className="warning-check">
                <input checked={warningAcknowledged} onChange={(event) => setWarningAcknowledged(event.target.checked)} type="checkbox" />
                <span><strong>I acknowledge the unopened-only restriction</strong><small>Opening or trying the Product may remove the change-of-mind remedy.</small></span>
              </label>
              <button className="primary-button" disabled={!warningAcknowledged} onClick={() => setStage("checkout")} type="button">Continue to checkout <span aria-hidden="true">→</span></button>
            </div>
          )}

          {stage === "checkout" && assessment !== undefined && (
            <div className="stage-card compact decision-card">
              <p className="step-kicker">Step 6 of 7</p>
              <h2>Checkout decision</h2>
              <div className="decision-total"><span>Maximum authorized total</span><strong>₹{assessment.recommendedOffer.checkoutQuote.totalInr.toLocaleString("en-IN")}</strong></div>
              <p className="stage-copy">No checkout has been submitted. Declining creates an Undo Record without contacting Prava checkout.</p>
              <div className="button-row">
                <button className="secondary-button" onClick={declinePurchase} type="button">Decline purchase</button>
                <button className="primary-button" disabled type="button">Authorize sandbox checkout</button>
              </div>
              <small className="disabled-note">Purchase submission is intentionally outside this decline-path walking skeleton.</small>
            </div>
          )}

          {stage === "record" && record !== undefined && (
            <div className="stage-card wide record-card">
              <p className="step-kicker">Step 7 of 7</p>
              <div className="record-title"><div><h2>Undo Record</h2><p className="stage-copy">Reversibility Assessment saved.</p></div><span className="outcome">{record.outcome}</span></div>
              <div className="record-grid">
                <dl className="summary-list">
                  <div><dt>Record ID</dt><dd>{record.id}</dd></div>
                  <div><dt>Created</dt><dd>{new Date(record.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd></div>
                  <div><dt>Product</dt><dd>{record.product.manufacturer} {record.product.model}</dd></div>
                  <div><dt>Assessed choice</dt><dd>{record.selectedMerchant} / {record.selectedSeller}</dd></div>
                  <div><dt>Destination reference</dt><dd>{record.destinationReference}</dd></div>
                  <div><dt>Checkout</dt><dd>Not submitted</dd></div>
                </dl>
                <div className="version-panel"><h3>Reproducibility</h3><code>{record.versions.policySchema}</code><code>{record.versions.extractionPrompt}</code><code>{record.versions.model}</code><code>{record.versions.rankingRules}</code></div>
              </div>
              <div className="assumptions"><h3>Assumptions retained</h3><ul>{record.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>
            </div>
          )}
        </section>
      </main>

      <footer>Evidence over promises · Decision rules over scores</footer>
    </div>
  );
}
