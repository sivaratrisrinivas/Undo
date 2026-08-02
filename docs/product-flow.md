# Undo MVP product flow

Undo uses one guided flow rather than a chatbot. Seven safeguards run inside three buyer actions:

1. **Configure:** select the preset Sennheiser HD 560S or paste an approved Offer URL, then choose the Delivery Destination and Premium Limit.
2. **Understand:** Undo verifies Product identity, compares the three Offers, recommends the ranking winner, and presents its Policy Evidence, collection time, Approval Summary, and Material Warnings together. Exact evidence remains available for inspection without becoming another required action.
3. **Authorize:** approve the exact merchant, seller, Product, quantity, destination, payment method, and maximum Confirmed Checkout Total. Undo creates a single-use Purchase Authorization, submits one checkout attempt through Prava, and shows the resulting Undo Record.

The Undo Record reports Completed Purchase, confirmed failure, Purchase Outcome Unknown, or a non-purchase assessment outcome. Unsupported Products and URLs stop during Configure with “Not supported in this MVP.” Blocking evidence, eligibility, or price states stop before Purchase Authorization and explain why.

## Required technology path

The normal demo path retrieves Policy Evidence through Senso, uses OpenAI to extract the five-field structured schema with citations, runs the accepted ranking rules in deterministic code, and submits the authorized checkout through Prava. A valid Reviewed Evidence cache may handle a Senso outage under the accepted cache rules, but neither extracted values nor the winning Offer may be hardcoded.

If Senso or OpenAI fails and no valid Reviewed Evidence cache is available, Undo displays “Policy check unavailable,” identifies the failed step, and disables purchase. It never substitutes model memory, unsupported policy facts, or an unreviewed cache.

## Assessment outcomes

Every completed Reversibility Assessment creates an Undo Record, whether or not checkout occurs. Its outcome is one of:

- `purchased`
- `buyer_declined`
- `blocked_by_policy`
- `blocked_by_price`
- `purchase_unavailable`
- `outcome_unknown`

## Approval summary

Before approval, Undo displays one compact checklist containing:

- the exact Product, quantity, merchant, and seller;
- the Confirmed Checkout Total and Premium Limit;
- the change-of-mind remedy and Trial Permission;
- the Remedy Window, return transport, and buyer-paid fees;
- the Evidence Snapshot time and whether retrieval is current or cached; and
- every material Remedy Condition, including an unopened-only restriction.

Purchase Authorization is unavailable until this summary is complete and free of blocking states.

An unopened-only remedy, Unstated Cost, or another Material Warning must appear by name inside the purchase-specific acknowledgement before Prava approval is enabled. One acknowledgement may cover the enumerated warnings for that exact purchase; a generic acceptance of terms is not enough.
