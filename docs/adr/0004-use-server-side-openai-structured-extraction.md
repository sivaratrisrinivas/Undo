# Use server-side OpenAI structured extraction

Undo uses the OpenAI Responses API behind a server-only boundary to turn dated official merchant evidence into the five policy fields. The browser sends only allowlisted evidence snapshots; the boundary reconstructs merchant identity and source metadata, keeps the API key opaque, disables storage and tools, and validates strict structured output plus exact source substrings before returning facts.

Merchant text is untrusted input. It cannot alter the schema, ranking, authorization, or tool behavior. Expected configuration, transport, API, refusal, and invalid-output failures return through a typed failure channel. They never authorize purchase.

Exact citations are necessary but not sufficient evidence of semantic support. Every new content fingerprint requires human approval, and production purchase remains disabled until independently produced model outputs pass the human-reviewed 15-document official-source contract at the documented threshold. Synthetic fixtures test the scorer and edge cases only; they do not open the release gate.

The API request contains no buyer identity, address, payment detail, credential, ranking result, or authorization state. OpenAI receives only the configured policy evidence required for extraction.
