# Undo

Undo compares equivalent product Offers by the evidenced cost and uncertainty of reversing a purchase.
The current MVP supports a new black Sennheiser HD 560S in the standard retail package with an Indian
warranty, across Headphone Zone, Concept Kart, and Flipkart seller BUZZINDIA.

Undo retrieves official Policy Evidence through Senso, extracts the five policy fields through the
server-only OpenAI Responses API, validates exact citations, and applies deterministic eligibility and
Remedy Ranking rules. Change-of-mind remedies determine reversibility; defect remedies, warranties,
cancellation, and refund timing are displayed separately. Missing, conflicting, stale, changed, or
uncited evidence blocks automatic purchase. Undo never guarantees a merchant outcome.

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
```

Each Senso variable lists the official KB node IDs for that Offer. The server rejects missing,
unfinished, malformed, empty, or incorrectly scoped documents. Buyer identity, address, payment data,
and one-time credentials are not sent to Senso or OpenAI.

## Run and verify

```sh
npm run dev                 # Senso/OpenAI-backed flow
VITE_EVIDENCE_MODE=fake npm run dev
npm test
npm run test:policy-contract
npm run test:senso-live    # opt-in; requires .env.local
npm run lint
npm run typecheck
npm run build
```

The development server provides `/api/policy-evidence` and `/api/policy-extraction` as server-only
routes. A production host must provide equivalent routes.

The official 15-document policy contract has completed human review, so the production release gate is
enabled. Synthetic fixtures remain regression tests and do not replace that review.

## Reference docs

- [Domain glossary](CONTEXT.md)
- [Policy schema](docs/policy-schema.md)
- [Product flow](docs/product-flow.md)
- [Evaluation plan](docs/evaluation-plan.md)
- [Architecture decisions](docs/adr/)
