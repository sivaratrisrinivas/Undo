# Undo

Undo helps a buyer choose where to buy by comparing how easy and costly it would be to reverse the purchase.
The current MVP compares the Sennheiser HD 560S across Headphone Zone, Concept Kart, and Flipkart.

## Why

Price alone does not show whether a buyer can return an item, how long they have, what condition it must be
in, or what a return may cost. Undo collects those facts from merchant policies, shows the supporting text,
and blocks checkout when the evidence is missing, stale, unclear, or inconsistent.

## How it works

1. The buyer selects the supported product, delivery destination, and maximum acceptable price difference.
2. Undo gets current offers and policy evidence, confirms that the products match, and ranks eligible offers.
3. The buyer reviews the chosen offer, return terms, costs, warnings, and final price.
4. Approval creates a ten-minute, single-use purchase authorization for those exact details.
5. Undo makes one Prava sandbox checkout attempt. It never retries automatically.
6. Undo saves a record of the decision and outcome without card details or personal delivery data.

A purchase is complete only when payment succeeds and Prava returns an order ID. If the result is uncertain,
Undo records that an order may exist and prevents reuse of the authorization.

## Architecture

- **Browser app:** guides the buyer through comparison, approval, checkout, and the final record.
- **Decision workflow:** validates product matches, policy evidence, price limits, warnings, and authorization state.
- **Server routes:** keep Senso, OpenAI, and Prava credentials out of the browser and validate all responses.
- **Browser storage:** keeps reviewed evidence, authorization state, and secret-free Undo Records across reloads.
- **External services:** Senso supplies policy text, OpenAI extracts structured facts, and Prava supplies quotes and sandbox checkout.

Checkout uses an exact, single-use server grant. The authorization and grant are consumed before the Prava
request so a timeout or repeated click cannot create another attempt.

## Run locally

Install dependencies:

```sh
npm install
```

Create `.env.local`:

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
PRAVA_SANDBOX_TOKEN=one_time_network_token
PRAVA_SANDBOX_CRYPTOGRAM=one_time_cryptogram
PRAVA_SANDBOX_EXPIRY_MONTH=12
PRAVA_SANDBOX_EXPIRY_YEAR=2028
```

Link Prava and confirm that its saved destination is ready:

```sh
npx prava setup --name "Undo local app" --platform codex
npx prava setup poll
npx prava status
```

Start the real service-backed app or the deterministic demo:

```sh
npm run dev
VITE_EVIDENCE_MODE=fake npm run dev
```

## Verify

```sh
npm test
npm run test:browser
npm run lint
npm run typecheck
npm run build
```

Live checks are opt-in because they require configured services:

```sh
npm run test:senso-live
npm run test:prava-live
```

## Reference docs

- [Domain glossary](CONTEXT.md)
- [Policy schema](docs/policy-schema.md)
- [Product flow](docs/product-flow.md)
- [Evaluation plan](docs/evaluation-plan.md)
- [Architecture decisions](docs/adr/)
