import type {
  ApprovalSummary,
  AssessedOffer,
  BuyerOfferSelection,
  EvidenceSnapshot,
  PolicyAssessment,
  ReversibilityAssessment,
} from "../domain";
import { EvidenceCard } from "./EvidenceCard";
import {
  formatChangeOfMind,
  formatEvidenceState,
  formatProductCondition,
  formatRemedyWindow,
  formatReturnTransport,
  formatReversalCost,
} from "./policy-presentation";

function formatInr(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}

function selectionLabel(selection: BuyerOfferSelection["selection"]): string {
  return {
    ranking_winner: "Remedy Ranking winner",
    buyer_selected_tie: "Buyer-selected Tied Offer",
    buyer_override: "Buyer Override",
  }[selection];
}

function summaryCost(summary: ApprovalSummary): string {
  if (summary.buyerPaidCosts.kind === "explicit_none") return "₹0 evidenced";
  if (summary.buyerPaidCosts.kind === "known") return `${formatInr(summary.buyerPaidCosts.amountInr)} evidenced`;
  return "No fee stated—cost uncertain";
}

/** Combines comparison, evidence, warnings, and one-shot submission into one decision surface. */
export function AssessmentConsole(props: {
  readonly assessment: ReversibilityAssessment;
  readonly selectedOffer: BuyerOfferSelection | undefined;
  readonly summary: ApprovalSummary | undefined;
  readonly paymentMethodLabel: string;
  readonly purchaseEnabled: boolean;
  readonly acknowledgedWarnings: ReadonlySet<string>;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly onAcknowledgementChange: (warningId: string, checked: boolean) => void;
  readonly onAuthorizeAndSubmit: () => void;
  readonly onDecline: () => void;
  readonly onEdit: () => void;
  readonly onSelect: (offer: AssessedOffer) => void;
}) {
  const selected = props.selectedOffer?.offer;
  const summary = props.summary;
  const warningsAcknowledged = summary?.materialWarnings.every((warning) =>
    props.acknowledgedWarnings.has(warning.id),
  ) ?? false;
  const canSubmit = props.purchaseEnabled && summary !== undefined && warningsAcknowledged && !props.loading;
  const recommendation = props.assessment.ranking._tag === "winner"
    ? props.assessment.ranking.offer.offer.merchant
    : "Your choice";
  const checks = selected === undefined ? [] : [
    { label: "Exact Product", value: selected.offerEquivalent ? "Matched" : "Blocked" },
    { label: "Purchase Available", value: selected.checkoutQuote.purchaseAvailable ? "Live quote" : "Unavailable" },
    { label: "Official evidence", value: formatEvidenceState(selected.evidence) },
    { label: "Human review", value: selected.evidenceReview.state === "reviewed" ? "Reviewed" : "Required" },
    { label: "Minimum remedy", value: selected.eligible ? "Passed" : "Blocked" },
    { label: "Premium Limit", value: selected.premiumOverBaselineInr === null ? "Not applicable" : `${formatInr(selected.premiumOverBaselineInr)} within limit` },
    { label: "Checkout", value: "Single attempt" },
  ];

  return (
    <section className="assessment-surface" aria-labelledby="assessment-title">
      <header className="assessment-header">
        <div>
          <h1 id="assessment-title" tabIndex={-1}>Your Reversibility Assessment</h1>
          <p>One recommendation, with every price, rule, and source still attached.</p>
        </div>
        <div className="assessment-ready"><i aria-hidden="true" /><span>Assessment ready</span><small>Quotes and evidence checked now</small></div>
      </header>

      <div className="decision-layout">
        <section className="recommendation-readout" aria-labelledby="recommendation-title">
          <div className="readout-topline">
            <span>{props.assessment.ranking._tag === "winner" ? "Recommended Offer" : "Tied Offers"}</span>
            <span className="readout-signal"><i aria-hidden="true" /> Eligible</span>
          </div>
          <div className="readout-primary">
            <div>
              <h2 id="recommendation-title">{selected?.offer.merchant ?? recommendation}</h2>
              <p>{selected === undefined ? "Choose one eligible Offer to continue." : `Sold by ${selected.offer.seller}`}</p>
            </div>
            {selected !== undefined && (
              <div className="readout-price"><span>Confirmed total</span><strong>{formatInr(selected.checkoutQuote.totalInr)}</strong><small>{selected.premiumOverBaselineInr === null ? "No price baseline" : `${formatInr(selected.premiumOverBaselineInr)} over baseline`}</small></div>
            )}
          </div>
          <p className="ranking-reason"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg><span><strong>{props.assessment.ranking.reason}</strong> {selected?.explanation}</span></p>
          {selected !== undefined && (
            <div className="readout-specs">
              <div><span>Change of mind</span><strong>{formatChangeOfMind(selected.policy)}</strong><small>{formatProductCondition(selected.policy)}</small></div>
              <div><span>Remedy Window</span><strong>{formatRemedyWindow(selected.policy)}</strong><small>{selected.policy.productCondition === "trial_allowed" ? "Trial Permission evidenced" : "No Trial Permission evidenced"}</small></div>
              <div><span>Return path</span><strong>{formatReturnTransport(selected.policy)}</strong><small>{formatReversalCost(selected.policy)}</small></div>
              <div><span>Evidence</span><strong>{formatEvidenceState(selected.evidence)}</strong><small>{selected.evidenceReview.state === "reviewed" ? "Reviewed Evidence" : "Human review required"}</small></div>
            </div>
          )}
        </section>

        <aside className="assurance-console" aria-label="Seven automatic checks">
          <div className="assurance-heading"><h2>Seven checks</h2><span>Automatic</span></div>
          <ol>
            {checks.map((check) => (
              <li key={check.label}><i aria-hidden="true" /><span>{check.label}</span><strong>{check.value}</strong></li>
            ))}
          </ol>
          <p>The full chain stays inspectable. You only decide where consent is required.</p>
        </aside>
      </div>

      <section className="offer-comparison" aria-labelledby="comparison-title">
        <div className="section-heading">
          <div><h2 id="comparison-title">Offer comparison</h2><p>Equivalent Offers only. Totals include applied discounts, delivery, and taxes.</p></div>
          <button className="text-button" onClick={props.onEdit} type="button">Edit setup</button>
        </div>
        <fieldset className="offer-selector">
          <legend className="sr-only">Choose an eligible Offer</legend>
          {props.assessment.offers.map((offer) => {
            const isRecommended = props.assessment.ranking._tag === "winner" && props.assessment.ranking.offer.offer.id === offer.offer.id;
            const choice = isRecommended ? "recommended" : offer.eligible ? "eligible Buyer Override" : "not eligible";
            return (
              <label className={props.selectedOffer?.offer.offer.id === offer.offer.id ? "offer-channel selected" : "offer-channel"} key={offer.offer.id}>
                <input checked={props.selectedOffer?.offer.offer.id === offer.offer.id} disabled={!offer.eligible} name="offer-choice" onChange={() => props.onSelect(offer)} type="radio" />
                <span className="channel-merchant"><strong>{offer.offer.merchant}</strong><small>{offer.offer.seller} · {choice}</small></span>
                <span className="channel-price"><strong>{formatInr(offer.checkoutQuote.totalInr)}</strong><small>Item {formatInr(offer.checkoutQuote.itemTotalInr)} · Delivery {formatInr(offer.checkoutQuote.deliveryInr)} · Taxes {formatInr(offer.checkoutQuote.taxesInr)}</small></span>
                <span className="channel-remedy"><strong>{formatChangeOfMind(offer.policy)}</strong><small>{formatRemedyWindow(offer.policy)} · {formatReturnTransport(offer.policy)} · {formatReversalCost(offer.policy)}</small></span>
                <span className="channel-evidence"><strong>{formatEvidenceState(offer.evidence)}</strong><small>{offer.evidenceReview.state === "reviewed" ? "Reviewed Evidence" : "Review required"}</small></span>
                <span className={offer.eligible ? "channel-state eligible" : "channel-state blocked"}>{offer.eligible ? "Eligible" : "Blocked"}</span>
                <span className="channel-explanation">{offer.explanation}</span>
                <span className="channel-quote">“{offer.policy.quote}”</span>
                {offer.checkoutQuote.advertisedDiscounts.length > 0 && <small className="excluded-value">Advertised only: excluded from total</small>}
                {(offer.checkoutQuote.cashbackInr > 0 || offer.checkoutQuote.rewardPoints > 0) && <small className="excluded-value">Cashback/rewards: excluded from total</small>}
              </label>
            );
          })}
        </fieldset>
        {props.selectedOffer?.selection === "buyer_override" && <p className="notice-message">Buyer Override selected: {props.selectedOffer.offer.offer.merchant}. This Offer still passes every eligibility rule.</p>}
      </section>

      <details className="evidence-disclosure">
        <summary><span><strong>Inspect all Policy Evidence</strong><small>Official wording, exact citations, collection time, scope, and fingerprint</small></span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg></summary>
        <div className="evidence-body">
          <h2>Policy Evidence</h2>
          <p>Official merchant wording retrieved through Senso and reviewed by exact content fingerprint.</p>
          <div className="evidence-grid">
            {props.assessment.offers.map((offer) => <EvidenceCard key={offer.offer.id} policy={offer.policy} reviewState={offer.evidenceReview.state} snapshot={offer.evidence} />)}
          </div>
        </div>
      </details>

      <section className="approval-console" aria-labelledby="approval-title">
        <div className="approval-copy">
          <h2 id="approval-title">Approval Summary</h2>
          <p>Read the exact choice, acknowledge each Material Warning, then authorize one submission. Nothing retries automatically.</p>
          {summary !== undefined && props.selectedOffer !== undefined && (
            <dl className="summary-list">
              <div><dt>Product</dt><dd>{summary.product.manufacturer} {summary.product.model} · {summary.product.condition} · {summary.product.variant} · {summary.product.bundleContents} · {summary.product.warrantyRegion} warranty region</dd></div>
              <div><dt>Merchant / seller</dt><dd>{summary.merchant} / {summary.seller}</dd></div>
              <div><dt>Selection</dt><dd>{selectionLabel(props.selectedOffer.selection)}</dd></div>
              <div><dt>Quantity / destination</dt><dd>{summary.quantity} / {summary.destinationReference}</dd></div>
              <div><dt>Payment method</dt><dd>{props.paymentMethodLabel}</dd></div>
              <div><dt>Total / authorized maximum</dt><dd>{formatInr(summary.confirmedCheckoutTotalInr)} / {formatInr(summary.maximumTotalInr)}</dd></div>
              <div><dt>Premium Limit</dt><dd>{formatInr(summary.premiumLimitInr)}</dd></div>
              <div><dt>Evidenced remedy</dt><dd>{summary.remedy === "money_back" ? "Change-of-mind money back" : "Change-of-mind store credit"} · {summary.remedyWindow.days} days from {summary.remedyWindow.startsAt} · {summary.remedyWindow.requiredAction.replaceAll("_", " ")}</dd></div>
              <div><dt>Trial Permission</dt><dd>{summary.trialPermission ? "Trial permitted" : "No Trial Permission evidenced"}</dd></div>
              <div><dt>Return path / buyer-paid costs</dt><dd>{summary.returnTransport === "doorstep_pickup" ? "Doorstep pickup" : "Self-shipping"} · {summaryCost(summary)}</dd></div>
              <div><dt>Evidence</dt><dd>{new Date(summary.evidence.collectedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {summary.evidence.retrievalState === "cached" ? "Cached Evidence" : "Current Evidence"} · Reviewed Evidence</dd></div>
              <div><dt>Material Remedy Conditions</dt><dd>{summary.materialConditions.length === 0 ? "None evidenced" : summary.materialConditions.join(" ")}</dd></div>
            </dl>
          )}
        </div>

        <div className="authorization-panel">
          {summary === undefined ? (
            <p className="empty-message">Choose an eligible Offer to prepare the exact Purchase Authorization.</p>
          ) : (
            <>
              <div className="authorization-total"><span>Authorize up to</span><strong>{formatInr(summary.maximumTotalInr)}</strong><small>Single use · valid for 10 minutes</small></div>
              <div className="warning-list">
                {summary.materialWarnings.length > 0 && (
                  <label className="warning-check">
                    <input
                      checked={warningsAcknowledged}
                      onChange={(event) => summary.materialWarnings.forEach((warning) => props.onAcknowledgementChange(warning.id, event.target.checked))}
                      type="checkbox"
                    />
                    <span>
                      <strong>I acknowledge every Material Warning for this exact purchase:</strong>
                      <ul>{summary.materialWarnings.map((warning) => <li key={warning.id}>{warning.detail}</li>)}</ul>
                      <small>One explicit acknowledgement covers only the warnings listed here.</small>
                    </span>
                  </label>
                )}
              </div>
              {!props.purchaseEnabled && <p className="error-message" role="alert">Purchase Authorization is blocked until the human-reviewed policy contract is enabled.</p>}
              {props.error !== undefined && <p className="error-message" role="alert">{props.error}</p>}
              <button className="primary-button authorize-button" disabled={!canSubmit} onClick={props.onAuthorizeAndSubmit} type="button">
                <span>{props.loading ? "Complete the Prava sandbox approval…" : `Authorize ${formatInr(summary.maximumTotalInr)} & submit once`}</span>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M14 7l5 5-5 5" /></svg>
              </button>
              <button className="secondary-button" disabled={props.loading} onClick={props.onDecline} type="button">Save assessment without buying</button>
              <p className="single-use-note">This control creates the ten-minute Purchase Authorization and immediately consumes it for exactly one Prava attempt. A timeout becomes “Purchase outcome unknown”; Undo will not retry.</p>
            </>
          )}
        </div>
      </section>
    </section>
  );
}

/** Lets an authorized human reviewer approve changed evidence before reassessment. */
export function EvidenceReviewStage(props: {
  readonly candidates: ReadonlyArray<{ readonly snapshot: EvidenceSnapshot; readonly policy: PolicyAssessment }>;
  readonly loading: boolean;
  readonly onApprove: () => void;
}) {
  return (
    <section className="review-surface" aria-labelledby="review-title">
      <div className="section-heading"><div><h1 id="review-title" tabIndex={-1}>Review changed Policy Evidence</h1><p>Operations review queue; buyer flow paused. This is a separate reviewer workflow, not a buyer action. Purchase Authorization remains blocked until an authorized reviewer approves these exact fingerprints, extracted facts, and quotes.</p></div><span className="reviewer-gate">Operations review</span></div>
      <div className="evidence-grid">
        {props.candidates.map((candidate) => <EvidenceCard key={candidate.snapshot.fingerprint} policy={candidate.policy} reviewState="unreviewed" snapshot={candidate.snapshot} />)}
      </div>
      <button className="primary-button" disabled={props.loading} onClick={props.onApprove} type="button">{props.loading ? "Saving reviewer decision…" : "Reviewer approval: accept evidence and reassess"}</button>
    </section>
  );
}
