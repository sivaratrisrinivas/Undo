import type { EvidenceSnapshot, PolicyAssessment, PolicyFact } from "../domain";

/** Formats a change-of-mind remedy without conflating defect remedies. */
export function formatChangeOfMind(policy: PolicyAssessment): string {
  return {
    money_back: "Money back",
    store_credit: "Store credit",
    none: "None evidenced",
    unclear: "Policy Unclear",
  }[policy.changeOfMind];
}

/** Formats Product condition while reserving Trial Permission for explicit trial evidence. */
export function formatProductCondition(policy: PolicyAssessment): string {
  return {
    unopened_only: "Sealed and unopened only",
    opened_unused: "Opened but unused",
    trial_allowed: "Trial Permission",
    unclear: "Policy Unclear",
  }[policy.productCondition];
}

/** Formats all required Remedy Window facts. */
export function formatRemedyWindow(policy: PolicyAssessment): string {
  return policy.remedyWindow.kind === "known"
    ? `${policy.remedyWindow.days} days from ${policy.remedyWindow.startsAt} · ${policy.remedyWindow.requiredAction.replaceAll("_", " ")}`
    : "Policy Unclear";
}

/** Formats the evidenced return transport. */
export function formatReturnTransport(policy: PolicyAssessment): string {
  return {
    doorstep_pickup: "Doorstep pickup",
    self_ship: "Self-shipping",
    unclear: "Policy Unclear",
  }[policy.returnTransport];
}

/** Formats Reversal Cost without converting silence into zero. */
export function formatReversalCost(policy: PolicyAssessment): string {
  return policy.reversalCost.kind === "known"
    ? `₹${policy.reversalCost.amountInr.toLocaleString("en-IN")}`
    : {
        explicit_none: "₹0 evidenced",
        unstated: "No fee stated—cost uncertain",
        unpriced_required: "Unpriced Required Cost",
        unclear: "Policy Unclear",
      }[policy.reversalCost.kind];
}

/** Formats current, cached, and stale evidence without implying cache freshness. */
export function formatEvidenceState(snapshot: EvidenceSnapshot): string {
  return {
    current: "Current Evidence",
    cached: "Cached Evidence",
    stale: "Stale Evidence",
  }[snapshot.retrievalState];
}

/** Formats the interpreted value associated with one exact policy citation. */
export function formatPolicyFact(policy: PolicyAssessment, fact: PolicyFact): string {
  if (fact === "remedy") {
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
    return `${changeOfMind}; defect remedy: ${defect}`;
  }
  if (fact === "window") return formatRemedyWindow(policy);
  if (fact === "product_condition") return formatProductCondition(policy);
  if (fact === "return_transport") return formatReturnTransport(policy);
  return formatReversalCost(policy);
}
