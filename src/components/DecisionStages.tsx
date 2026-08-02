import type { UndoRecord } from "../domain";
import { EvidenceCard } from "./EvidenceCard";

/** Renders the retained, secret-free Undo Record after the third action. */
export function RecordStage({ error, record }: { readonly error: string | undefined; readonly record: UndoRecord }) {
  const outcomeLabel = {
    purchased: "Purchased",
    buyer_declined: "Buyer declined",
    blocked_by_policy: "Policy blocked",
    blocked_by_price: "Price blocked",
    purchase_unavailable: "Purchase unavailable",
    outcome_unknown: "Purchase outcome unknown",
  }[record.outcome];
  const authorizationLabel = {
    not_requested: "Not requested",
    authorized_not_submitted: "Authorized, not submitted",
    used_without_submission: "Consumed safely, checkout not submitted",
    used: "Used for one checkout attempt",
  }[record.authorizationState];
  const checkoutLabel = {
    not_submitted: "Not submitted",
    payment_succeeded: "Payment successful and merchant order confirmed",
    confirmed_failure: "Confirmed failure — no automatic retry",
    outcome_unknown: "Unknown — an order may exist; no automatic retry",
  }[record.pravaStatus];
  return (
    <section className="record-surface" aria-labelledby="record-title">
      <header className="record-header">
        <div>
          <div className="record-seal" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="m7 16 6 6L26 8" /></svg></div>
          <div><h1 id="record-title" tabIndex={-1}>Undo Record</h1><p>Reversibility Assessment saved without payment secrets or a full address.</p></div>
        </div>
        <span className={`outcome outcome-${record.outcome}`}>{outcomeLabel}</span>
      </header>

      {error !== undefined && <p className="error-message" role="alert">{error}</p>}
      {record.blockingReason !== undefined && <p className="error-message" role="alert">{record.blockingReason}</p>}

      <div className="record-layout">
        <dl className="summary-list record-summary">
          <div><dt>Record ID</dt><dd>{record.id}</dd></div>
          <div><dt>Created</dt><dd>{new Date(record.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd></div>
          <div><dt>Product</dt><dd>{record.product.manufacturer} {record.product.model}</dd></div>
          <div><dt>Assessed choice</dt><dd>{record.selectedMerchant === null ? "None — assessment blocked" : `${record.selectedMerchant} / ${record.selectedSeller}`}</dd></div>
          <div><dt>Selection</dt><dd>{record.recommendation.selection.replaceAll("_", " ")}</dd></div>
          <div><dt>Destination reference</dt><dd>{record.destinationReference}</dd></div>
          <div><dt>Policy Evidence</dt><dd>{record.evidence.length} snapshots retained</dd></div>
          <div><dt>Authorization</dt><dd>{authorizationLabel}</dd></div>
          <div><dt>Checkout</dt><dd>{checkoutLabel}</dd></div>
          {record.merchantOrderIdentifier !== null && <div><dt>Merchant order</dt><dd>{record.merchantOrderIdentifier}</dd></div>}
        </dl>

        <aside className="version-panel">
          <h2>Reproducibility</h2>
          <p>The exact policy, extraction, model, and ranking versions retained with this decision.</p>
          <code>{record.versions.policySchema}</code>
          <code>{record.versions.extractionPrompt}</code>
          <code>{record.versions.model}</code>
          <code>{record.versions.rankingRules}</code>
        </aside>
      </div>

      {record.previousSandboxPurchase !== undefined && <aside className="warning-box"><strong>Previous Sandbox Purchase — historical only</strong><p>Original purchase: {new Date(record.previousSandboxPurchase.purchasedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p><p>Original order: {record.previousSandboxPurchase.merchantOrderIdentifier}</p><p>This is not success for the current attempt.</p></aside>}

      {record.evidence.length > 0 && (
        <details className="evidence-disclosure record-evidence">
          <summary><span><strong>Evidence retained with this record</strong><small>{record.evidence.length} exact snapshots</small></span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg></summary>
          <div className="evidence-grid">{record.evidence.map((snapshot) => <EvidenceCard key={`${snapshot.offerId}:${snapshot.fingerprint}`} snapshot={snapshot} />)}</div>
        </details>
      )}

      <div className="assumptions"><h2>Assumptions retained</h2><ul>{record.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>
    </section>
  );
}
