# Undo

Undo helps a buyer choose among equivalent product offers by comparing the evidenced cost and uncertainty of reversing each purchase before payment.

## Language

**Reversibility Assessment**:
A pre-purchase comparison of an offer's evidenced exit rights, estimated exit cost, and uncertainty.
_Avoid_: Undo contract, return guarantee, safe purchase

**Undo Record**:
A saved snapshot for every completed Reversibility Assessment, including its evidence, assumptions, recommendation, authorization state, outcome, and policy-schema, extraction-prompt, model, and ranking-rule versions. Outcomes include purchased, buyer declined, policy blocked, price blocked, purchase unavailable, and unknown; payment secrets are never stored.
_Avoid_: Contract, guarantee

**Product**:
A specific manufactured item whose model, variant, condition, bundle contents, and warranty region identify what the buyer will receive.
_Avoid_: Listing, item

**Offer**:
One merchant and seller's terms for selling a Product, including its price, fulfilment method, and applicable policies.
_Avoid_: Product, listing

**Equivalent Offers**:
Offers for the same Product whose identity and important variant details have been proven to match. When equivalence cannot be proven, Undo does not compare them.
_Avoid_: Similar products, likely matches

**Change-of-Mind Return**:
A merchant remedy that lets the buyer return a Product and receive money back through the original payment method even when the Product is not defective. A refund limited to sealed, unopened packaging qualifies only when Undo displays that condition prominently.
_Avoid_: Store credit, exchange, replacement, warranty claim

**Remedy Condition**:
A requirement the buyer must satisfy to use an evidenced remedy, such as keeping the package sealed, retaining every accessory, or acting within a stated window. Undo displays material conditions beside the remedy rather than hiding them in details.
_Avoid_: Footnote, fine print

**Remedy Window**:
The evidenced time limit for using a remedy, including when the clock starts and the action required before it ends. A number of days without both facts is incomplete.
_Avoid_: Return period, seven-day return

**Trial Permission**:
An evidenced condition allowing the buyer to open and reasonably try the Product without losing the change-of-mind remedy. A packaging requirement alone does not establish Trial Permission; a qualifying Offer with Trial Permission ranks above an unopened-only Offer, even when the unopened-only Offer refunds money and the trial-permitted Offer provides store credit.
_Avoid_: Assumed trial, open-box guarantee

**Change-of-Mind Exchange**:
A weaker merchant remedy that lets the buyer return a working Product because it is unsuitable, but provides store credit or another Product instead of returning money. Undo shows this separately from a Change-of-Mind Return.
_Avoid_: Return, refund, money back

**Replacement**:
A remedy for a defective, damaged, wrong, or missing Product that supplies the same Product again. It does not let the buyer freely change their mind.
_Avoid_: Return, exchange, warranty

**Pre-dispatch Cancellation**:
A remedy that stops an Order before the merchant dispatches it. Undo may display it separately, but it does not make an Offer reversible after dispatch or delivery.
_Avoid_: Change-of-Mind Return, Reversible Offer

**Remedy Ranking**:
The fixed order Undo uses for eligible Offers: Trial Permission, change-of-mind money back over store credit, longer Remedy Window, doorstep pickup over self-shipping, lower known Reversal Cost with explicit free above Unstated Cost, then lower purchase price. Defect remedies such as Replacement are displayed separately and do not affect this ranking.
_Avoid_: AI score, risk score

**Tied Offers**:
Eligible Offers that remain equal after every Remedy Ranking rule. Undo presents them without a winner and requires the buyer to choose before purchase.
_Avoid_: Arbitrary winner, random choice

**Buyer Override**:
The buyer's choice of a non-winning Offer that still satisfies every purchase eligibility rule: Product equivalence, clear and fresh evidence, minimum reversibility, Purchase Availability, and the Premium Limit. An override may change a preference but cannot bypass a blocking rule.
_Avoid_: Safety bypass, unrestricted choice

**Reversible Offer**:
An Offer supported by Policy Evidence for at least a Change-of-Mind Exchange. Replacement alone is not enough. When no Equivalent Offer meets this minimum, Undo reports “No reversible purchase found” and does not buy.
_Avoid_: Replacement-only offer, guaranteed return

**Reversal Cost**:
Known non-refundable money required to complete an allowed return, such as return shipping, pickup, or restocking fees. It excludes the purchase price and guessed resale losses.
_Avoid_: Downside estimate, resale loss

**Unstated Cost**:
A possible return cost that applicable Policy Evidence neither confirms nor rules out. Undo displays it as uncertain and never converts policy silence into a ₹0 Reversal Cost.
_Avoid_: Free return, zero fee

