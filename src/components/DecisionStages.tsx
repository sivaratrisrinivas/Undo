import type { PurchaseAuthorization, UndoRecord } from "../domain";
import { EvidenceCard } from "./EvidenceCard";

/** Renders the explicit decision point without submitting checkout. */
export function CheckoutStage(props: { readonly authorization: PurchaseAuthorization; readonly onDecline: () => void }) {
  return (
    <div className="stage-card compact decision-card">
      <p className="step-kicker">Step 6 of 7</p><h2>Checkout decision</h2>
      <div className="decision-total"><span>Maximum authorized total</span><strong>₹{props.authorization.binding.maximumTotalInr.toLocaleString("en-IN")}</strong></div>
      <dl className="summary-list"><div><dt>Purchase Authorization</dt><dd>{props.authorization.id} · Active</dd></div><div><dt>Expires</dt><dd>{new Date(props.authorization.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd></div><div><dt>Merchant / seller</dt><dd>{props.authorization.binding.merchant} / {props.authorization.binding.seller}</dd></div><div><dt>Destination</dt><dd>{props.authorization.binding.destinationReference}</dd></div><div><dt>Payment method</dt><dd>Prava one-time prepaid sandbox checkout</dd></div></dl>
      <p className="stage-copy">Authorization is active and single-use. No checkout has been submitted. Declining creates an Undo Record without contacting Prava checkout.</p>
      <div className="button-row"><button className="secondary-button" onClick={props.onDecline} type="button">Decline purchase</button><button className="primary-button" disabled type="button">Authorize sandbox checkout</button></div>
      <small className="disabled-note">Purchase submission belongs to the next implementation issue.</small>
    </div>
  );
}

/** Renders the retained, secret-free Undo Record. */
export function RecordStage({ record }: { readonly record: UndoRecord }) {
  const outcomeLabel = {
    buyer_declined: "Buyer declined",
    blocked_by_policy: "Policy blocked",
    blocked_by_price: "Price blocked",
    purchase_unavailable: "Purchase unavailable",
  }[record.outcome];
  return (
    <div className="stage-card wide record-card">
      <p className="step-kicker">Step 7 of 7</p>
      <div className="record-title"><div><h2>Undo Record</h2><p className="stage-copy">Reversibility Assessment saved.</p></div><span className="outcome">{outcomeLabel}</span></div>
      <div className="record-grid">
        <dl className="summary-list"><div><dt>Record ID</dt><dd>{record.id}</dd></div><div><dt>Created</dt><dd>{new Date(record.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd></div><div><dt>Product</dt><dd>{record.product.manufacturer} {record.product.model}</dd></div><div><dt>Assessed choice</dt><dd>{record.selectedMerchant === null ? "None — assessment blocked" : `${record.selectedMerchant} / ${record.selectedSeller}`}</dd></div><div><dt>Selection</dt><dd>{record.recommendation.selection.replaceAll("_", " ")}</dd></div><div><dt>Destination reference</dt><dd>{record.destinationReference}</dd></div><div><dt>Policy Evidence</dt><dd>{record.evidence.length} snapshots retained</dd></div><div><dt>Authorization</dt><dd>{record.authorizationState === "not_requested" ? "Not requested" : "Authorized, not submitted"}</dd></div><div><dt>Checkout</dt><dd>Not submitted</dd></div></dl>
        <div className="version-panel"><h3>Reproducibility</h3><code>{record.versions.policySchema}</code><code>{record.versions.extractionPrompt}</code><code>{record.versions.model}</code><code>{record.versions.rankingRules}</code></div>
      </div>
      {record.blockingReason !== undefined && <p className="error-message" role="alert">{record.blockingReason}</p>}
      {record.evidence.length > 0 && <div className="evidence-grid">{record.evidence.map((snapshot) => <EvidenceCard key={`${snapshot.offerId}:${snapshot.fingerprint}`} snapshot={snapshot} />)}</div>}
      <div className="assumptions"><h3>Assumptions retained</h3><ul>{record.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>
    </div>
  );
}
