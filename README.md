# Undo

Undo compares equivalent product Offers by the evidenced cost and uncertainty of reversing a purchase.
The current MVP supports a new Sennheiser HD 560S with the Black variant, standard retail package, and Indian
warranty, across Headphone Zone, Concept Kart, and Flipkart seller BUZZINDIA.

Before ranking, the Prava quote boundary proves each Offer's Product identity and seller. It retains the
live item total, delivery, taxes, applied discounts, advertised-but-unapplied discounts, cashback, rewards,
availability, and Confirmed Checkout Total. Only equivalent Purchase Available totals can set the Premium
Limit baseline; advertised value, cashback, and rewards never reduce it.

The normal local flow uses the official `@prava-sdk/cli` shopping interface. Product and quote calls run
server-side through the linked Prava agent identity; browser code receives only parsed catalog and quote
fields. Flipkart remains visible but unavailable when Prava has no orderable matching listing.

Undo retrieves official Policy Evidence through Senso, extracts the five policy fields through the
server-only OpenAI Responses API, validates exact citations, and applies deterministic eligibility and
Remedy Ranking rules. Change-of-mind remedies determine reversibility; defect remedies, warranties,
cancellation, and refund timing are displayed separately. Missing, conflicting, stale, changed, or
uncited evidence blocks automatic purchase. Undo never guarantees a merchant outcome.

Eligible Offers are ranked lexicographically by Trial Permission, money back over store credit,
longer Remedy Window, doorstep pickup over self-shipping, lower evidenced Reversal Cost, and finally
lower Confirmed Checkout Total. The comparison shows the exact cited clauses, Material Conditions,
evidence freshness and cache state, premium over the cheapest Purchase Available Equivalent Offer,
transport, costs, and uncertainty. Perfect ties require buyer selection; a Buyer Override can select
another Offer only while it continues to satisfy every evidence, equivalence, availability, cost, and
Premium Limit rule. The frozen 30-scenario contract verifies these boundaries with a 30/30 release
target.

Before checkout, Undo derives a complete Approval Summary from the buyer's validated Offer selection.
It shows the exact Product and quantity, merchant and seller, masked Delivery Destination, Confirmed
Checkout Total and Premium Limit, remedy terms, buyer-paid costs, Evidence Snapshot time and cache
state, and every material Remedy Condition. Unopened-only restrictions, Unstated Cost, and other
Material Warnings require separate acknowledgements rather than generic acceptance.

Explicit approval creates a secret-free Purchase Authorization bound to that exact assessment and a
maximum total. It expires after 10 minutes, accepts a lower fresh total but never a higher one, and can
be claimed for only one Prava submission. A changed Offer, Product identity, seller, destination,
Premium Limit, policy input, quantity, or payment method atomically invalidates it. Authorization state
is retained in browser storage behind a per-authorization Web Lock so reloads, multiple tabs, and
concurrent claims cannot turn one approval into multiple submissions. Checkout consumes the authorization
before making one Prava attempt; the server also requires an opaque, one-time grant bound to the exact
authorized request and retains a consumed-ID replay tombstone. Undo never retries automatically. Only successful payment plus a merchant
order identifier becomes a Completed Purchase; missing confirmation becomes `outcome_unknown`, with a clear
warning that an order may exist. The final Undo Record retains the approved maximum, authorization state,
Prava status, evidence, recommendation, assumptions, and version identifiers without payment credentials or
personal delivery data. The browser repository retains records so completed outcomes remain auditable
after reload; a saved Completed Purchase may later appear only as a clearly historical fallback.

## Local setup

```sh
npm install
```

Create `.env.local` in the repository root. Keep these values server-side; do not use a `VITE_` prefix
for either API key.

```sh
SENSO_API_KEY=your_senso_api_key
SENSO_HEADPHONE_ZONE_KB_NODE_IDS=uuid-1,uuid-2
SENSO_CONCEPT_KART_KB_NODE_IDS=uuid-3,uuid-4
SENSO_FLIPKART_KB_NODE_IDS=uuid-5,uuid-6
OPENAI_API_KEY=your_openai_api_key
OPENAI_POLICY_MODEL=gpt-5.6-sol
PRAVA_SECRET_KEY=sk_test_your_key
PRAVA_PUBLISHABLE_KEY=pk_test_your_key
PRAVA_API_BASE_URL=https://sandbox.api.prava.space
PRAVA_SANDBOX_TOKEN=one_time_network_token_from_prava
PRAVA_SANDBOX_CRYPTOGRAM=one_time_dynamic_cryptogram_from_prava
PRAVA_SANDBOX_EXPIRY_MONTH=12
PRAVA_SANDBOX_EXPIRY_YEAR=2028
```

