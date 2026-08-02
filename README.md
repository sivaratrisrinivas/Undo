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

## Run and verify

```sh
npm run dev                 # Senso/OpenAI-backed flow
VITE_EVIDENCE_MODE=fake npm run dev
npm test
npm run test:policy-contract
npm run test:ranking-contract
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

The development server provides `/api/policy-evidence`, `/api/policy-extraction`, and
`/api/checkout-quotes` as server-only routes. A production host must provide equivalent routes and a
linked Prava agent identity.

The official 15-document policy contract has completed human review, so the production release gate is
enabled. Synthetic fixtures remain regression tests and do not replace that review.

## Reference docs

- [Domain glossary](CONTEXT.md)
- [Policy schema](docs/policy-schema.md)
- [Product flow](docs/product-flow.md)
- [Evaluation plan](docs/evaluation-plan.md)
- [Architecture decisions](docs/adr/)
