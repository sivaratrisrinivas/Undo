import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { retrievePolicyEvidenceFromSenso, type SensoOfficialSource } from "./src/adapters/senso-evidence-server.ts";
import {
  extractPoliciesWithOpenAi,
  openAiApiKeyFrom,
  parsePolicyEvidenceInput,
} from "./src/adapters/openai-policy-extraction-server.ts";
import { OFFICIAL_EVIDENCE_SOURCES, SUPPORTED_PRODUCT, type Product } from "./src/domain.ts";

function boundaryRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  // SAFETY: The object/null/array checks above establish a plain JSON object boundary.
  return value as Record<string, unknown>;
}

function parseProduct(value: unknown): Product {
  const product = boundaryRecord(value);
  if (
    product.manufacturer !== SUPPORTED_PRODUCT.manufacturer ||
    product.model !== SUPPORTED_PRODUCT.model ||
    product.condition !== SUPPORTED_PRODUCT.condition ||
    product.colour !== SUPPORTED_PRODUCT.colour ||
    product.bundle !== SUPPORTED_PRODUCT.bundle ||
    product.warrantyRegion !== SUPPORTED_PRODUCT.warrantyRegion
  ) {
    throw new Error("Unsupported Product");
  }
  return SUPPORTED_PRODUCT;
}

function kbNodeIds(value: string | undefined): ReadonlyArray<string> {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function sensoEvidencePlugin(env: Record<string, string>): Plugin {
  const kbNodeIdsByOffer = {
    "headphone-zone": kbNodeIds(env.SENSO_HEADPHONE_ZONE_KB_NODE_IDS),
    "concept-kart": kbNodeIds(env.SENSO_CONCEPT_KART_KB_NODE_IDS),
    flipkart: kbNodeIds(env.SENSO_FLIPKART_KB_NODE_IDS),
  } as const;
  const sources: ReadonlyArray<SensoOfficialSource> = OFFICIAL_EVIDENCE_SOURCES.map((source) => ({
    ...source,
    kbNodeIds: kbNodeIdsByOffer[source.offerId],
  }));
  return {
    name: "undo-senso-policy-evidence",
    configureServer(server) {
      server.middlewares.use("/api/policy-evidence", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          const handleRequest = async () => {
            try {
              if (body.length > 1_000_000) throw new Error("Request is too large");
              const payload: unknown = JSON.parse(body);
              const product = parseProduct(boundaryRecord(payload).product);
              const result = await retrievePolicyEvidenceFromSenso(product, {
                apiKey: env.SENSO_API_KEY ?? "",
                sources,
              });
              response.statusCode = 200;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify(result));
            } catch {
              response.statusCode = 503;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Policy evidence unavailable" }));
            }
          };
          handleRequest().catch((cause: unknown) => {
            response.statusCode = cause instanceof Error ? 503 : 500;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Policy evidence unavailable" }));
          });
        });
      });
    },
  };
}

function openAiPolicyExtractionPlugin(env: Record<string, string>): Plugin {
  const apiKey = openAiApiKeyFrom(env.OPENAI_API_KEY);
  return {
    name: "undo-openai-policy-extraction",
    configureServer(server) {
      server.middlewares.use("/api/policy-extraction", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        let body = "";
        const abortController = new AbortController();
        request.on("aborted", () => abortController.abort());
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          const handleRequest = async () => {
            if (body.length > 1_000_000) {
              response.statusCode = 413;
              response.end(JSON.stringify({ error: "Request is too large" }));
              return;
            }
            let evidence;
            try {
              const payload: unknown = JSON.parse(body);
              evidence = parsePolicyEvidenceInput(boundaryRecord(payload).evidence);
            } catch (cause: unknown) {
              response.statusCode = cause instanceof SyntaxError ? 400 : 422;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Invalid Policy Evidence request" }));
              return;
            }
            const model = env.OPENAI_POLICY_MODEL || "gpt-5.6-sol";
            const result = await extractPoliciesWithOpenAi(evidence, {
              apiKey,
              model,
              signal: abortController.signal,
            });
            response.setHeader("Content-Type", "application/json");
            if (result._tag === "err") {
              response.statusCode = 503;
              response.end(JSON.stringify({ error: "Policy extraction unavailable" }));
              return;
            }
            response.statusCode = 200;
            response.end(JSON.stringify({ policies: result.value, model }));
          };
          handleRequest().catch((cause: unknown) => {
            response.statusCode = cause instanceof Error ? 503 : 500;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Policy extraction unavailable" }));
          });
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), sensoEvidencePlugin(env), openAiPolicyExtractionPlugin(env)],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
    },
  };
});
