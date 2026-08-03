# Three-minute demo runbook

This runbook is the operational checklist for Issue #10. It makes the normal path repeatable while keeping live service, payment, and consumer-validation claims separate from deterministic tests.

## Before the demo

Start from a clean browser profile and confirm the supported Product is the new, black Sennheiser HD 560S in the standard Indian warranty package. The Delivery Destination must be selected before the live quote request. Do not paste a buyer name, phone number, full address, payment credential, or one-time checkout token into the repository, logs, Senso, or OpenAI.

Run the deterministic release checks:

```sh
npm run test:demo-gates
npm run test:policy-contract
npm run test:ranking-contract
npm run typecheck
npm run lint
npm run build
npm run test:browser
```

The browser proof starts the fake adapter path automatically. It proves the visible seven-step interaction and authorization boundary; it does not prove live Senso, OpenAI, Prava, payment, or consumer results.

Run the read-only live preflight only when the corresponding service is configured:

```sh
npm run test:senso-live
npm run test:openai-live
npm run test:prava-live
```

These commands retrieve evidence, extract policy facts, and obtain quotes. They do not submit a Prava checkout. A skipped or failed opt-in command remains an unproven gate.

## Three-minute story

1. In Step 1, select the preset Product. Explain that Undo compares only the exact supported Product and the three curated Offers.
2. In Step 2, choose the Delivery Destination and leave the ₹2,000 Premium Limit visible. Start the comparison.
3. In Step 3, point out the cheaper-looking Offer and its live Confirmed Checkout Total, then show the deterministic recommendation. Explain that defect Replacement alone is not a change-of-mind remedy.
4. In Step 4, open the exact policy clauses. Show the collection time, Current or Cached Evidence label, Reviewed Evidence state, source link, Remedy Conditions, and explicit uncertainty such as “No fee stated—cost uncertain.”
5. In Step 5, show the Approval Summary: exact Product, seller, destination reference, total, maximum, remedy, Trial Permission, Remedy Window, transport, fees, evidence state, and conditions. Acknowledge each Material Warning separately.
6. In Step 6, show the ten-minute, single-use Purchase Authorization. A human-approved operator may submit exactly one Prava sandbox attempt. A timeout is not success and is never retried automatically.
7. In Step 7, show the Undo Record. A Completed Purchase requires both successful payment and a merchant order identifier. Otherwise show the confirmed failure or Purchase Outcome Unknown state.

The short line to repeat is: “Undo bought the exit before it bought the product.” Do not call the assessment a guarantee or an undo contract.

## Live Offer verification ledger

Complete one row per curated Offer immediately before the demo. A verification means that the state was checked; `Purchase Unavailable` is a valid observed state when it is clearly recorded. Keep this ledger free of credentials, full addresses, and payment details.

| Offer | Product identity | Merchant / seller | Availability and live total | Prava orderability | Policy source and wording | Collected at | Reviewed fingerprint | Human review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Headphone Zone | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not run |
| Concept Kart | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not run |
| Flipkart / BUZZINDIA | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not run |

Record the non-secret content fingerprint, not the policy text itself, in the fingerprint column. A changed fingerprint requires a new human review before automatic purchase. A fresh retrieval with an already reviewed fingerprint may reuse that review while still showing its collection time and cache state.

## Outages and historical fallback

Rehearse each dependency outage before presenting the fallback:

- With Senso unavailable and a complete, unchanged, less-than-24-hour Reviewed Evidence cache present, show `Cached Evidence` beside every affected snapshot. The comparison may proceed only under the existing cache rules.
- With Senso unavailable and no valid cache, show `Policy check unavailable` and a policy-blocked Undo Record. Never replace the facts with memory or a hardcoded winner.
- With OpenAI unavailable, show the same typed failure unless a matching Reviewed Evidence cache is valid. The failed extraction must not authorize a purchase.
- If a previous successful sandbox record is shown, label it exactly as `Previous Sandbox Purchase — historical only`, include its original timestamp and order identifier, and state that it is not success for the current attempt.

The current attempt and the historical fallback must be visibly separate. A historical order identifier never satisfies the current three-purchase release gate.

## Cached comparison timing

Measure a valid cached comparison in the agreed demo environment with the reviewed cache loaded, Senso unavailable, and no browser reload or network work between the comparison action and the rendered comparison. Start timing on the Compare offers action and stop when the Offer comparison heading and all three Offer rows are visible. Run five clean trials and record the slowest trial (or the agreed p95); it must be strictly less than 8,000 ms. Record only the duration and environment, never request bodies or credentials.

The executable gate in `src/evaluation/demo-release-gate.ts` treats exactly 8,000 ms as a failure. The focused gate test measures the rule; it does not turn a local fake timing into evidence of a live service result.

## Prava sandbox attempts

Three completed purchases require three separate, human-approved runs of the normal flow:

1. Obtain a fresh quote and create a fresh Purchase Authorization for the exact Product, seller, destination reference, quantity, and maximum total.
2. Submit once through Prava and wait for confirmed successful payment plus a merchant order identifier.
3. Record only a safe attempt number, authorization identifier, timestamp, confirmed total, and merchant order identifier in the private validation record. Never record card details, CVV, payment credentials, or full addresses.
4. Start again with a fresh quote and fresh authorization for attempts two and three. Never reuse an authorization, checkout grant, or one-time credential.

These are payment operations and require separate human approval. They are never run by CI, `npm test`, or an opt-in read-only live quote test. If they were not explicitly performed, mark all three purchase rows `Not run` and leave the release gate unproven.

| Attempt | Fresh authorization | Submitted once | Payment confirmed | Merchant order ID | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | Not run | Not run | Not run | Not run | Not run |
| 2 | Not run | Not run | Not run | Not run | Not run |
| 3 | Not run | Not run | Not run | Not run | Not run |

## Frozen release gates

The policy contract must be at least 95% overall, have correct abstention and no unsupported return claims, and have 100% field-and-citation correctness for the three demo Offers. The deterministic ranking contract must remain 30/30. `npm run test:demo-gates` verifies the evaluator's exact thresholds and refusal cases; it does not supply human review or live model evidence.

For consumer validation, interview at least 10 recent electronics or appliance buyers and record seller choice before and after the comparison plus stated usage intention. Six or more switches and four or more usage intentions is success. Two or fewer switches is failure. Three to five switches is inconclusive and requires 10 additional interviews before another decision. The automated release gate passes only the success classification.

## Scope check

Before release, confirm the demo uses only:

- the Sennheiser HD 560S Product;
- Headphone Zone, Concept Kart, and Flipkart seller BUZZINDIA;
- the guided seven-step flow;
- Senso, server-side OpenAI structured extraction, deterministic rules, and Prava's one-time sandbox path.

Mark the check failed if the demo adds a new Product, merchant, category, general search, chatbot, account system, return automation, order tracking, resale estimate, or excluded payment method.

## Final decision

| Gate | Status | Evidence location |
| --- | --- | --- |
| Normal Senso/OpenAI/ranking/authorization/Prava path | Not run |  |
| All three Offer verification rows complete | Not run |  |
| Cached comparison under 8 seconds | Not run |  |
| Three confirmed Prava sandbox purchases | Not run |  |
| Outage and historical fallback rehearsal | Not run |  |
| Extraction contract and demo citation gate | Not run |  |
| Ranking contract 30/30 | Not run |  |
| Consumer validation success | Not run |  |
| Seven-step scope check | Not run |  |

The demo is accepted only when every row has evidence and the release evaluator returns `pass`. Tests passing while a live or human row is `Not run` means the corresponding claim is still unproven.
