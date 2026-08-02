import {
  SUPPORTED_OFFERS,
  type EvidenceSnapshot,
  type Offer,
  type Product,
} from "../domain";
import type { AdapterResult, AssessmentAdapters } from "../workflow";
import { pipelineTraceHeaders } from "../pipeline-logging";

type SensoEvidenceDocument = Omit<
  EvidenceSnapshot,
  "fingerprint" | "retrievedVia" | "retrievalState"
>;

function isScope(value: unknown): value is EvidenceSnapshot["scope"] {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "product" || candidate.kind === "category") &&
    typeof candidate.value === "string"
  );
}

function isOfferId(value: unknown): value is Offer["id"] {
  return SUPPORTED_OFFERS.some((offer) => offer.id === value);
}

function parseDocument(value: unknown): SensoEvidenceDocument | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !isOfferId(candidate.offerId) ||
    typeof candidate.merchant !== "string" ||
    typeof candidate.sourceUrl !== "string" ||
    !isScope(candidate.scope) ||
    typeof candidate.collectedAt !== "string" ||
    typeof candidate.exactText !== "string"
  ) {
    return undefined;
  }
  return {
    offerId: candidate.offerId,
    merchant: candidate.merchant,
    sourceUrl: candidate.sourceUrl,
    scope: candidate.scope,
    collectedAt: candidate.collectedAt,
    exactText: candidate.exactText,
  };
}

export async function fingerprintEvidenceText(exactText: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exactText));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}

/**
 * Creates the browser-side half of the Senso evidence boundary.
 *
 * The backend endpoint owns the Senso API key and returns raw official-source documents. The
 * browser sends Product identity only; buyer checkout and Delivery Destination data stay out of
 * this path.
 */
export function createSensoEvidenceAdapter(options?: {
  readonly endpoint?: string;
  readonly fetcher?: typeof fetch;
}): AssessmentAdapters["senso"] {
  const endpoint = options?.endpoint ?? "/api/policy-evidence";
  const fetcher = options?.fetcher ?? fetch;

  return {
    async retrieveEvidence(
      product: Product,
      traceId?: string,
    ): Promise<AdapterResult<ReadonlyArray<EvidenceSnapshot>>> {
      try {
        const productProjection: Product = {
          manufacturer: product.manufacturer,
          model: product.model,
          variant: product.variant,
          condition: product.condition,
          bundleContents: product.bundleContents,
          warrantyRegion: product.warrantyRegion,
        };
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...pipelineTraceHeaders(traceId) },
          body: JSON.stringify({ product: productProjection }),
        });
        if (!response.ok) throw new Error(`Senso evidence endpoint returned ${response.status}`);
        const payload: unknown = await response.json();
        const documents =
          typeof payload === "object" && payload !== null && Array.isArray((payload as { documents?: unknown }).documents)
            ? (payload as { documents: ReadonlyArray<unknown> }).documents
            : [];
        const parsed = documents.map(parseDocument).filter((value) => value !== undefined);
        const snapshots = await Promise.all(
          parsed.map(async (document): Promise<EvidenceSnapshot> => ({
            ...document,
            fingerprint: await fingerprintEvidenceText(document.exactText),
            retrievedVia: "senso",
            retrievalState: "current",
          })),
        );
        return { _tag: "ok", value: snapshots };
      } catch (cause) {
        return {
          _tag: "err",
          error: { _tag: "DependencyUnavailable", dependency: "senso", cause },
        };
      }
    },
  };
}
