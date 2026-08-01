import type { EvidenceSnapshot, PolicyAssessment } from "../domain";

function policyFacts(policy: PolicyAssessment) {
  const changeOfMind = {
    money_back: "Change-of-Mind Return",
    store_credit: "Change-of-Mind Exchange",
    none: "No change-of-mind remedy",
    unclear: "Change-of-mind remedy unclear",
  }[policy.changeOfMind];
  const defect = {
    replacement: "Replacement",
    money_back: "Defect refund",
    none: "No defect remedy",
    unclear: "Defect remedy unclear",
  }[policy.defect];
  const condition = {
    unopened_only: "Sealed and unopened",
    opened_unused: "Opened but unused",
    trial_allowed: "Trial Permission",
    unclear: "Policy Unclear",
  }[policy.productCondition];
  const transport = {
    doorstep_pickup: "Doorstep pickup",
    self_ship: "Self-shipping",
    unclear: "Policy Unclear",
  }[policy.returnTransport];
  const cost =
    policy.reversalCost.kind === "known"
      ? `₹${policy.reversalCost.amountInr} Reversal Cost`
      : {
          explicit_none: "Explicit ₹0 Reversal Cost",
          unstated: "Unstated Cost",
          unpriced_required: "Unpriced Required Cost",
          unclear: "Policy Unclear",
        }[policy.reversalCost.kind];
  return {
    remedy: `${changeOfMind}; defect remedy: ${defect}`,
    window:
      policy.remedyWindow.kind === "known"
        ? `${policy.remedyWindow.days} days from ${policy.remedyWindow.startsAt}; ${policy.remedyWindow.requiredAction.replaceAll("_", " ")}`
        : "Policy Unclear",
    product_condition: condition,
    return_transport: transport,
    buyer_paid_fees: cost,
  } as const;
}

/** Shows the exact wording and provenance of one Evidence Snapshot. */
export function EvidenceCard(props: {
  readonly snapshot: EvidenceSnapshot;
  readonly policy?: PolicyAssessment;
  readonly reviewState?: "reviewed" | "unreviewed";
}) {
  const snapshot = props.snapshot;
  const policy = props.policy;
  const stateLabel = {
    current: "Current Evidence",
    cached: "Cached Evidence",
    stale: "Stale Evidence",
  }[snapshot.retrievalState];
  return (
    <article className="evidence-card">
      <div className="evidence-header">
        <h3>{snapshot.merchant}</h3>
        <span>{stateLabel}</span>
      </div>
      <blockquote>“{snapshot.exactText}”</blockquote>
      <dl>
        <div><dt>Scope</dt><dd>{snapshot.scope.kind}: {snapshot.scope.value}</dd></div>
        <div><dt>Collected</dt><dd>{new Date(snapshot.collectedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd></div>
        {props.reviewState !== undefined && <div><dt>Review</dt><dd>{props.reviewState === "reviewed" ? "Reviewed Evidence" : "Review required"}</dd></div>}
        <div><dt>Fingerprint</dt><dd>{snapshot.fingerprint}</dd></div>
      </dl>
      <a href={snapshot.sourceUrl}>{snapshot.sourceUrl} <span aria-hidden="true">↗</span></a>
      {policy !== undefined && (
        <div className="evidence-facts">
          <h4>Extracted facts and citations</h4>
          {policy.citations.map((citation) => (
            <div className="evidence-fact" key={citation.fact}>
              <strong>{citation.fact.replaceAll("_", " ")}: {policyFacts(policy)[citation.fact]}</strong>
              <blockquote>“{citation.quote}”</blockquote>
              <a href={citation.sourceUrl}>{citation.sourceUrl} <span aria-hidden="true">↗</span></a>
              <small>{snapshot.scope.kind}: {snapshot.scope.value} · {new Date(snapshot.collectedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {stateLabel}</small>
            </div>
          ))}
          {policy.materialConditions.map((condition) => (
            <div className="evidence-fact" key={condition.detail}>
              <strong>Remedy Condition: {condition.detail}</strong>
              <blockquote>“{condition.citation.quote}”</blockquote>
              <a href={condition.citation.sourceUrl}>{condition.citation.sourceUrl} <span aria-hidden="true">↗</span></a>
            </div>
          ))}
          {policy.supplementaryRemedies.length > 0 && (
            <div className="supplementary-remedies">
              <h4>Separate policy information (does not establish reversibility)</h4>
              {policy.supplementaryRemedies.map((remedy) => (
                <div className="evidence-fact" key={`${remedy.kind}:${remedy.detail}`}>
                  <strong>{remedy.kind.replaceAll("_", " ")}: {remedy.detail}</strong>
                  <blockquote>“{remedy.citation.quote}”</blockquote>
                  <a href={remedy.citation.sourceUrl}>{remedy.citation.sourceUrl} <span aria-hidden="true">↗</span></a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