Each Senso variable lists the official KB node IDs for that Offer. The server rejects missing,
unfinished, malformed, empty, or incorrectly scoped documents. Buyer identity, address, payment data,
and one-time credentials are not sent to Senso or OpenAI.

The three `PRAVA_*` API values are reserved for Prava's app-owned payment-session flow; issue #5's
shopping quotes use Prava Pay's linked agent identity because the secret-key REST API does not expose
shopping endpoints. Link this checkout server once, then add a default address and phone in Prava Pay:

```sh
npx prava setup --name "Undo local app" --platform codex
npx prava setup poll
npx prava status
```

Prava stores the agent key in `~/.prava/agent.json` with owner-only permissions. Undo passes only the
opaque default-destination selection; Prava hydrates the saved address privately when opening a quote.
For an actual sandbox checkout, obtain the four `PRAVA_SANDBOX_*` values through Prava's approved
`sessions create` → buyer approval → `sessions poll` flow for the exact quoted total. They remain
server-only, are atomically consumed before one `shop checkout --yes --json` call, and are never returned to
the browser, written to the Undo Record, or logged by Undo. The server also rejects a repeated authorization
identifier. Do not reuse credentials or authorization for a retry; start again with a fresh quote, Approval
Summary, warning acknowledgements, Purchase Authorization, and one-time credential.

## Run and verify

```sh
npm run dev                 # Senso/OpenAI-backed flow
VITE_EVIDENCE_MODE=fake npm run dev
npm test
npm run test:policy-contract
npm run test:ranking-contract
npx vitest run src/purchase-authorization.test.ts src/adapters/browser-purchase-authorization-repository.test.ts
npx vitest run src/checkout-workflow.test.ts src/adapters/browser-undo-record-repository.test.ts
npx playwright install chromium # first browser run on a new machine
npm run test:browser        # real Chromium; starts the fake-adapter app automatically
npm run test:senso-live    # opt-in; requires .env.local
npm run test:prava-live    # opt-in; requires linked agent + default address/phone
npm run lint
npm run typecheck
npm run build
```

### Live Prava verification

Issue #5 was verified on 2026-08-02 with the pinned official Prava CLI 3.1.0 and a linked account
containing a default saved destination. `npm run test:prava-live` successfully verified the exact
Headphone Zone catalog variant, opened a destination-specific binding quote, reconciled its subtotal,
shipping, tax, applied discount, and final INR total, and kept the unsupported Flipkart seller
unavailable. The verification stops after quoting; it does not submit checkout or create a charge.

The development server provides `/api/policy-evidence`, `/api/policy-extraction`,
`/api/checkout-quotes`, and `/api/checkout` as server-only routes. A production host must provide
equivalent routes and a linked Prava agent identity.

The official 15-document policy contract has completed human review, so the production release gate is
enabled. Synthetic fixtures remain regression tests and do not replace that review.

### Purchase Authorization verification

Issue #7 was verified on 2026-08-02 with deterministic workflow clocks and IDs, concurrent claims from
separate workflow instances, and a real Chromium runtime. The contract suite covers missing individual
warning acknowledgements, exact 10-minute expiry, lower and higher totals, attempted reuse, unsupported
payment methods, changed Product, merchant, seller, destination, quantity, Premium Limit, selected Offer,
and material policy inputs. The real-browser path confirms that the approval action remains disabled
until every warning is acknowledged and creates one visible active authorization.

### Checkout and Undo Record verification

Issue #8 adds workflow coverage for confirmed success, successful payment without an order identifier,
confirmed failure, timeout after submission, concurrent duplicate prevention, and a clearly historical
Previous Sandbox Purchase. Server-boundary tests re-quote the authorized Offer, stop before charging when
the total rises above the approved maximum, and treat unreadable or timed-out post-submission responses as
unknown. The real Chromium path submits once through the deterministic Prava adapter and renders the final
Completed Purchase record without browser console or page errors.

## Reference docs

- [Domain glossary](CONTEXT.md)
- [Policy schema](docs/policy-schema.md)
- [Product flow](docs/product-flow.md)
- [Evaluation plan](docs/evaluation-plan.md)
- [Architecture decisions](docs/adr/)
