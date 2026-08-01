# Use decision rules, not a synthetic score

Undo ranks Equivalent Offers with explicit eligibility and tie-breaking rules rather than adding purchase price, Reversal Cost, and uncertainty into one monetary score. Undo first finds the cheapest Purchase Available Equivalent Offer by live checkout total, including delivery and taxes, then filters to Reversible Offers whose live total is no higher than that baseline plus the buyer's Premium Limit. Purchase Unavailable Offers may be shown for comparison but cannot set the baseline. If no Purchase Available Reversible Offer qualifies, Undo does not buy and states the additional permission required.

Only a coupon, bank-card, membership, or other discount actually applied in Prava's live quote reduces the Confirmed Checkout Total. An advertised but unapplied price may be displayed but does not affect the baseline, Premium Limit, or ranking.

Future cashback and reward points may be displayed separately but never reduce the Confirmed Checkout Total or affect the Premium Limit or ranking.

Among qualifying Offers, the deterministic tie-break order is: (1) Trial Permission, (2) Change-of-Mind Return over Change-of-Mind Exchange, (3) longer Remedy Window, (4) doorstep pickup over self-shipping, (5) lower known Reversal Cost with an explicit free promise above Unstated Cost, and (6) lower purchase price. Defect remedies such as Replacement are displayed separately and do not affect this ranking. An unopened-only refund counts as a Change-of-Mind Return only when that Remedy Condition is shown prominently.

Replacement alone does not make an Offer reversible; if no Offer supports at least a Change-of-Mind Exchange, Undo reports “No reversible purchase found” and does not buy. Uncertainty has no honest rupee value without probability data, and treating a non-returnable Product as a guessed resale loss would create false precision; Undo clearly distinguishes unavailable returns from known return costs.

Policy silence about a fee is an Unstated Cost, not evidence of a zero-cost return. An otherwise equal Offer with an explicit zero-fee or free-pickup promise ranks above an Offer with an Unstated Cost.

If Offers remain equal after every rule, they are Tied Offers. Undo does not choose by merchant name, model preference, or randomness; the buyer must choose.

The buyer may override the ranking winner only by selecting another Offer that satisfies every eligibility rule: exact Product equivalence, clear and fresh Policy Evidence, at least a Change-of-Mind Exchange, Purchase Availability, and the buyer's Premium Limit. A Buyer Override cannot bypass a blocking rule.

Each Undo Record stores version identifiers for the policy schema, extraction prompt, extraction model, and ranking rules so a past recommendation can be reproduced.
