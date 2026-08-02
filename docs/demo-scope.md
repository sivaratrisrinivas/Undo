# Undo MVP demo scope

## Product

- Manufacturer: Sennheiser
- Model: HD 560S
- Condition: New
- Variant: Black
- Bundle contents: Standard retail package
- Warranty region: India

Undo compares an Offer only after deterministic checks prove it matches this Product.

## Supported input

The MVP accepts only the preset Sennheiser HD 560S or one of the three approved Offer URLs below. Every other Product or URL receives a clear “Not supported in this MVP” response; Undo does not attempt a general web search or imply universal coverage.

## Offers

1. Headphone Zone
   - Product source: https://www.headphonezone.in/products/sennheiser-hd-560s
   - Intended purchase path: Prava
   - Evidenced remedy to verify in the demo snapshot: refund for a sealed, unopened Product
2. Concept Kart
   - Product source: https://conceptkart.com/products/sennheiser-hd-560s-reference-grade-open-back-headphones
   - Evidenced remedy to verify in the demo snapshot: replacement for a manufacturing defect
3. Flipkart, seller BUZZINDIA
   - Product source: https://www.flipkart.com/sennheiser-hd-560s-audiophile-over-ear-headphone-wired-without-mic-headset/p/itme71f567510ef2
   - Evidenced remedy to verify in the demo snapshot: seven-day replacement

Prices, availability, seller identity, policy wording, and Prava orderability must be captured and verified again before the demo. Every policy Evidence Snapshot used to authorize automatic buying must be no more than 24 hours old. A current page or live quote overrides the example prices discussed during planning.

The curated demo and evaluation corpus contains 15 official documents across the three merchants. This is a corpus target, not a five-pages-per-merchant rule. Evidence completeness depends on coverage of every required policy field and material condition, not document count.

## Buyer default

- Premium Limit: ₹2,000

This is only the demo's starting value. The buyer may change it before approval. Premium comparison and final approval use each live checkout total, including delivery and taxes, rather than the product-page price.

## Purchase authorization

The buyer chooses the Delivery Destination before live quotes are requested. The buyer then approves the exact Product, quantity, merchant, seller, destination, and a maximum total that includes delivery and taxes. Checkout may proceed below that maximum for 10 minutes. Expiry, a changed destination or identity field, or an increase above the maximum stops checkout and requires a fresh quote and new approval. The Undo Record stores only a masked destination or opaque reference, not the full address.

## Transaction fallback

If the live Prava attempt cannot complete during the demo, Undo may show a Previous Sandbox Purchase with its original timestamp and order identifier. It must be labelled as historical and must not be presented as a new live purchase or as success for the current attempt.

## Payment scope

The MVP supports only Prava's one-time prepaid or card-style sandbox checkout. Cash on delivery, EMI, buy-now-pay-later, gift cards, and split payments are out of scope.

## Scope freeze

Until the accepted seven-step demo works end to end, the MVP excludes:

- accounts and login;
- additional Products or categories;
- a browser extension;
- live internet-wide scraping;
- a chatbot;
- return or refund automation;
- order tracking;
- resale-price estimates; and
- payment methods beyond the accepted Prava sandbox path.

New ideas remain backlog items and do not enter the hackathon build before the scoped demo is complete.
