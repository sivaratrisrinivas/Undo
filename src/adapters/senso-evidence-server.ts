import { SUPPORTED_PRODUCT, type EvidenceSnapshot, type Offer, type Product } from "../domain.ts";

export type SensoOfficialSource = {
  readonly offerId: Offer["id"];
  readonly merchant: string;
  readonly sourceUrl: string;
  readonly scope: EvidenceSnapshot["scope"];
  readonly contentIds: ReadonlyArray<string>;
};

type SensoSearchResult = {
  readonly content_id: string;
  readonly chunk_index: number;
  readonly chunk_text: string;
};

function isSupportedProduct(product: Product): boolean {
  return JSON.stringify(product) === JSON.stringify(SUPPORTED_PRODUCT);
}

function searchResults(value: unknown): ReadonlyArray<SensoSearchResult> {
  if (typeof value !== "object" || value === null) return [];
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.filter((result): result is SensoSearchResult => {
    if (typeof result !== "object" || result === null) return false;
    const candidate = result as Record<string, unknown>;
    return (
      typeof candidate.content_id === "string" &&
      typeof candidate.chunk_index === "number" &&
      Number.isSafeInteger(candidate.chunk_index) &&
      candidate.chunk_index >= 0 &&
      typeof candidate.chunk_text === "string"
    );
  });
}

/** Server-only Senso query used by the `/api/policy-evidence` route. */
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
  const collectedAt = (options.now ?? (() => new Date().toISOString()))();
  const documents = await Promise.all(
    options.sources.map(async (source) => {
      if (source.contentIds.length === 0) {
        throw new Error(`Senso content IDs are not configured for ${source.merchant}`);
      }
      const response = await fetcher("https://apiv2.senso.ai/api/v1/org/search/context", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": options.apiKey },
        body: JSON.stringify({
          query: `Return, refund, exchange, replacement, condition, window, transport, and fee terms for ${source.merchant} Sennheiser HD 560S`,
          max_results: 20,
          content_ids: source.contentIds,
          require_scoped_ids: true,
        }),
      });
      if (!response.ok) throw new Error(`Senso search returned ${response.status}`);
      const results = searchResults(await response.json()).filter((result) =>
        source.contentIds.includes(result.content_id),
      ).sort((left, right) => left.chunk_index - right.chunk_index);
      return {
        offerId: source.offerId,
        merchant: source.merchant,
        sourceUrl: source.sourceUrl,
        scope: source.scope,
        collectedAt,
        exactText: results.map((result) => result.chunk_text).join("\n\n"),
      };
    }),
  );
  return { documents };
}
