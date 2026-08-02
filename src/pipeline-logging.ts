export const PIPELINE_TRACE_HEADER = "X-Undo-Trace-Id";

export type PipelineLogStatus = "started" | "succeeded" | "failed" | "blocked" | "info";
export type PipelineLogPrimitive = string | number | boolean | null;
export type PipelineLogDetails = Readonly<Record<
  string,
  PipelineLogPrimitive | ReadonlyArray<PipelineLogPrimitive>
>>;

export type PipelineLogEntry = {
  readonly timestamp: string;
  readonly traceId: string;
  readonly scope: "browser" | "server";
  readonly stage: string;
  readonly status: PipelineLogStatus;
  readonly details?: PipelineLogDetails;
};

export type PipelineLogger = {
  readonly traceId: string;
  log(stage: string, status: PipelineLogStatus, details?: PipelineLogDetails): void;
};

const TRACE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const SENSITIVE_DETAIL_KEY = /(?:api.?key|authorization.?header|checkout.?grant|cryptogram|exact.?text|full.?address|message|payment.?credential|request.?body|response.?body|secret|token)$/i;

function sanitizeString(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|pk)_[a-zA-Z0-9._-]+\b/g, "[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 400);
}

function sanitizeDetails(details: PipelineLogDetails): PipelineLogDetails {
  const sanitized: Record<
    string,
    PipelineLogPrimitive | ReadonlyArray<PipelineLogPrimitive>
  > = {};
  for (const key of Object.keys(details)) {
    const value = details[key];
    if (value === undefined) continue;
    if (SENSITIVE_DETAIL_KEY.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      sanitized[key] = sanitizeString(value);
    } else if (value !== null && typeof value === "object") {
      sanitized[key] = value.map((item) =>
        typeof item === "string" ? sanitizeString(item) : item);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function defaultSink(entry: PipelineLogEntry): void {
  console.info(`[undo:pipeline] ${JSON.stringify(entry)}`);
}

/** Creates one structured, correlated logger without retaining request or response bodies. */
export function createPipelineLogger(options: {
  readonly traceId: string;
  readonly scope: PipelineLogEntry["scope"];
  readonly now?: () => string;
  readonly sink?: (entry: PipelineLogEntry) => void;
}): PipelineLogger {
  const now = options.now ?? (() => new Date().toISOString());
  const sink = options.sink ?? defaultSink;
  return {
    traceId: options.traceId,
    log(stage, status, details) {
      sink({
        timestamp: now(),
        traceId: options.traceId,
        scope: options.scope,
        stage: sanitizeString(stage),
        status,
        ...(details === undefined ? {} : { details: sanitizeDetails(details) }),
      });
    },
  };
}

/** Converts an unknown failure into a bounded message and type, never a stack or response body. */
export function errorLogDetails(cause: unknown): PipelineLogDetails {
  if (cause instanceof Error) {
    if (cause instanceof SyntaxError) {
      return {
        errorType: "SyntaxError",
        errorMessage: "Invalid JSON or structured data",
      };
    }
    return { errorType: cause.name || "Error" };
  }
  if (typeof cause === "number" || typeof cause === "boolean") {
    return { errorType: typeof cause, errorValue: cause };
  }
  if (typeof cause === "string") {
    return { errorType: "string" };
  }
  return { errorType: "unknown" };
}

/** Adds the validated correlation header used by every live browser adapter. */
export function pipelineTraceHeaders(traceId: string | undefined): Readonly<Record<string, string>> {
  return traceId !== undefined && TRACE_ID_PATTERN.test(traceId)
    ? { [PIPELINE_TRACE_HEADER]: traceId }
    : {};
}

/** Accepts a safe incoming correlation ID or creates a server-owned replacement. */
export function pipelineTraceIdFrom(value: unknown, fallback: () => string): string {
  return typeof value === "string" && TRACE_ID_PATTERN.test(value) ? value : fallback();
}
