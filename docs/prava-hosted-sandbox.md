# Prava hosted sandbox demo

Undo creates a short-lived Prava session on the server, opens Prava's hosted card surface, polls the
payment result on the server, and gives the resulting single-use network credential directly to the
existing one-attempt merchant checkout boundary. The browser never receives the secret key, card,
network token, or dynamic CVV.

## Local configuration

Keep these values in `.env.local`:

```env
PRAVA_SECRET_KEY=sk_test_your_key
PRAVA_PUBLISHABLE_KEY=pk_test_your_key
PRAVA_API_BASE_URL=https://sandbox.api.prava.space
PRAVA_DEMO_USER_ID=undo-solo-team
PRAVA_DEMO_USER_EMAIL=solo@undo.demo
```

Do not add the test card or generated token/CVV to this file. The card is entered only on Prava's
hosted page. The sandbox device-binding OTP is `456789`.

## Recording path

1. From the repository root, run `npm run dev 2>&1 | tee /tmp/undo-live-pipeline.log`.
2. Open the printed localhost URL and click **Assess this purchase**.
3. If changed Policy Evidence is shown, approve it once as the demo operator. Undo reassesses using
   the reviewed fingerprint.
4. Review the recommended Offer, acknowledge the enumerated Material Warnings, and click the single
   authorize-and-submit control.
5. In the Prava window, enter the team test card manually and complete OTP/passkey approval.
6. Return to Undo and wait for the Undo Record. Do not retry an unknown outcome.

The terminal and browser console use the same trace ID. Expected additional stages are
`prava.payment_session`, `prava.payment_credentials`, `prava.merchant_checkout`, and
`prava.payment_report`. Logs include states and identifiers only; payment credentials are redacted.

Prava's linked shopping CLI reaches the destination merchant after sandbox card approval. Treat the
final authorize action as the single approved checkout attempt, not as a read-only test.
