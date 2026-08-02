import type { AssessedOffer, BuyerOfferSelection, EvidenceSnapshot, PolicyAssessment, ReversibilityAssessment } from "../domain";
import { EvidenceCard } from "./EvidenceCard";
import {
  formatChangeOfMind,
  formatEvidenceState,
  formatPolicyFact,
  formatProductCondition,
  formatRemedyWindow,
  formatReturnTransport,
  formatReversalCost,
} from "./policy-presentation";

/** Renders the deterministic Remedy Ranking comparison. */
export function ComparisonStage(props: {
  readonly assessment: ReversibilityAssessment;
  readonly selectedOffer: BuyerOfferSelection | undefined;
  readonly onContinue: () => void;
  readonly onSelect: (offer: AssessedOffer) => void;
}) {
  const winnerIds = new Set(
    props.assessment.ranking._tag === "winner"
      ? [props.assessment.ranking.offer.offer.id]
      : props.assessment.ranking.offers.map((offer) => offer.offer.id),
  );
  return (
    <div className="stage-card wide">
      <p className="step-kicker">Step 3 of 7</p><h2>Offer comparison</h2>
      <p className="stage-copy">Only exact Product and seller matches can rank. Prava totals include delivery, taxes, and discounts applied at checkout.</p>
      <div className="ranking-callout">
        <strong>{props.assessment.ranking._tag === "winner" ? `${props.assessment.ranking.offer.offer.merchant} is recommended.` : "Tied Offers need your choice."}</strong>
        <span>{props.assessment.ranking.reason}</span>
      </div>
      <div className="offer-table" aria-label="Equivalent Offer comparison">
        {props.assessment.offers.map((offer) => {
          const policy = offer.policy;
          const window = formatRemedyWindow(policy);
          const transport = formatReturnTransport(policy);
          const cost = formatReversalCost(policy);
          const condition = formatProductCondition(policy);
          const evidenceState = formatEvidenceState(offer.evidence);
          const collected = new Date(offer.evidence.collectedAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
          <article className={winnerIds.has(offer.offer.id) ? "offer-row winner" : "offer-row"} key={offer.offer.id}>
            <div><span className="merchant">{offer.offer.merchant}</span><small>Seller: {offer.offer.seller}</small></div>
            <div>
              <span className="cell-label">Confirmed total</span>
              <strong>₹{offer.checkoutQuote.totalInr.toLocaleString("en-IN")}</strong>
              {offer.premiumOverBaselineInr !== null && <small>Baseline ₹{props.assessment.baselineTotalInr.toLocaleString("en-IN")} · premium ₹{offer.premiumOverBaselineInr.toLocaleString("en-IN")}</small>}
              <small>Item ₹{offer.checkoutQuote.itemTotalInr.toLocaleString("en-IN")} · Delivery ₹{offer.checkoutQuote.deliveryInr.toLocaleString("en-IN")} · Taxes ₹{offer.checkoutQuote.taxesInr.toLocaleString("en-IN")}</small>
              {offer.checkoutQuote.appliedDiscounts.length > 0 && <small>Applied: {offer.checkoutQuote.appliedDiscounts.map((discount) => `${discount.label} ₹${discount.amountInr.toLocaleString("en-IN")}`).join(", ")}</small>}
              {offer.checkoutQuote.advertisedDiscounts.length > 0 && <small>Advertised only: excluded from total</small>}
              {(offer.checkoutQuote.cashbackInr > 0 || offer.checkoutQuote.rewardPoints > 0) && <small>Cashback/rewards: excluded from total</small>}
            </div>
            <div><span className="cell-label">Change of mind</span><strong>{formatChangeOfMind(policy)}</strong><small>{condition}</small><small>{window}</small></div>
            <div><span className="cell-label">Transport / Reversal Cost</span><strong>{transport} · {cost}</strong></div>
            <div><span className="cell-label">Evidence</span><strong>{evidenceState} · {offer.evidenceReview.state === "reviewed" ? "Reviewed Evidence" : "Review required"}</strong><small>Collected {collected}</small></div>
            <div><span className="cell-label">Assessment</span><strong>{offer.explanation}</strong></div>
            <div className="offer-policy">
              <span className="cell-label">Exact Policy Evidence</span>
              {policy.citations.map((citation, index) => (
                <div className="comparison-citation" key={`${citation.fact}:${index}`}>
                  <strong>{citation.fact.replaceAll("_", " ")}: {formatPolicyFact(policy, citation.fact)}</strong>
                  <blockquote>“{citation.quote}”</blockquote>
                  <a href={citation.sourceUrl}>{citation.sourceUrl} <span aria-hidden="true">↗</span></a>
                </div>
              ))}
              {policy.materialConditions.map((item) => (
                <div className="comparison-citation" key={item.detail}>
                  <strong>Remedy Condition: {item.detail}</strong>
                  <blockquote>“{item.citation.quote}”</blockquote>
                  <a href={item.citation.sourceUrl}>{item.citation.sourceUrl} <span aria-hidden="true">↗</span></a>
                </div>
              ))}
            </div>
          </article>
        );})}
      </div>
      <fieldset className="offer-choice">
        <legend>{props.assessment.ranking._tag === "tied" ? "These Offers are tied. Choose before continuing." : "Choose the recommendation or an eligible Buyer Override."}</legend>
        {props.assessment.offers.map((offer) => {
          const isRecommended = props.assessment.ranking._tag === "winner" && props.assessment.ranking.offer.offer.id === offer.offer.id;
          const choiceLabel = isRecommended ? "recommended" : offer.eligible ? "eligible Buyer Override" : "not eligible";
          return (
            <label key={offer.offer.id}>
              <input checked={props.selectedOffer?.offer.offer.id === offer.offer.id} disabled={!offer.eligible} name="offer-choice" onChange={() => props.onSelect(offer)} type="radio" />
              <span>{offer.offer.merchant} <small>— {choiceLabel}</small></span>
            </label>
          );
        })}
      </fieldset>
      {props.selectedOffer?.selection === "buyer_override" && <p className="override-note">Buyer Override selected: {props.selectedOffer.offer.offer.merchant}. This Offer still passes every eligibility rule.</p>}
      <button className="primary-button" disabled={props.selectedOffer === undefined} onClick={props.onContinue} type="button">Inspect evidence <span aria-hidden="true">→</span></button>
    </div>
  );
}

