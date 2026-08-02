# Undo MVP product flow

Undo uses one guided flow rather than a chatbot:

1. The buyer selects the preset Sennheiser HD 560S or pastes one of its three approved Offer URLs.
2. The buyer chooses the Delivery Destination and Premium Limit.
3. Undo verifies manufacturer, model, variant, condition, bundle contents, warranty region, merchant, and seller before comparing the three Offers.
4. The buyer can inspect the exact Policy Evidence and collection time behind every policy fact.
5. The buyer approves the chosen merchant, seller, Product, quantity, destination, and maximum Confirmed Checkout Total.
6. Undo submits one checkout attempt through Prava.
7. Undo shows the resulting Undo Record, including Completed Purchase, confirmed failure, or Purchase Outcome Unknown.

Unsupported Products and URLs stop at step 1 with “Not supported in this MVP.” Blocking evidence, eligibility, or price states stop before Purchase Authorization and explain why.

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

An unopened-only remedy, Unstated Cost, or another Material Warning requires a specific buyer acknowledgement before Prava approval is enabled. A generic acceptance of terms is not enough.
