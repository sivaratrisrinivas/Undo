import type { EvidenceSnapshot, PolicyAssessment } from "../domain";
import type { AdapterResult, AssessmentAdapters } from "../workflow";
import { parseExtractedPolicies } from "./openai-policy-extraction-server";
import { pipelineTraceHeaders } from "../pipeline-logging";

function extractionFrom(value: unknown, evidence: ReadonlyArray<EvidenceSnapshot>): {
  readonly policies: ReadonlyArray<PolicyAssessment>;
  readonly model: string;
} {
  if (typeof value !== "object" || value === null) throw new Error("Invalid extraction response");
  // SAFETY: The object/null check above establishes a JSON object for boundary parsing.
  const response = value as { policies?: unknown; model?: unknown };
  const model = response.model;
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error("Extraction response did not identify the model");
  }
  return { policies: parseExtractedPolicies(value, evidence, { normalized: true }), model };
}

/** Creates the browser half of the server-only OpenAI structured extraction boundary. */
export function createOpenAiPolicyExtractionAdapter(options?: {
  readonly endpoint?: string;
  readonly fetcher?: typeof fetch;
}): AssessmentAdapters["openAi"] {
  const endpoint = options?.endpoint ?? "/api/policy-extraction";
  const fetcher = options?.fetcher ?? fetch;
  let modelVersion = "openai/unavailable";
  return {
    modelVersion: () => modelVersion,
    async extractPolicies(
      evidence: ReadonlyArray<EvidenceSnapshot>,
      traceId?: string,
    ): Promise<AdapterResult<ReadonlyArray<PolicyAssessment>>> {
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...pipelineTraceHeaders(traceId) },
          body: JSON.stringify({ evidence }),
        });
        if (!response.ok) throw new Error(`OpenAI extraction endpoint returned ${response.status}`);
        const extraction = extractionFrom(await response.json(), evidence);
        modelVersion = `openai/${extraction.model}`;
        return { _tag: "ok", value: extraction.policies };
      } catch (cause) {
        return {
          _tag: "err",
          error: { _tag: "DependencyUnavailable", dependency: "openai", cause },
        };
      }
    },
  };
}
