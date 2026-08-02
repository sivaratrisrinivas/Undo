const actions = [
  { label: "Configure", compactLabel: "Set", detail: "Product and boundaries" },
  { label: "Understand", compactLabel: "Review", detail: "Recommendation and evidence" },
  { label: "Authorize", compactLabel: "Authorize", detail: "One exact submission" },
] as const;

/** Shows the three buyer decisions while the seven safeguards run underneath. */
export function StageProgress({ current }: { readonly current: number }) {
  return (
    <nav className="progress-shell" aria-label="Assessment actions">
      <ol className="progress-list">
        {actions.map((action, index) => {
          const state = index < current ? "complete" : index === current ? "current" : "upcoming";
          return (
            <li aria-current={state === "current" ? "step" : undefined} className={`progress-item ${state}`} key={action.label}>
              <span className="progress-number" aria-hidden="true">{state === "complete" ? <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg> : index + 1}</span>
              <span><strong><span className="progress-label">{action.label}</span><span className="progress-label-compact">{action.compactLabel}</span></strong><small>{action.detail}</small></span>
            </li>
          );
        })}
      </ol>
      <div className="progress-caption"><span aria-hidden="true" /><strong>Seven safeguards run automatically between these actions.</strong></div>
    </nav>
  );
}
