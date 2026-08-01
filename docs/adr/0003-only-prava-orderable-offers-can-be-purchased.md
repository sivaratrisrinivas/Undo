# Only Prava-orderable offers can be purchased

Undo may assess any curated Offer, but it exposes autonomous purchase only when Prava can produce a live quote and complete the merchant checkout. A payment session or one-time credential alone is not a Completed Purchase; Undo requires Prava's successful payment status and merchant order identifier so the demo never presents payment preparation as transaction completion.

The buyer selects the Delivery Destination before live quotes are obtained. Purchase Authorization is locked for 10 minutes to that destination, the exact Product, quantity, merchant, seller, and a maximum total including delivery and taxes. Checkout may proceed below that maximum; expiry, a changed destination or identity field, or a higher total requires a fresh quote and new permission. Undo stores only a masked destination or opaque reference, not the full address.

Each Purchase Authorization permits at most one checkout submission. Any retry, including after a confirmed failure, requires a fresh quote and new permission.

If checkout was submitted but its result cannot be confirmed, Undo records Purchase Outcome Unknown and does not retry automatically. Only Prava confirmation of both successful payment and a merchant order identifier creates a Completed Purchase.

A previously successful sandbox transaction may be shown as a fallback only as a clearly labelled Previous Sandbox Purchase with its original timestamp and order identifier. It is not evidence that the current attempt succeeded.

The Undo Record stores the selected merchant and seller, exact Product and quantity, approved maximum total, supporting evidence, timestamps, Prava outcome, and merchant order identifier. It never stores card numbers, CVV, or the one-time payment credential.

Buyer names, phone numbers, full addresses, payment details, and one-time credentials are never sent to OpenAI or Senso. Personal delivery and payment data flows only through the Prava or merchant checkout path.

The hackathon MVP supports only Prava's one-time prepaid or card-style sandbox checkout. Cash on delivery, EMI, buy-now-pay-later, gift cards, and split payments are excluded because they introduce different price, authorization, and refund behavior.
