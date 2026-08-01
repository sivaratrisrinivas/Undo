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
    await user.click(screen.getByRole("button", { name: "Review approval summary" }));

    expect(screen.getByRole("heading", { name: "Approval Summary" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /unopened-only restriction/i }));
    await user.click(screen.getByRole("button", { name: "Continue to checkout" }));

    expect(screen.getByRole("heading", { name: "Checkout decision" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Decline purchase" }));

    expect(screen.getByRole("heading", { name: "Undo Record" })).toBeVisible();
    expect(screen.getByText("buyer_declined")).toBeVisible();
    expect(screen.getByText("undo-demo-001")).toBeVisible();
    expect(screen.getByText("policy-schema/1.0")).toBeVisible();
    expect(screen.getByText(/destination-ref-01/)).toBeVisible();
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
});
