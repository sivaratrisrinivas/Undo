import type { EvidenceSnapshot, PolicyAssessment } from "../domain";
import {
  formatEvidenceState,
  formatPolicyFact,
} from "./policy-presentation";

/** Shows the exact wording and provenance of one Evidence Snapshot. */
export function EvidenceCard(props: {
  readonly snapshot: EvidenceSnapshot;
  readonly policy?: PolicyAssessment;
  readonly reviewState?: "reviewed" | "unreviewed";
}) {
  const snapshot = props.snapshot;
  const policy = props.policy;
  const stateLabel = formatEvidenceState(snapshot);
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
          {policy.citations.map((citation, index) => (
            <div className="evidence-fact" key={`${citation.fact}:${index}`}>
              <strong>{citation.fact.replaceAll("_", " ")}: {formatPolicyFact(policy, citation.fact)}</strong>
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