/** Renders exact Policy Evidence and provenance for every Offer. */
export function EvidenceStage(props: { readonly assessment: ReversibilityAssessment; readonly onContinue: () => void }) {
  return (
    <div className="stage-card wide">
      <p className="step-kicker">Step 4 of 7</p><h2>Policy Evidence</h2>
      <p className="stage-copy">Official merchant wording retrieved through Senso and reviewed by exact content fingerprint.</p>
      <div className="evidence-grid">
        {props.assessment.offers.map((offer) => (
          <EvidenceCard key={offer.offer.id} policy={offer.policy} reviewState={offer.evidenceReview.state} snapshot={offer.evidence} />
        ))}
      </div>
      <button className="primary-button" onClick={props.onContinue} type="button">Review approval summary <span aria-hidden="true">→</span></button>
    </div>
  );
}

/** Lets an authorized human reviewer approve the exact extracted facts and fingerprints. */
export function EvidenceReviewStage(props: {
  readonly candidates: ReadonlyArray<{
    readonly snapshot: EvidenceSnapshot;
    readonly policy: PolicyAssessment;
  }>;
  readonly loading: boolean;
  readonly onApprove: () => void;
}) {
  return (
    <div className="stage-card wide">
      <p className="step-kicker">Human evidence review</p>
      <h2>Review changed Policy Evidence</h2>
      <p className="error-message" role="alert">Purchase Authorization is blocked until a human approves these exact fingerprints, extracted facts, and quotes.</p>
      <div className="evidence-grid">
        {props.candidates.map((candidate) => (
          <EvidenceCard key={candidate.snapshot.fingerprint} policy={candidate.policy} reviewState="unreviewed" snapshot={candidate.snapshot} />
        ))}
      </div>
      <button className="primary-button" disabled={props.loading} onClick={props.onApprove} type="button">{props.loading ? "Saving review…" : "Approve exact evidence and reassess"}</button>
    </div>
  );
}

