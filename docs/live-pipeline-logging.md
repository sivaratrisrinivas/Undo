# Live pipeline logging

Run the service-backed app from the repository root and retain its server log:

```sh
npm run dev 2>&1 | tee /tmp/undo-live-pipeline.log
```

Open the local URL printed by Vite and choose **Assess this purchase**. Undo emits one JSON event for every assessment boundary. Server events appear in the terminal; browser-orchestration events appear in the browser developer console. Both use this prefix:

```text
[undo:pipeline]
```

Every event includes the same `traceId` for one assessment. Search that identifier in the terminal log and browser console to reconstruct the complete run.

The assessment trace covers:

1. input and Delivery Destination normalization;
2. each Senso source and configured document retrieval;
3. Senso response and provenance validation;
4. applicable-evidence resolution and cache fallback;
5. OpenAI configuration, Responses API status, and strict output validation;
6. each Prava Product lookup and live quote;
7. human-review binding and evidence freshness;
8. Product equivalence, Purchase Availability, policy eligibility, Premium Limit, and Remedy Ranking;
9. Purchase Authorization registration, single-use checkout, and Undo Record persistence.

Successful steps use `succeeded`; expected safeguards use `blocked`; dependency or validation failures use `failed`. For OpenAI failures, `errorKind` distinguishes `configuration`, `cancelled`, `transport`, `api`, and `invalid_output`. API failures also include the HTTP status and OpenAI request ID when available.

Logs contain only operational metadata: stage names, Offer IDs, counts, status codes, totals, stable failure reasons, and error types. Arbitrary provider error messages are omitted, and the logger redacts secret-shaped values and sensitive fields. It never intentionally logs API keys, Prava tokens or cryptograms, checkout grants, full addresses, exact Policy Evidence, request or response bodies, payment credentials, or merchant order identifiers.
