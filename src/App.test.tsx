import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { createFakeAdapters } from "./adapters/fake-adapters";
import { SUPPORTED_OFFERS } from "./domain";

describe("guided Reversibility Assessment", () => {
  it("lets a buyer assess the supported Product, decline checkout, and receive an Undo Record", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({
      now: "2026-08-01T12:00:00.000Z",
      recordId: "undo-demo-001",
    });

    render(<App adapters={adapters} />);

    expect(screen.getByRole("heading", { name: "Choose a Product" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start assessment" }));

    expect(screen.getByRole("heading", { name: "Set your boundaries" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Compare offers" }));

    expect(await screen.findByRole("heading", { name: "Offer comparison" })).toBeVisible();
    expect(screen.getByText("Headphone Zone")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Inspect evidence" }));

    expect(screen.getByRole("heading", { name: "Policy Evidence" })).toBeVisible();
    expect(screen.getByText(/sealed and unopened/i)).toBeVisible();
    expect(screen.getAllByText("Current Evidence")).toHaveLength(3);
    expect(screen.getAllByText("Reviewed Evidence")).toHaveLength(3);
    expect(screen.getByText("product: Sennheiser HD 560S")).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: /https:\/\/www\.headphonezone\.in\/pages\/returns-refunds/,
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Review approval summary" }));

    expect(screen.getByRole("heading", { name: "Approval Summary" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /sealed and unopened/i }));
    await user.click(screen.getByRole("checkbox", { name: /No fee stated/i }));
    await user.click(screen.getByRole("button", { name: "Continue to checkout" }));

    expect(screen.getByRole("heading", { name: "Checkout decision" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Decline purchase" }));

    expect(screen.getByRole("heading", { name: "Undo Record" })).toBeVisible();
    expect(screen.getByText("buyer_declined")).toBeVisible();
    expect(screen.getByText("undo-demo-001")).toBeVisible();
    expect(screen.getByText("policy-schema/1.0")).toBeVisible();
    expect(screen.getByText(/destination-ref-01/)).toBeVisible();
    expect(screen.getByText("3 snapshots retained")).toBeVisible();
    expect(screen.getByText("Not requested")).toBeVisible();
    expect(screen.queryByText(/card number|cvv|full address/i)).not.toBeInTheDocument();
    expect(adapters.activity).toEqual({
      sensoRequests: 1,
      openAiRequests: 1,
      pravaQuoteRequests: 1,
      pravaCheckoutRequests: 0,
    });
  });

  it.each(SUPPORTED_OFFERS)(
    "resolves the approved $merchant URL to the supported Product",
    async (offer) => {
      const user = userEvent.setup();
      const adapters = createFakeAdapters();

      render(<App adapters={adapters} />);

      await user.click(screen.getByRole("radio", { name: "Paste an approved Offer URL" }));
      await user.type(screen.getByLabelText("Offer URL"), `${offer.url}/`);
      await user.click(screen.getByRole("button", { name: "Start assessment" }));

      expect(screen.getByRole("heading", { name: "Set your boundaries" })).toBeVisible();
      expect(adapters.activity.sensoRequests).toBe(0);
    },
  );

  it("rejects unsupported input before any external adapter work", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters();

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("radio", { name: "Paste an approved Offer URL" }));
    await user.type(screen.getByLabelText("Offer URL"), "https://example.com/headphones");
    await user.click(screen.getByRole("button", { name: "Start assessment" }));

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
    await user.click(screen.getByRole("button", { name: "Start assessment" }));

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

    await user.click(screen.getByRole("button", { name: "Start assessment" }));
    await user.clear(screen.getByLabelText("Premium Limit (₹)"));
    await user.click(screen.getByRole("button", { name: "Compare offers" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a whole-number Premium Limit of ₹0 or more",
    );
    expect(adapters.activity.sensoRequests).toBe(0);
  });

  it.each([
    { dependency: "OpenAI", failure: { failOpenAi: true } },
    { dependency: "Prava quote", failure: { failPravaQuote: true } },
  ])("shows an unavailable state when $dependency fails", async ({ failure }) => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters(failure);

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Start assessment" }));
    await user.click(screen.getByRole("button", { name: "Compare offers" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Policy check unavailable");
    expect(screen.getByRole("button", { name: "Compare offers" })).toBeEnabled();
  });

  it("records a policy block when Senso is unavailable and no cache exists", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({ failSenso: true, recordId: "blocked-senso-001" });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Start assessment" }));
    await user.click(screen.getByRole("button", { name: "Compare offers" }));

    expect(await screen.findByRole("heading", { name: "Undo Record" })).toBeVisible();
    expect(screen.getByText("blocked_by_policy")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Policy check unavailable: Senso retrieval failed and no valid cache exists",
    );
    expect(screen.getByText("blocked-senso-001")).toBeVisible();
    expect(screen.getByText("0 snapshots retained")).toBeVisible();
  });

  it("does not recommend an Offer outside the Premium Limit", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters();

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Start assessment" }));
    await user.clear(screen.getByLabelText("Premium Limit (₹)"));
    await user.type(screen.getByLabelText("Premium Limit (₹)"), "0");
    await user.click(screen.getByRole("button", { name: "Compare offers" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No reversible Offer is within this Premium Limit",
    );
    expect(screen.queryByText(/recommended by/i)).not.toBeInTheDocument();
  });

  it("presents Tied Offers without a winner and requires the buyer to choose", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({ scenario: "tied" });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Start assessment" }));
    await user.click(screen.getByRole("button", { name: "Compare offers" }));

    expect(await screen.findByText("These Offers are tied. Choose before continuing.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Inspect evidence" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Concept Kart" }));
    expect(screen.getByRole("button", { name: "Inspect evidence" })).toBeEnabled();
  });

  it("derives the Approval Summary from the selected policy facts", async () => {
    const user = userEvent.setup();
    const adapters = createFakeAdapters({ scenario: "exchange" });

    render(<App adapters={adapters} />);

    await user.click(screen.getByRole("button", { name: "Start assessment" }));
    await user.click(screen.getByRole("button", { name: "Compare offers" }));
    await user.click(await screen.findByRole("button", { name: "Inspect evidence" }));
    await user.click(screen.getByRole("button", { name: "Review approval summary" }));

    expect(screen.getByText(/Change-of-mind store credit · 10 days/)).toBeVisible();
    expect(screen.getByText("Trial permitted")).toBeVisible();
    expect(screen.getByText("Doorstep pickup · ₹0 evidenced")).toBeVisible();
  });
});