**Unpriced Required Cost**:
A cost the evidence shows the buyer must bear, but whose amount cannot be supported, such as mandatory self-shipping without a price or reimbursement promise. Undo may display the Offer but may not buy it automatically.
_Avoid_: Estimated shipping, assumed fee

**Premium Limit**:
The most extra live checkout total a buyer authorizes Undo to pay for stronger reversibility compared with the cheapest Purchase Available Equivalent Offer. Totals include delivery and taxes; Purchase Unavailable Offers may be shown but cannot set the baseline.
_Avoid_: Risk score, uncertainty penalty

**Confirmed Checkout Total**:
The amount in Prava's live quote for the buyer, including delivery and taxes and only discounts actually applied there. Advertised but unapplied discounts, future cashback, and reward points do not reduce it.
_Avoid_: Listing price, advertised deal, possible discount

**Delivery Destination**:
The buyer-selected shipping location used to obtain live availability and the Confirmed Checkout Total. Purchase Authorization is tied to it; the Undo Record retains only a masked location or opaque reference rather than the full address.
_Avoid_: Unconfirmed postcode, stored full address

**Policy Evidence**:
An official merchant statement that applies to an Offer, saved with its exact wording, source, and collection time. It is evidence to interpret, never an instruction to follow; every extracted policy fact must be directly supported by an exact quote, and more product-specific evidence takes priority over category-level and general merchant policies.
_Avoid_: Review, forum post, model memory

**Policy Unclear**:
The state of an Offer with at least one required policy fact that cannot be supported because the applicable Policy Evidence is missing, incomplete, or conflicting. Undo may display the Offer but may not buy it automatically; fee silence in otherwise complete evidence is an Unstated Cost, not Policy Unclear.
_Avoid_: Probably returnable, assumed policy

**Purchase Available**:
The state of an Offer that Prava can quote and complete at the chosen merchant. The live quote is the final price presented for buyer approval.
_Avoid_: Probably orderable, listed price

**Purchase Unavailable**:
The state of an Offer that Undo may assess and recommend but cannot complete through Prava.
_Avoid_: Checkout failed

**Purchase Authorization**:
The buyer's single-use permission, valid for 10 minutes, to submit checkout once for one exact Product and quantity from one exact merchant and seller, up to a stated maximum total including delivery and taxes. A lower total may proceed; expiry, any change to identity, or any retry requires a fresh quote and new permission.
_Avoid_: General consent, blanket approval

**Approval Summary**:
The compact pre-purchase statement of the exact Product, seller, Confirmed Checkout Total, Premium Limit, evidenced remedy, Trial Permission, Remedy Window, return transport, buyer-paid costs, evidence freshness, and material Remedy Conditions covered by Purchase Authorization.
_Avoid_: Fine print, generic confirmation

**Material Warning**:
A non-blocking limitation that could materially weaken or increase the cost of the buyer's exit, including an unopened-only remedy or Unstated Cost. The buyer must acknowledge each Material Warning explicitly before Purchase Authorization.
_Avoid_: Fine print, passive notice

**Completed Purchase**:
A purchase for which Prava reports both a successful payment status and a merchant order identifier.
_Avoid_: Payment session, card credential, checkout started

**Purchase Outcome Unknown**:
The state after checkout was submitted but Undo cannot confirm whether the merchant accepted it. Undo does not retry automatically or create a Completed Purchase until Prava confirms both successful payment and a merchant order identifier.
_Avoid_: Failed purchase, safe to retry

**Previous Sandbox Purchase**:
A clearly labelled record of an earlier successful sandbox transaction, including its original timestamp and order identifier. It may demonstrate the completed flow when live services fail, but it is never presented as the current attempt.
_Avoid_: Cached transaction, live purchase, fallback success

**Evidence Snapshot**:
A dated copy of official Policy Evidence recording its merchant, source URL, exact text, applicable Product or category, collection time, and content fingerprint. The fingerprint identifies the exact text that was reviewed and cached.
_Avoid_: Live policy, scraped result

**Reviewed Evidence**:
An Evidence Snapshot whose exact content fingerprint and extracted facts have been approved by a human reviewer. The approval remains reusable for later fresh retrievals with the same fingerprint; changed content requires a new review.
_Avoid_: Review before every purchase, permanently approved source

**Stale Evidence**:
An Evidence Snapshot collected more than 24 hours before the buying decision. Undo may display it but must refresh it before buying automatically.
_Avoid_: Current policy, fresh evidence

**Cached Evidence**:
A complete, unchanged Evidence Snapshot previously retrieved through Senso and clearly marked when used because Senso is temporarily unavailable. It may authorize purchase only while it is less than 24 hours old; otherwise it is Stale Evidence.
_Avoid_: Live evidence, fresh evidence
