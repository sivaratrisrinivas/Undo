# Undo

Undo helps a buyer choose among equivalent product Offers by comparing the evidenced cost and uncertainty of reversing each purchase before payment.

## Project status

The repository contains the first working vertical slice: a seven-stage Reversibility Assessment for the Sennheiser HD 560S. It covers Product input, buyer constraints, Offer comparison, Policy Evidence, Approval Summary, checkout decision, and a resulting Undo Record.

The normal evidence path calls a same-origin `/api/policy-evidence` backend that owns the Senso API key and returns official-source documents. The browser fingerprints exact text, reuses human review only for that fingerprint, enforces the 24-hour freshness limit, and persists the last complete Reviewed Evidence cache. OpenAI extraction and Prava checkout remain deterministic adapters in this ticket.

## Supported demo scope

- Product: Sennheiser HD 560S, new, black, standard retail package, India warranty region.
- Inputs: the preset Product or one approved Headphone Zone, Concept Kart, or Flipkart Offer URL.
- Unsupported Products and URLs stop before search, evidence, quote, or checkout work.
- The buyer can inspect the comparison and evidence, acknowledge Material Warnings, decline before checkout, and receive an Undo Record with outcome `buyer_declined`.

Undo presents evidence and deterministic decision rules. It does not guarantee merchant behavior or describe a purchase as safe.

## Application shape

- React and TypeScript UI built with Vite.
- A workflow module coordinates Product resolution, evidence retrieval, policy extraction, quotes, Remedy Ranking, and record creation.
- External behavior is injected through typed Senso, OpenAI, and Prava adapter seams.
- The Premium Limit is evaluated against the cheapest Purchase Available Equivalent Offer.
- Tied Offers are presented without an arbitrary winner and require buyer selection.
- Undo Records retain evidence, assumptions, recommendation and authorization state, outcome, and reproducibility versions without payment secrets or a full address.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

The default mode expects `POST /api/policy-evidence`. Its request body contains only the supported Product identity. The backend must query the curated official sources through Senso and return:

```json
{
  "documents": [
    {
      "offerId": "headphone-zone",
      "merchant": "Headphone Zone",
      "sourceUrl": "https://www.headphonezone.in/pages/returns-refunds",
      "scope": { "kind": "product", "value": "Sennheiser HD 560S" },
      "collectedAt": "2026-08-02T08:00:00.000Z",
      "exactText": "Exact official wording"
    }
  ]
}
```

Keep `SENSO_API_KEY` on that backend; never expose it through a `VITE_` variable. To run the deterministic local walking skeleton without the backend, use:

```sh
VITE_EVIDENCE_MODE=fake npm run dev
```

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

## Project documentation

- [Domain glossary](CONTEXT.md)
- [MVP demo scope](docs/demo-scope.md)
- [Product flow](docs/product-flow.md)
- [Policy extraction schema](docs/policy-schema.md)
- [Evaluation plan](docs/evaluation-plan.md)
- [Architecture decisions](docs/adr/)
