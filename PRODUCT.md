# Undo

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a buyer at the point of purchase who wants to choose among Equivalent Offers for one Product without discovering the practical cost or uncertainty of reversal after payment.

## Product Purpose

Undo compares the evidenced exit rights, estimated exit cost, and uncertainty of Equivalent Offers before payment. Success means the buyer can understand the recommended Offer, inspect its Policy Evidence, set a Premium Limit, and make an informed purchase decision without mistaking Undo for a guarantee of merchant behavior.

## Positioning

Undo ranks eligible Offers by explicit Remedy Ranking rules grounded in dated official Policy Evidence and live checkout quotes. It does not use a synthetic risk score, infer missing rights, or present Replacement as a Change-of-Mind Return.

## Operating Context

The buyer identifies a supported Product, supplies a Delivery Destination and Premium Limit, and receives a Reversibility Assessment across proven Equivalent Offers. Undo retrieves and extracts Policy Evidence, confirms Purchase Availability and totals through Prava, applies fixed eligibility and ranking rules, and prepares an Approval Summary. A Purchase Authorization is single-use, tied to the exact Product, quantity, merchant, seller, destination, and maximum total, and expires after ten minutes. Every outcome is saved as an Undo Record without payment secrets or a full address.

The buyer confirmed a three-action interaction model:

1. Enter the Product, Delivery Destination, and Premium Limit.
2. Review the recommended Offer and acknowledge all Material Warnings.
3. Authorize the exact purchase.

The seven underlying assessment, evidence, selection, authorization, checkout, and record stages remain inspectable but must not require seven separate buyer actions.

## Capabilities and Constraints

- Product equivalence must be proven before Offers are compared.
- Only Purchase Available Offers meeting all purchase eligibility rules may be bought.
- Policy Evidence must be official, current or validly cached, and supported by exact citations. Changed fingerprints require human review.
- Remedy Ranking remains a visible sequence of decision rules, never an AI or risk score.
- Material Warnings require explicit acknowledgement before Purchase Authorization.
- A Buyer Override may choose another eligible Offer but cannot bypass a blocking rule.
- Checkout submits at most once per Purchase Authorization. An unknown outcome is never retried automatically.
- Undo never guarantees reversibility or a merchant outcome.
- The current MVP supports the repository's configured Product and merchant Offer set.

## Brand Commitments

The product name is Undo. The user requested a complete redesign that channels the energy of Jony Ive while reducing the journey to no more than three meaningful actions.

## Evidence on Hand

The repository contains deterministic Product, Offer, policy, quote, authorization, checkout, and record fixtures; current product-flow and demo documentation under `docs/`; the domain glossary in `CONTEXT.md`; and automated unit, integration, contract, and browser tests. It contains no customer testimonials, market claims, or licensed brand imagery, and future work must not fabricate them.

## Product Principles

- Make the way back legible before asking the buyer to move forward.
- Automate orchestration, not buyer consent.
- Show evidence and decision rules at the moment they matter.
- Fail closed when identity, price, policy, or authorization is uncertain.
- Preserve a clear record of what was known, chosen, authorized, and attempted.

## Accessibility & Inclusion

The experience must remain fully keyboard operable, expose clear programmatic labels and status, preserve visible focus, respect reduced-motion preferences, and remain usable from a 320-pixel-wide mobile viewport upward.
