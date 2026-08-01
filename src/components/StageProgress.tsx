const stages = [
  "Product input",
  "Buyer constraints",
  "Offer comparison",
  "Evidence inspection",
  "Approval Summary",
  "Checkout",
  "Undo Record",
] as const;

/** Shows every visible stage and the buyer's current position. */
export function StageProgress({ current }: { readonly current: number }) {
  return (
    <nav aria-label="Assessment progress" className="progress-shell">
      <ol className="progress-list">
        {stages.map((stage, index) => (
          <li
            aria-current={index === current ? "step" : undefined}
            className={index === current ? "progress-item current" : "progress-item"}
            key={stage}
          >
            <span aria-hidden="true" className="progress-number">
              {index + 1}
            </span>
            <span className="progress-label">{stage}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
