import { describe, expect, it } from "vitest";

import {
  createPipelineLogger,
  errorLogDetails,
  pipelineTraceHeaders,
  pipelineTraceIdFrom,
  type PipelineLogEntry,
} from "./pipeline-logging";

describe("live pipeline logging", () => {
  it("emits correlated structured events with deterministic timestamps", () => {
    const entries: PipelineLogEntry[] = [];
    const logger = createPipelineLogger({
      traceId: "trace-12345678",
      scope: "browser",
      now: () => "2026-08-03T04:30:00.000Z",
      sink: (entry) => { entries.push(entry); },
    });

    logger.log("assessment", "started", { offerCount: 3 });

    expect(entries).toEqual([{
      timestamp: "2026-08-03T04:30:00.000Z",
      traceId: "trace-12345678",
      scope: "browser",
      stage: "assessment",
      status: "started",
      details: { offerCount: 3 },
    }]);
  });

  it("redacts secret-shaped values and sensitive detail fields", () => {
    const entries: PipelineLogEntry[] = [];
    const logger = createPipelineLogger({
      traceId: "trace-12345678",
      scope: "server",
      sink: (entry) => { entries.push(entry); },
    });

    logger.log("openai.request", "failed", {
      apiKey: "sk-test-secret-value",
      checkoutGrant: "grant-secret-value",
      message: "Authorization: Bearer sk-test-secret-value",
    });

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("sk-test-secret-value");
    expect(serialized).not.toContain("grant-secret-value");
    expect(serialized).toContain("[REDACTED]");
  });

  it("summarizes errors without stacks and propagates only valid trace identifiers", () => {
    expect(errorLogDetails(new Error("Bearer sk-test-secret-value was rejected"))).toEqual({
      errorType: "Error",
    });
    expect(JSON.stringify(errorLogDetails("senso-key-with-an-unknown-format"))).not.toContain(
      "senso-key-with-an-unknown-format",
    );
    expect(pipelineTraceHeaders("trace-12345678")).toEqual({
      "X-Undo-Trace-Id": "trace-12345678",
    });
    expect(pipelineTraceIdFrom("trace-12345678", () => "fallback-12345678")).toBe(
      "trace-12345678",
    );
    expect(pipelineTraceIdFrom("bad trace\nvalue", () => "fallback-12345678")).toBe(
      "fallback-12345678",
    );
  });

  it("never includes parser excerpts that may contain request or response data", () => {
    const parserFailure = new SyntaxError(
      'Unexpected token near {"exactText":"private policy text"}',
    );

    expect(errorLogDetails(parserFailure)).toEqual({
      errorType: "SyntaxError",
      errorMessage: "Invalid JSON or structured data",
    });
    expect(JSON.stringify(errorLogDetails(parserFailure))).not.toContain("private policy text");
  });
});
