import type { AssessedOffer, Offer, ReversibilityAssessment } from "../domain";

/** Renders the deterministic Remedy Ranking comparison. */
export function ComparisonStage(props: {
  readonly assessment: ReversibilityAssessment;
  readonly selectedOfferId: Offer["id"] | undefined;
  readonly onContinue: () => void;
  readonly onSelect: (offer: AssessedOffer) => void;
}) {
  return (
    <div className="stage-card wide">
      <p className="step-kicker">Step 3 of 7</p><h2>Offer comparison</h2>
      <p className="stage-copy">Equivalent Product identity confirmed. Ranking follows explicit remedy rules—not an AI score.</p>
      <div className="offer-table" aria-label="Equivalent Offer comparison">
        {props.assessment.offers.map((offer) => (
          <article className={offer.eligible ? "offer-row winner" : "offer-row"} key={offer.offer.id}>
            <div><span className="merchant">{offer.offer.merchant}</span><small>Seller: {offer.offer.seller}</small></div>
            <div><span className="cell-label">Confirmed total</span><strong>₹{offer.checkoutQuote.totalInr.toLocaleString("en-IN")}</strong></div>
            <div><span className="cell-label">Change of mind</span><strong>{offer.policy.changeOfMind === "money_back" ? "Money back" : "Not evidenced"}</strong></div>
            <div><span className="cell-label">Assessment</span><strong>{offer.explanation}</strong></div>
          </article>
        ))}
      </div>
      {props.assessment.ranking._tag === "tied" && (
        <fieldset className="tie-choice">
          <legend>These Offers are tied. Choose before continuing.</legend>
          {props.assessment.ranking.offers.map((offer) => (
            <label key={offer.offer.id}>
              <input checked={props.selectedOfferId === offer.offer.id} name="tied-offer" onChange={() => props.onSelect(offer)} type="radio" />
              {offer.offer.merchant}
            </label>
          ))}
        </fieldset>
      )}
      <button className="primary-button" disabled={props.selectedOfferId === undefined} onClick={props.onContinue} type="button">Inspect evidence <span aria-hidden="true">→</span></button>
    </div>
  );
}

/** Renders exact Policy Evidence and provenance for every Offer. */
export function EvidenceStage(props: { readonly assessment: ReversibilityAssessment; readonly onContinue: () => void }) {
  return (
    <div className="stage-card wide">
      <p className="step-kicker">Step 4 of 7</p><h2>Policy Evidence</h2>
      <p className="stage-copy">Deterministic demo snapshots stand in for the normal Senso → OpenAI path.</p>
      <div className="evidence-grid">
        {props.assessment.offers.map((offer) => (
          <article className="evidence-card" key={offer.offer.id}>
            <div className="evidence-header"><h3>{offer.offer.merchant}</h3><span>Current fixture</span></div>
            <blockquote>“{offer.evidence.exactText}”</blockquote>
            <dl><div><dt>Collected</dt><dd>{new Date(offer.evidence.collectedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd></div><div><dt>Fingerprint</dt><dd>{offer.evidence.fingerprint}</dd></div></dl>
            <a href={offer.evidence.sourceUrl}>Source reference <span aria-hidden="true">↗</span></a>
          </article>
        ))}
      </div>
      <button className="primary-button" onClick={props.onContinue} type="button">Review approval summary <span aria-hidden="true">→</span></button>
    </div>
  );
}

/** Renders the exact recommendation and required Material Warning acknowledgement. */
export function ApprovalStage(props: {
  readonly assessment: ReversibilityAssessment;
  readonly selectedOffer: AssessedOffer;
  readonly acknowledgedWarnings: ReadonlySet<string>;
  readonly onAcknowledgementChange: (warning: string, checked: boolean) => void;
  readonly onContinue: () => void;
}) {
  const policy = props.selectedOffer.policy;
  const remedy = policy.changeOfMind === "money_back" ? "Change-of-mind money back" : "Change-of-mind store credit";
  const condition = policy.productCondition === "trial_allowed" ? "Trial permitted" : policy.productCondition === "opened_unused" ? "Opened but unused" : "Sealed and unopened only";
  const transport = policy.returnTransport === "doorstep_pickup" ? "Doorstep pickup" : "Self-ship";
  const cost = policy.reversalCost.kind === "explicit_none" ? "₹0 evidenced" : policy.reversalCost.kind === "known" ? `₹${policy.reversalCost.amountInr.toLocaleString("en-IN")}` : "No fee stated—cost uncertain";
  const warnings = [
    ...policy.materialConditions,
    ...(policy.reversalCost.kind === "unstated" ? ["No fee stated—cost uncertain."] : []),
  ];
  const warningsAcknowledged = warnings.every((warning) => props.acknowledgedWarnings.has(warning));
  return (
    <div className="stage-card compact">
      <p className="step-kicker">Step 5 of 7</p><h2>Approval Summary</h2><p className="stage-copy">The exact choice that a Purchase Authorization would cover.</p>
      <dl className="summary-list">
        <div><dt>Product</dt><dd>Sennheiser HD 560S · New · Black</dd></div><div><dt>Merchant / seller</dt><dd>{props.selectedOffer.offer.merchant} / {props.selectedOffer.offer.seller}</dd></div><div><dt>Quantity / destination</dt><dd>1 / {props.assessment.destinationReference}</dd></div><div><dt>Confirmed Checkout Total</dt><dd>₹{props.selectedOffer.checkoutQuote.totalInr.toLocaleString("en-IN")}</dd></div><div><dt>Premium Limit</dt><dd>₹{props.assessment.premiumLimitInr.toLocaleString("en-IN")}</dd></div><div><dt>Evidenced remedy</dt><dd>{remedy} · {policy.remedyWindow.days} days from {policy.remedyWindow.startsAt}</dd></div><div><dt>Trial Permission</dt><dd>{condition}</dd></div><div><dt>Transport / fees</dt><dd>{transport} · {cost}</dd></div>
      </dl>
      {warnings.map((warning) => (
        <label className="warning-check" key={warning}><input checked={props.acknowledgedWarnings.has(warning)} onChange={(event) => props.onAcknowledgementChange(warning, event.target.checked)} type="checkbox" /><span><strong>I acknowledge: {warning}</strong></span></label>
      ))}
      <button className="primary-button" disabled={!warningsAcknowledged} onClick={props.onContinue} type="button">Continue to checkout <span aria-hidden="true">→</span></button>
    </div>
  );
}
