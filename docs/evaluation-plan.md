# Undo MVP evaluation plan

## Policy extraction gold set

The executable synthetic scorer fixtures are in `src/evaluation/frozen-policy-answer-key.ts` and are
checked by `npm run test:policy-contract`. They verify all-or-nothing scoring, abstention, unsupported
claims, and demo citation rules. They are not merchant documents, human review, or model outputs, and
therefore cannot open the production purchase gate.

Before prompt tuning, a human reviewer freezes an answer key for the 15-document official evidence corpus. For every applicable policy fact, the answer key records:

- the expected value for each of the five MVP policy fields and its nested facts;
- the exact supporting quote and source;
- every material Remedy Condition; and
- cases expected to return `unclear`.

Prompt changes are evaluated against this fixed answer key. The expected answers are not changed merely because a model output disagrees.

The official corpus and independently recorded model outputs have completed human review. The reviewed
status is recorded in `POLICY_CONTRACT_RELEASE`; synthetic fixtures remain test-only.

Each field instance passes only when its value, every required nested fact, exact source quote, and source reference match the answer key without adding an unsupported claim. A partially correct field counts as incorrect. Extraction accuracy is calculated across all applicable field instances in the 15-document corpus.

## Existing success targets

- Policy field extraction accuracy: at least 95%.
- Evidence citation correctness: 100% on demo documents.
- Seller ranking: 30 correct outcomes from 30 frozen scenarios.
- Correct abstention when required evidence is missing or conflicting.
- No unsupported return claims.
- Cached comparison response in under eight seconds.
- Three successful Prava sandbox transactions from three authorized attempts.

## Consumer validation

Test 10 people who recently purchased an electronic or appliance product. Record their seller choice before and after revealing Undo's policy comparison.

- Success: at least six switch sellers and at least four say they would use Undo before a purchase above ₹5,000.
- Failure: two or fewer switch sellers.
- Inconclusive: three to five switch sellers; test 10 additional people rather than claiming success.

## Purchase release gate

The three Offers used in the live purchase demo must achieve 100% field and citation correctness against the frozen human answer key before purchase is enabled. If any required demo field or citation fails, Undo may display the comparison but must disable Purchase Authorization.

Human review applies once to each unique Evidence Snapshot content fingerprint, not once per purchase. A fresh retrieval with an already approved fingerprint reuses that approval. New or changed content may be extracted and displayed but cannot authorize purchase until its new fingerprint and extraction are reviewed.

## Frozen ranking scenarios

Before the ranking engine is implemented, a human reviewer freezes 30 structured input scenarios and their expected outcomes. The set includes:

- an Offer exactly at and an Offer ₹1 above the Premium Limit;
- Trial Permission versus unopened-only money back;
- fresh, Stale, Cached, missing, and conflicting evidence;
- mandatory self-shipping with an unsupported cost;
- Purchase Unavailable Offers that cannot set the price baseline; and
- Offers that remain tied after every ranking rule.

Expected outcomes are not changed merely because the implementation disagrees.
