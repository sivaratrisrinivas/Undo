import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { EvidenceSnapshot, PolicyAssessment } from "../domain";
import { EvidenceCard } from "./EvidenceCard";

const sourceUrl = "https://merchant.example/policy";
const exactText =
  "Defects receive a replacement. Orders can be cancelled before dispatch. Approved refunds process in five days.";
const snapshot: EvidenceSnapshot = {
  offerId: "concept-kart",
  merchant: "Concept Kart",
  sourceUrl,
  scope: { kind: "category", value: "Headphones" },
  collectedAt: "2026-08-01T10:30:00.000Z",
  exactText,
  fingerprint: "sha256:test",
  retrievedVia: "senso",
  retrievalState: "current",
};
const policy: PolicyAssessment = {
  offerId: "concept-kart",
  changeOfMind: "none",
  defect: "replacement",
  remedyWindow: { kind: "unclear" },
  productCondition: "unclear",
  returnTransport: "unclear",
  reversalCost: { kind: "unstated" },
  materialConditions: [],
  supplementaryRemedies: [
    {
      kind: "pre_dispatch_cancellation",
      detail: "Cancellation is available only before dispatch.",
      citation: { quote: "Orders can be cancelled before dispatch.", sourceUrl },
    },
    {
      kind: "refund_processing_timing",
      detail: "Approved refunds process in five days.",
      citation: { quote: "Approved refunds process in five days.", sourceUrl },
    },
  ],
  quote: "Defects receive a replacement.",
  citations: [
    "remedy",
    "window",
    "product_condition",
    "return_transport",
    "buyer_paid_fees",
  ].map((fact) => ({
    fact: fact as PolicyAssessment["citations"][number]["fact"],
    quote: exactText,
    sourceUrl,
  })),
};

describe("EvidenceCard", () => {
  it("shows defect and supplementary remedies separately from reversibility", () => {
    render(<EvidenceCard policy={policy} snapshot={snapshot} />);

    expect(screen.getByText(/No change-of-mind remedy; defect remedy: Replacement/)).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Separate policy information (does not establish reversibility)",
      }),
    ).toBeVisible();
    expect(screen.getByText(/pre dispatch cancellation:/)).toBeVisible();
    expect(screen.getByText(/refund processing timing:/)).toBeVisible();
  });
});
