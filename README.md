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
PRAVA_DEMO_USER_ID=undo-solo-team
PRAVA_DEMO_USER_EMAIL=solo@undo.demo
```

Link Prava and confirm that its saved destination is ready:

```sh
npx prava setup --name "Undo local app" --platform codex
npx prava setup poll
npx prava status
```

Start the real service-backed app or the deterministic demo:

```sh
npm run dev 2>&1 | tee /tmp/undo-live-pipeline.log
VITE_EVIDENCE_MODE=fake npm run dev
```

The first command runs the complete local application and keeps a copy of every correlated browser/server
pipeline event in `/tmp/undo-live-pipeline.log`. Follow one attempt by its `traceId`. The deterministic mode
is for UI rehearsal only and must not be presented as proof that Senso, OpenAI, Prava, or a merchant checkout
ran live.

## Current live-policy behavior

The current Headphone Zone policy says a sealed, unopened product may qualify for a refund, but it does not
state that refund's duration, clock-start event, and deadline action. Its seven-day wording belongs to Easy
Exchange/store credit, and the supported HD 560S product page does not establish Easy Exchange eligibility.
Undo therefore correctly stops before Purchase Authorization with:

```text
Policy Unclear (Remedy Window missing duration, start event, or deadline action)
```

This is a successful fail-closed assessment, not a Senso, OpenAI, or Prava outage. The same detail appears in
the structured `offer.validation.policyBlocks` pipeline field. Do not copy a window from a different remedy
or bypass this block for a recording; applicable official evidence must support every required fact before
the hosted Prava checkout can open.

## Verify

```sh
npm test
npm run test:browser
npm run lint
npm run typecheck
npm run build
npm run test:demo-gates
```

Live checks are opt-in because they require configured services:

```sh
npm run test:senso-live
npm run test:openai-live
npm run test:prava-live
```

The repeatable three-minute talk track, live verification ledger, outage rehearsal, timing method, and
human-approved sandbox purchase procedure are in [docs/demo-runbook.md](docs/demo-runbook.md). The live
checks are read-only quote/extraction checks; sandbox payment attempts remain separately approved manual
operations and are never implied by the deterministic test suite.

The hosted sandbox card flow and its safe pipeline stages are documented in
[docs/prava-hosted-sandbox.md](docs/prava-hosted-sandbox.md). Card details and generated one-time
credentials are never stored in `.env.local`.

## Deploy to Vercel

Undo deploys as a Vite site plus six Node.js Vercel Functions. Purchase authorizations, hosted-payment
sessions, and checkout locks use Upstash Redis so they remain valid across serverless instances.

Prerequisites:

1. Create or link the Vercel project and attach one Upstash Redis database from the Vercel Marketplace.
   The integration supplies `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
2. Add the service variables from `.env.example` to both Preview and Production. Keep all API keys,
   Prava agent credentials, and Redis tokens encrypted in Vercel; never prefix them with `VITE_`.
3. Ensure the OpenAI API organization has available credits. A valid key with no credits returns
   `credit_balance_exhausted`, which Undo logs safely and treats as a fail-closed extraction outage.

For this repository's existing project, link from the repository root:

```sh
vercel link --yes --scope srini5 --project undo
```

Build and deploy a Preview, then verify it before Production:

```sh
vercel pull --yes --environment=preview
vercel build
vercel deploy --prebuilt
```

Promote a production-ready build:

```sh
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

Use `vercel logs <deployment-url>` for correlated server events and follow a request using its `traceId`.
For automatic deployments on every Git push, connect the GitHub repository in Vercel Project Settings
after adding GitHub as a Vercel account login connection.

## Reference docs

- [Domain glossary](CONTEXT.md)
- [Policy schema](docs/policy-schema.md)
- [Product flow](docs/product-flow.md)
- [Evaluation plan](docs/evaluation-plan.md)
- [Architecture decisions](docs/adr/)
- [Hosted Prava sandbox flow](docs/prava-hosted-sandbox.md)
- [Three-minute demo runbook](docs/demo-runbook.md)
