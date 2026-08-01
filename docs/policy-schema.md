# MVP policy extraction schema

OpenAI extracts only the following five policy facts from evidence retrieved through Senso. Every extracted value must carry the exact supporting quote and source reference.

Model-generated confidence scores never authorize a claim. If the cited quote does not clearly support an extracted value, that value is `unclear` and automatic buying is blocked.

Document count does not establish completeness. An Offer has complete evidence only when applicable evidence supports all five fields and every material Remedy Condition, whether that requires one source or several.

Every Evidence Snapshot records the source URL, collection time, exact saved text, merchant, applicable Product or category scope, and a content fingerprint. Cached Evidence is valid only when its text matches the reviewed snapshot fingerprint.

For the curated MVP, an Evidence Snapshot may authorize purchase only after a human has reviewed that exact content fingerprint and its extracted fields and quotes. A later fresh retrieval with the same fingerprint reuses the review; changed content receives a new fingerprint and blocks purchase until reviewed.

All retrieved page and policy text is untrusted data, even when it comes from an official merchant source. Embedded instructions cannot trigger tools, alter the schema or ranking rules, relax a blocking rule, or authorize a purchase.

Policy retrieval and extraction inputs must not include the buyer's name, phone number, full address, payment details, or one-time payment credential. Buyer personal data belongs only in the Prava or merchant checkout path.

## 1. Remedy

Remedy contains two separate values.

### Change of mind

Allowed values:

- `money_back`
- `store_credit`
- `none`
- `unclear`

Only this value determines whether an Offer is reversible and affects Remedy Ranking.

### Defect

Allowed values:

- `replacement`
- `money_back`
- `none`
- `unclear`

This value is displayed separately and does not make an Offer reversible or affect Remedy Ranking.

## 2. Window

The Window contains:

- the stated number of days;
- the event from which the clock starts, such as `delivered`; and
- the action the buyer must complete before the deadline, such as `request_submitted` or `item_received`.

If any of these facts is required but not supported by the applicable evidence, Window is `unclear` and automatic buying is blocked.

## 3. Product condition

Allowed values:

- `unopened_only`
- `opened_unused`
- `trial_allowed`
- `unclear`

Additional stated requirements, such as original packaging, intact tags, or all accessories, are retained as Remedy Conditions.

Only `trial_allowed` establishes Trial Permission and receives the stronger ranking. `opened_unused` permits inspection but not wearing, listening, or another ordinary product trial.

An original-packaging requirement proves only that the packaging must be retained or restored. Unless the evidence separately establishes one of the condition values above, Product condition is `unclear`, the Offer is Policy Unclear, and Undo must not buy it automatically.

## 4. Return transport

Allowed values:

- `doorstep_pickup`
- `self_ship`
- `unclear`

When `self_ship` requires the buyer to pay but the evidence supplies neither a supported shipping amount nor a reimbursement promise, the Offer has an Unpriced Required Cost and automatic buying is blocked. Undo does not invent a courier estimate.

## 5. Buyer-paid fees

Allowed values:

- `known_amount`
- `known_fee_amount_missing`
- `none_stated`
- `unclear`

When known, the fee amount and fee type are retained.

`none_stated` means the evidence is silent about fees. It does not mean the fee is ₹0. Undo displays “No fee stated—cost uncertain,” and an otherwise equal Offer with an explicit zero-fee or free-pickup promise ranks above it.

`known_fee_amount_missing` means the evidence confirms that the buyer must pay a fee or another required return cost but does not support its amount. Undo may show the Offer, but it must not buy it automatically because Reversal Cost cannot be calculated.

## Purchase blocking

Every required policy field must be supported by complete, consistent Policy Evidence. If any field is `unclear`, the Offer is Policy Unclear and Undo must not buy it automatically.

`none_stated` is different from `unclear`:

- `none_stated`: the applicable evidence was examined and is silent about fees. Undo may proceed with the visible warning “No fee stated—cost uncertain.”
- `known_fee_amount_missing`: the evidence confirms a fee but not its amount. Undo must stop automatic buying.
- `unclear`: the evidence needed to determine the field is missing, incomplete, or conflicting. Undo must stop automatic buying.

An Evidence Snapshot collected more than 24 hours before the buying decision is Stale Evidence. Undo may show its assessment, but it must refresh the snapshot before buying automatically.

If Senso is temporarily unavailable, a complete and unchanged Cached Evidence snapshot may authorize automatic buying only when it was originally retrieved through Senso and is less than 24 hours old. The UI must label it “Cached Evidence.” Older, incomplete, or changed cached evidence blocks buying.

## Separate evidence

Manufacturer warranty facts may be displayed separately but do not count as a change-of-mind remedy and are not one of the five MVP policy fields. A defect remedy likewise remains separate from change-of-mind eligibility even though both values are carried inside the Remedy field.

Official refund-processing timing may also be displayed separately when supported by evidence. It is not a sixth required field, does not affect ranking, and must not be used to claim that one merchant refunds faster than another when the evidence is absent or unclear.

Pre-dispatch cancellation may be displayed separately when supported by evidence. It does not count as a change-of-mind remedy and cannot make an Offer a Reversible Offer.
