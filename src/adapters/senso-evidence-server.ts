import { SUPPORTED_PRODUCT, type EvidenceSnapshot, type Offer, type Product } from "../domain.ts";

export type SensoOfficialSource = {
  readonly offerId: Offer["id"];
  readonly merchant: string;
  readonly sourceUrl: string;
  readonly scope: EvidenceSnapshot["scope"];
  readonly requiredTextMarkers: ReadonlyArray<string>;
  readonly kbNodeIds: ReadonlyArray<string>;
};

type SensoRawContent = {
  readonly text: string;
  readonly updatedAt: string;
};

const MAX_CAPTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Parses a comma-separated list of configured Senso KB node IDs. */
export function parseKbNodeIds(value: string | undefined): ReadonlyArray<string> {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function isSupportedProduct(product: Product): boolean {
  return JSON.stringify(product) === JSON.stringify(SUPPORTED_PRODUCT);
}

function parseSensoRawContent(value: unknown, latestAllowedCaptureTime: number): SensoRawContent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Senso returned invalid raw Policy Evidence");
  }
  // SAFETY: The object/null/array checks above establish a JSON object boundary.
  const content = value as Record<string, unknown>;
  if (
    typeof content.id !== "string" ||
    content.type !== "raw" ||
    content.processing_status !== "complete" ||
    typeof content.updated_at !== "string" ||
    !Number.isFinite(Date.parse(content.updated_at)) ||
    Date.parse(content.updated_at) > latestAllowedCaptureTime ||
    typeof content.text !== "string" ||
    content.text.trim() === ""
  ) {
    throw new Error("Senso returned invalid raw Policy Evidence");
  }
  return { text: content.text, updatedAt: content.updated_at };
}

/** Server-only Senso retrieval used by the `/api/policy-evidence` route. */
export async function retrievePolicyEvidenceFromSenso(
  product: Product,
  options: {
    readonly apiKey: string;
    readonly sources: ReadonlyArray<SensoOfficialSource>;
    readonly fetcher?: typeof fetch;
    readonly now?: () => string;
  },
): Promise<{ readonly documents: ReadonlyArray<Omit<EvidenceSnapshot, "fingerprint" | "retrievedVia" | "retrievalState">> }> {
  if (!isSupportedProduct(product)) throw new Error("Unsupported Product");
  if (options.apiKey.trim() === "") throw new Error("SENSO_API_KEY is not configured");
  const fetcher = options.fetcher ?? fetch;
  const currentTime = Date.parse((options.now ?? (() => new Date().toISOString()))());
  if (!Number.isFinite(currentTime)) throw new Error("Current time is invalid");
  const latestAllowedCaptureTime = currentTime + MAX_CAPTURE_CLOCK_SKEW_MS;
  const documents = await Promise.all(
    options.sources.map(async (source) => {
      if (source.kbNodeIds.length === 0) {
        throw new Error(`Senso KB node IDs are not configured for ${source.merchant}`);
      }
      const contents = await Promise.all(
        source.kbNodeIds.map(async (nodeId) => {
          const response = await fetcher(
            `https://apiv2.senso.ai/api/v1/org/kb/nodes/${encodeURIComponent(nodeId)}/content`,
            { headers: { "X-API-Key": options.apiKey } },
          );
          if (!response.ok) throw new Error(`Senso content retrieval returned ${response.status}`);
          return parseSensoRawContent(await response.json(), latestAllowedCaptureTime);
        }),
      );
      const oldestCaptureTime = Math.min(
        ...contents.map((content) => Date.parse(content.updatedAt)),
      );
      if (
        !contents.every((content) =>
          source.requiredTextMarkers.every((marker) => content.text.includes(marker)))
      ) {
        throw new Error(`Senso returned Policy Evidence with invalid provenance for ${source.merchant}`);
      }
      const exactText = contents.map((content) => content.text).join("\n\n");
      return {
        offerId: source.offerId,
        merchant: source.merchant,
        sourceUrl: source.sourceUrl,
        scope: source.scope,
        collectedAt: new Date(oldestCaptureTime).toISOString(),
        exactText,
      };
    }),
  );
  return { documents };
}
