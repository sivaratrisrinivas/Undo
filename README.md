# Undo

Undo helps a buyer choose among equivalent product Offers by comparing the evidenced cost and uncertainty of reversing each purchase before payment.

The MVP supports one Product: a new, black Sennheiser HD 560S in the standard retail package with an Indian warranty. It compares curated Offers from Headphone Zone, Concept Kart, and Flipkart seller BUZZINDIA. Unsupported Products and URLs stop before external work begins.

Undo provides an evidence-based Reversibility Assessment. It does not guarantee that a merchant will accept a return or reimburse the buyer.

## Current capabilities

- Guided seven-stage flow from Product input through the Undo Record.
- Exact Product and Offer allowlisting for the supported demo scope.
- Senso-backed retrieval of curated official Policy Evidence.
- Evidence Snapshots containing exact wording, merchant, source URL, scope, collection time, and a SHA-256 content fingerprint.
- Human approval tied to one exact fingerprint and its extracted facts and citations.
- Server-only OpenAI Responses API extraction with a strict five-field JSON Schema and exact-quote validation.
- Separate display of change-of-mind, defect, warranty, pre-dispatch cancellation, and refund-processing facts.
- A frozen 15-document extraction contract gate with all-or-nothing field and citation scoring.
- Reuse of unchanged reviews, with changed or unreviewed evidence blocking Purchase Authorization.
- A 24-hour evidence freshness limit and visibly labelled Stale Evidence.
- Fresh, complete Reviewed Evidence cache fallback during a Senso outage, labelled Cached Evidence.
- Deterministic eligibility, Premium Limit, Remedy Ranking, and Tied Offer rules.
- Material Warning acknowledgement before checkout can continue.
- Secret-free Undo Records for buyer declines and policy blocks.
- Deterministic fake OpenAI extraction and Prava quote/checkout adapters for the current development and test flow.

## Architecture

The application is built with React, TypeScript, and Vite. `AssessmentWorkflow` coordinates narrow Senso, OpenAI, Prava, and evidence-repository interfaces, while ranking and purchase eligibility remain deterministic domain code.

The Vite development server exposes `POST /api/policy-evidence`. This server-only route retrieves complete raw documents from Senso's `/org/kb/nodes/{id}/content` endpoint using configured official-corpus KB node IDs. It uses each document's Senso update time as the evidence collection time. `POST /api/policy-extraction` sends those snapshots through OpenAI structured output. The Senso and OpenAI API keys never enter browser code; buyer identity, destination, and payment data are excluded from both requests.

Policy Evidence is purchase-eligible only when all required Offers have applicable official sources, every extracted fact has an exact citation, the content fingerprint has human approval, and the snapshot is no more than 24 hours old. Missing, incomplete, stale, changed, or invalid cached evidence produces a clear policy block and an Undo Record.

## Local setup

Install dependencies:

```sh
npm install
```

Create `.env.local` in the repository root:

```sh
SENSO_API_KEY=your_senso_api_key
SENSO_HEADPHONE_ZONE_KB_NODE_IDS=uuid-1,uuid-2
SENSO_CONCEPT_KART_KB_NODE_IDS=uuid-3,uuid-4
SENSO_FLIPKART_KB_NODE_IDS=uuid-5,uuid-6
OPENAI_API_KEY=your_openai_api_key
# Optional; defaults to gpt-5.6-sol
OPENAI_POLICY_MODEL=gpt-5.6-sol
```

Each KB-node-ID variable is a comma-separated list of official merchant documents already ingested into Senso. Use the IDs returned by `senso content list`; the route rejects missing, unfinished, malformed, or empty documents. Keep the API key server-side and never use a `VITE_` prefix for it. Local environment files are ignored by Git.

Start the Senso-backed development flow:

```sh
npm run dev
```

To run the deterministic walking skeleton without Senso:

```sh
VITE_EVIDENCE_MODE=fake npm run dev
```

A production host must route `/api/policy-evidence` to `retrievePolicyEvidenceFromSenso`; Vite supplies this route only during local development.

## Verification

```sh
npm test
npm run test:policy-contract
npm run test:senso-live # opt-in live retrieval check; requires configured .env.local
npm run typecheck
npm run lint
npm run build
```

## Project documentation

- [Domain glossary](CONTEXT.md)
- [MVP demo scope](docs/demo-scope.md)
- [Product flow](docs/product-flow.md)
- [Policy extraction schema](docs/policy-schema.md)
- [Evaluation plan](docs/evaluation-plan.md)
- [Architecture decisions](docs/adr/)
