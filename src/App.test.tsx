import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { createFakeAdapters } from "./adapters/fake-adapters";
import { SUPPORTED_OFFERS, SUPPORTED_PRODUCT, type EvidenceReview, type ReviewedEvidenceCache } from "./domain";

async function assessAndAcknowledge(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Assess this purchase" }));
  await screen.findByRole("heading", { name: "Offer comparison" });
  await user.click(screen.getByRole("checkbox", { name: /I acknowledge every Material Warning/ }));
}

describe("guided Reversibility Assessment", () => {
  it("lets a buyer assess the supported Product, decline checkout, and receive an Undo Record", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({
      now: "2026-08-01T12:00:00.000Z",
      recordId: "undo-demo-001",
    });

    render(<App adapters={adapters} />);

    expect(screen.getByRole("heading", { name: "Know the way back before you buy." })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByRole("heading", { name: "Offer comparison" })).toBeVisible();
    expect(screen.getAllByText("Headphone Zone").length).toBeGreaterThan(0);
    await user.click(screen.getByText("Inspect all Policy Evidence"));

    expect(screen.getByRole("heading", { name: "Policy Evidence" })).toBeVisible();
    expect(screen.getAllByText(/sealed and unopened/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Current Evidence").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Reviewed Evidence").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("category: Selected Easy Exchange products").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", {
        name: /https:\/\/www\.headphonezone\.in\/pages\/help-center-returns-exchanges/,
      }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Approval Summary" })).toBeVisible();
    expect(screen.getByText(/Standard retail package · India warranty region/)).toBeVisible();
    expect(screen.getByText("1 / destination-ref-prava-default")).toBeVisible();
    expect(screen.getByText("Prava one-time prepaid sandbox")).toBeVisible();
    expect(screen.getByText("₹14,990 / ₹14,990")).toBeVisible();
    expect(screen.getByText(/1\/8\/2026.*Current Evidence.*Reviewed Evidence/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Authorize ₹14,990 & submit once/ })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I acknowledge every Material Warning/ }));
    expect(screen.getByRole("button", { name: /Authorize ₹14,990 & submit once/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save assessment without buying" }));

    expect(screen.getByRole("heading", { name: "Undo Record" })).toBeVisible();
    expect(screen.getByText("Buyer declined")).toBeVisible();
    expect(screen.getByText("undo-demo-001")).toBeVisible();
    expect(screen.getByText("policy-schema/1.0")).toBeVisible();
    expect(screen.getByText(/destination-ref-prava-default/)).toBeVisible();
    expect(screen.getByText("3 snapshots retained")).toBeVisible();
    expect(screen.getByText("Not requested")).toBeVisible();
    expect(screen.queryByText(/card number|cvv/i)).not.toBeInTheDocument();
    expect(adapters.activity).toEqual({
      sensoRequests: 1,
      openAiRequests: 1,
      pravaQuoteRequests: 1,
      pravaCheckoutRequests: 0,
    });
  }, 20_000);

  it("submits once through Prava and shows a Completed Purchase only with an order identifier", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({
      recordId: "undo-purchased-001",
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "successful",
        merchantOrderIdentifier: "merchant-order-001",
        confirmedTotalInr: 14_990,
      },
    });
    render(<App adapters={adapters} />);
    await assessAndAcknowledge(user);
    await user.click(screen.getByRole("button", { name: /Authorize ₹14,990 & submit once/ }));

    expect(await screen.findByText("Purchased")).toBeVisible();
    expect(screen.getByText("merchant-order-001")).toBeVisible();
    expect(screen.getByText("Used for one checkout attempt")).toBeVisible();
    expect(screen.getByText("Payment successful and merchant order confirmed")).toBeVisible();
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  }, 20_000);

  it("warns that an order may exist when Prava cannot confirm the submitted checkout", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "unknown",
        merchantOrderIdentifier: null,
        confirmedTotalInr: null,
        failureReason: "Prava timed out after checkout submission; an order may exist",
      },
    });
    render(<App adapters={adapters} />);
    await assessAndAcknowledge(user);
    await user.click(screen.getByRole("button", { name: /Authorize ₹14,990 & submit once/ }));

    expect(await screen.findByText("Purchase outcome unknown")).toBeVisible();
    expect(screen.getByText("Unknown — an order may exist; no automatic retry")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("an order may exist");
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  }, 20_000);

  it("fails closed when a successful Prava response exceeds the Purchase Authorization", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({
      recordId: "undo-over-ceiling-001",
      checkoutResult: {
        _tag: "submitted",
        paymentStatus: "successful",
        merchantOrderIdentifier: "untrusted-over-ceiling-order",
        confirmedTotalInr: 14_991,
      },
    });
    render(<App adapters={adapters} />);
    await assessAndAcknowledge(user);
    await user.click(screen.getByRole("button", { name: /Authorize ₹14,990 & submit once/ }));

    expect(await screen.findByText("Purchase outcome unknown")).toBeVisible();
    expect(screen.getByText("Unknown — an order may exist; no automatic retry")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("outside the Purchase Authorization");
    expect(screen.getByRole("alert")).toHaveTextContent("the purchase outcome is unknown");
    expect(screen.getByRole("alert")).toHaveTextContent("an order may exist");
    expect(screen.getByRole("alert")).toHaveTextContent("Undo will not retry");
    expect(screen.queryByText("Purchased")).not.toBeInTheDocument();
    expect(screen.queryByText("untrusted-over-ceiling-order")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(adapters.activity.pravaCheckoutRequests).toBe(1);
  }, 20_000);

  it.each(SUPPORTED_OFFERS)(
    "resolves the approved $merchant URL to the supported Product",
    async (offer) => {
      const user = userEvent.setup();
      const adapters = createFakeAdapters();

      render(<App adapters={adapters} />);

      await user.click(screen.getByRole("radio", { name: "Paste an approved Offer URL" }));
      await user.type(screen.getByPlaceholderText("https://merchant.example/product"), `${offer.url}/`);
      await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

      expect(await screen.findByRole("heading", { name: "Offer comparison" }, { timeout: 3_000 })).toBeVisible();
      expect(adapters.activity.sensoRequests).toBe(1);
    },
  );

  it("rejects unsupported input before any external adapter work", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters();

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("radio", { name: "Paste an approved Offer URL" }));
    await user.type(screen.getByPlaceholderText("https://merchant.example/product"), "https://example.com/headphones");
    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Not supported in this MVP");
    expect(adapters.activity).toEqual({
      sensoRequests: 0,
      openAiRequests: 0,
      pravaQuoteRequests: 0,
      pravaCheckoutRequests: 0,
    });
    expect(screen.queryByText(/safe purchase/i)).not.toBeInTheDocument();
  });

  it("rejects an unsupported Product before any external adapter work", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters();

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("radio", { name: "Enter another Product" }));
    await user.type(screen.getByLabelText("Product name"), "Sony WH-1000XM5");
    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Not supported in this MVP");
    expect(adapters.activity).toEqual({
      sensoRequests: 0,
      openAiRequests: 0,
      pravaQuoteRequests: 0,
      pravaCheckoutRequests: 0,
    });
  });

  it("parses the Premium Limit before starting external work", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters();

    render(<App adapters={adapters} />);

    await user.clear(screen.getByLabelText("Premium Limit (₹)"));
    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a whole-number Premium Limit of ₹0 or more",
    );
    expect(adapters.activity.sensoRequests).toBe(0);
  });

  it("shows an unavailable state when the Prava quote fails", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({ failPravaQuote: true });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Checkout quote unavailable");
    expect(screen.getByRole("button", { name: "Assess this purchase" })).toBeEnabled();
  });

  it("labels valid Cached Evidence when Senso is unavailable", async () => {
    const source = createFakeAdapters();
    const evidence = await source.senso.retrieveEvidence(SUPPORTED_PRODUCT);
    const policies = await source.openAi.extractPolicies(
      evidence._tag === "ok" ? evidence.value : [],
    );
    if (evidence._tag === "err" || policies._tag === "err") {
      throw new Error("Expected deterministic cache fixtures");
    }
    const reviews = evidence.value.map((snapshot): EvidenceReview => {
      const policy = policies.value.find((candidate) => candidate.offerId === snapshot.offerId);
      if (policy === undefined) throw new Error("Expected one policy per Offer");
      return { fingerprint: snapshot.fingerprint, approvedAt: "2026-08-01T11:00:00.000Z", policy };
    });
    const cache: ReviewedEvidenceCache = { snapshots: evidence.value, reviews };
    const outage = createFakeAdapters({ failSenso: true });
    const adapters = {
      ...outage,
      evidence: { ...outage.evidence, loadCache: () => Promise.resolve(cache) },
    };
    const user = userEvent.setup();

    render(<App adapters={adapters} />);
    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByRole("heading", { name: "Offer comparison" })).toBeVisible();
    expect(screen.getAllByText(/Cached Evidence/).length).toBeGreaterThanOrEqual(3);
    expect(outage.activity.openAiRequests).toBe(0);
    expect(outage.activity.pravaCheckoutRequests).toBe(0);
  });

  it("shows the live quote breakdown and excludes advertised value from the total", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters();

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByText(/Item ₹14,490 · Delivery ₹300 · Taxes ₹200/)).toBeVisible();
    expect(screen.getAllByText("Advertised only: excluded from total")).toHaveLength(3);
    expect(screen.getAllByText("Cashback/rewards: excluded from total")).toHaveLength(3);
  });

  it("shows the visible ranking rationale, premium, policy, evidence, and uncertainty", async () => {
    const user = userEvent.setup();
    render(<App adapters={createFakeAdapters()} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByText("The only Offer satisfying every eligibility rule")).toBeVisible();
    expect(screen.getByText("₹500 over baseline")).toBeVisible();
    expect(screen.getAllByText("7 days from delivered · request submitted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Self-shipping").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No fee stated—cost uncertain").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Product must remain sealed and unopened\./).length).toBeGreaterThan(0);
    await user.click(screen.getByText("Inspect all Policy Evidence"));
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Current Evidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reviewed Evidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Eligible products may be returned for a refund/).length).toBeGreaterThan(0);
  });

  it("allows an eligible Buyer Override and blocks ineligible choices", async () => {
    const user = userEvent.setup();
    render(<App adapters={createFakeAdapters({ scenario: "override" })} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByRole("radio", { name: /Headphone Zone.*recommended/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Flipkart.*not eligible/i })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Concept Kart.*Buyer Override/i }));
    expect(screen.getByText(/Buyer Override selected: Concept Kart/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Approval Summary" })).toBeVisible();
  });

  it("shows an exact Product mismatch without allowing that Offer to rank", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({
      quoteOverrides: {
        "concept-kart": { product: { ...SUPPORTED_PRODUCT, manufacturer: "Different manufacturer" } },
      },
    });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByText(/Not equivalent: manufacturer: expected Sennheiser/)).toBeVisible();
  });

  it("records the failed OpenAI extraction step instead of using model memory", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({ failOpenAi: true, recordId: "blocked-openai-001" });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByRole("heading", { name: "Undo Record" })).toBeVisible();
    expect(screen.getByText("Policy blocked")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Policy check unavailable: OpenAI extraction failed and no valid Reviewed Evidence cache exists",
    );
    expect(screen.getByText("blocked-openai-001")).toBeVisible();
    expect(adapters.activity.pravaCheckoutRequests).toBe(0);
  });

  it("records a policy block when Senso is unavailable and no cache exists", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({ failSenso: true, recordId: "blocked-senso-001" });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByRole("heading", { name: "Undo Record" })).toBeVisible();
    expect(screen.getByText("Policy blocked")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Policy check unavailable: Senso retrieval failed and no valid cache exists",
    );
    expect(screen.getByText("blocked-senso-001")).toBeVisible();
    expect(screen.getByText("0 snapshots retained")).toBeVisible();
  });

  it("shows an understandable Unpriced Required Cost refusal without authorization or checkout", async () => {
    const user = userEvent.setup();
    const base = createFakeAdapters({ recordId: "blocked-unpriced-001" });
    const adapters = {
      ...base,
      evidence: {
        ...base.evidence,
        findReview: async (fingerprint: string) => {
          const review = await base.evidence.findReview(fingerprint);
          return review === undefined || review.policy.offerId !== "headphone-zone"
            ? review
            : {
                ...review,
                policy: {
                  ...review.policy,
                  reversalCost: { kind: "unpriced_required" as const },
                },
              };
        },
      },
    };

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByRole("heading", { name: "Undo Record" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Unpriced Required Cost");
    expect(screen.getByText("blocked-unpriced-001")).toBeVisible();
    expect(adapters.activity.pravaCheckoutRequests).toBe(0);
  });

  it("lets a human approve changed evidence before reassessing", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({ unreviewed: true });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByRole("heading", { name: "Review changed Policy Evidence" })).toBeVisible();
    expect(screen.getAllByText("Review required")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Reviewer approval: accept evidence and reassess" }));

    expect(await screen.findByRole("heading", { name: "Offer comparison" })).toBeVisible();
    expect(adapters.activity.sensoRequests).toBe(2);
  });

  it("does not recommend an Offer outside the Premium Limit", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters();

    render(<App adapters={adapters} />);

    await user.clear(screen.getByLabelText("Premium Limit (₹)"));
    await user.type(screen.getByLabelText("Premium Limit (₹)"), "0");
    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No reversible Offer is within this Premium Limit",
    );
    expect(screen.queryByText(/recommended by/i)).not.toBeInTheDocument();
  });

  it("presents Tied Offers without a winner and requires the buyer to choose", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({ scenario: "tied" });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(await screen.findByText("Tied Offers")).toBeVisible();
    expect(screen.getByText("Choose an eligible Offer to prepare the exact Purchase Authorization.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Authorize .*submit once/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Concept Kart/ }));
    expect(screen.getByRole("button", { name: /Authorize .*submit once/ })).toBeDisabled();
  });

  it("derives the Approval Summary from the selected policy facts", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({ scenario: "exchange" });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Assess this purchase" }));

    expect(screen.getByText(/Change-of-mind store credit · 10 days from delivered · request submitted/)).toBeVisible();
    expect(screen.getByText("Trial permitted")).toBeVisible();
    expect(screen.getByText("Doorstep pickup · ₹0 evidenced")).toBeVisible();
  });
});
