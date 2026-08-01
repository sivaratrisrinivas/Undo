import type { EvidenceSnapshot, PolicyAssessment } from "../domain";

function policyFacts(policy: PolicyAssessment) {
  const cost =
    policy.reversalCost.kind === "known"
      ? `₹${policy.reversalCost.amountInr}`
      : policy.reversalCost.kind;
  return {
    remedy: `Change of mind: ${policy.changeOfMind}; defect: ${policy.defect}`,
    window: `${policy.remedyWindow.days} days from ${policy.remedyWindow.startsAt}; ${policy.remedyWindow.requiredAction}`,
    product_condition: policy.productCondition,
    return_transport: policy.returnTransport,
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
        </div>
      )}
    </article>
  );
}