/** Renders the exact recommendation and required Material Warning acknowledgement. */
export function ApprovalStage(props: {
  readonly assessment: ReversibilityAssessment;
  readonly selectedOffer: AssessedOffer;
  readonly selection: BuyerOfferSelection["selection"];
  readonly purchaseEnabled: boolean;
  readonly acknowledgedWarnings: ReadonlySet<string>;
  readonly onAcknowledgementChange: (warning: string, checked: boolean) => void;
  readonly onContinue: () => void;
}) {
  const policy = props.selectedOffer.policy;
  const remedy = policy.changeOfMind === "money_back" ? "Change-of-mind money back" : "Change-of-mind store credit";
  const condition = policy.productCondition === "trial_allowed" ? "Trial permitted" : formatProductCondition(policy);
  const transport = formatReturnTransport(policy);
  const cost = formatReversalCost(policy);
  const window = formatRemedyWindow(policy);
  const warnings = [
    ...policy.materialConditions.map((condition) => condition.detail),
    ...(policy.reversalCost.kind === "unstated" ? ["No fee stated—cost uncertain."] : []),
  ];
  const warningsAcknowledged = warnings.every((warning) => props.acknowledgedWarnings.has(warning));
  const canContinue = props.purchaseEnabled && warningsAcknowledged;
  return (
    <div className="stage-card compact">
      <p className="step-kicker">Step 5 of 7</p><h2>Approval Summary</h2><p className="stage-copy">The exact choice that a Purchase Authorization would cover.</p>
      <dl className="summary-list">
        <div><dt>Product</dt><dd>{props.assessment.product.manufacturer} {props.assessment.product.model} · {props.assessment.product.condition} · {props.assessment.product.variant}</dd></div><div><dt>Merchant / seller</dt><dd>{props.selectedOffer.offer.merchant} / {props.selectedOffer.offer.seller}</dd></div><div><dt>Selection</dt><dd>{{ ranking_winner: "Remedy Ranking winner", buyer_selected_tie: "Buyer-selected Tied Offer", buyer_override: "Buyer Override" }[props.selection]}</dd></div><div><dt>Quantity / destination</dt><dd>1 / {props.assessment.destinationReference}</dd></div><div><dt>Confirmed Checkout Total</dt><dd>₹{props.selectedOffer.checkoutQuote.totalInr.toLocaleString("en-IN")}</dd></div><div><dt>Premium Limit</dt><dd>₹{props.assessment.premiumLimitInr.toLocaleString("en-IN")}</dd></div><div><dt>Evidenced remedy</dt><dd>{remedy} · {window}</dd></div><div><dt>Trial Permission</dt><dd>{condition}</dd></div><div><dt>Transport / fees</dt><dd>{transport} · {cost}</dd></div>
        <div><dt>Evidence state</dt><dd>{props.selectedOffer.evidence.retrievalState === "cached" ? "Cached Evidence" : "Current Evidence"} · Reviewed Evidence</dd></div>
      </dl>
      <div className="policy-citation"><h3>Supporting Policy Evidence</h3><blockquote>“{policy.quote}”</blockquote><a href={props.selectedOffer.evidence.sourceUrl}>{props.selectedOffer.evidence.sourceUrl} <span aria-hidden="true">↗</span></a><small>Collected {new Date(props.selectedOffer.evidence.collectedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {props.selectedOffer.evidence.scope.kind}: {props.selectedOffer.evidence.scope.value}</small></div>
      {warnings.map((warning) => (
        <label className="warning-check" key={warning}><input checked={props.acknowledgedWarnings.has(warning)} onChange={(event) => props.onAcknowledgementChange(warning, event.target.checked)} type="checkbox" /><span><strong>I acknowledge: {warning}</strong></span></label>
      ))}
      {!props.purchaseEnabled && (
        <p className="error-message" role="alert">Purchase is blocked until OpenAI extraction passes the human-reviewed official-source policy contract.</p>
      )}
      <button className="primary-button" disabled={!canContinue} onClick={props.onContinue} type="button">Continue to checkout <span aria-hidden="true">→</span></button>
    </div>
  );
}
