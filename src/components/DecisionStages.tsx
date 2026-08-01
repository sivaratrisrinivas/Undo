import type { AssessedOffer, UndoRecord } from "../domain";

/** Renders the explicit decision point without submitting checkout. */
export function CheckoutStage(props: { readonly selectedOffer: AssessedOffer; readonly onDecline: () => void }) {
  return (
    <div className="stage-card compact decision-card">
      <p className="step-kicker">Step 6 of 7</p><h2>Checkout decision</h2>
      <div className="decision-total"><span>Maximum authorized total</span><strong>₹{props.selectedOffer.checkoutQuote.totalInr.toLocaleString("en-IN")}</strong></div>
      <p className="stage-copy">No checkout has been submitted. Declining creates an Undo Record without contacting Prava checkout.</p>
      <div className="button-row"><button className="secondary-button" onClick={props.onDecline} type="button">Decline purchase</button><button className="primary-button" disabled type="button">Authorize sandbox checkout</button></div>
      <small className="disabled-note">Purchase submission is intentionally outside this decline-path walking skeleton.</small>
    </div>
  );
}

/** Renders the retained, secret-free Undo Record. */
export function RecordStage({ record }: { readonly record: UndoRecord }) {
  return (
    <div className="stage-card wide record-card">
      <p className="step-kicker">Step 7 of 7</p>
      <div className="record-title"><div><h2>Undo Record</h2><p className="stage-copy">Reversibility Assessment saved.</p></div><span className="outcome">{record.outcome}</span></div>
      <div className="record-grid">
        <dl className="summary-list"><div><dt>Record ID</dt><dd>{record.id}</dd></div><div><dt>Created</dt><dd>{new Date(record.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd></div><div><dt>Product</dt><dd>{record.product.manufacturer} {record.product.model}</dd></div><div><dt>Assessed choice</dt><dd>{record.selectedMerchant} / {record.selectedSeller}</dd></div><div><dt>Destination reference</dt><dd>{record.destinationReference}</dd></div><div><dt>Policy Evidence</dt><dd>{record.evidence.length} snapshots retained</dd></div><div><dt>Authorization</dt><dd>Not requested</dd></div><div><dt>Checkout</dt><dd>Not submitted</dd></div></dl>
        <div className="version-panel"><h3>Reproducibility</h3><code>{record.versions.policySchema}</code><code>{record.versions.extractionPrompt}</code><code>{record.versions.model}</code><code>{record.versions.rankingRules}</code></div>
      </div>
      <div className="assumptions"><h3>Assumptions retained</h3><ul>{record.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>
    </div>
  );
}
