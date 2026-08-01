import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { retrievePolicyEvidenceFromSenso, type SensoOfficialSource } from "./src/adapters/senso-evidence-server.ts";
import {
  extractPoliciesWithOpenAi,
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

function contentIds(value: string | undefined): ReadonlyArray<string> {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function sensoEvidencePlugin(env: Record<string, string>): Plugin {
  const contentIdsByOffer = {
    "headphone-zone": contentIds(env.SENSO_HEADPHONE_ZONE_CONTENT_IDS),
    "concept-kart": contentIds(env.SENSO_CONCEPT_KART_CONTENT_IDS),
    flipkart: contentIds(env.SENSO_FLIPKART_CONTENT_IDS),
  } as const;
  const sources: ReadonlyArray<SensoOfficialSource> = OFFICIAL_EVIDENCE_SOURCES.map((source) => ({
    ...source,
    contentIds: contentIdsByOffer[source.offerId],
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
          void (async () => {
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
          })();
        });
      });
    },
  };
}

function openAiPolicyExtractionPlugin(env: Record<string, string>): Plugin {
  return {
    name: "undo-openai-policy-extraction",
    configureServer(server) {
      server.middlewares.use("/api/policy-extraction", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          void (async () => {
            try {
              if (body.length > 1_000_000) throw new Error("Request is too large");
              const payload: unknown = JSON.parse(body);
              const evidence = parsePolicyEvidenceInput(boundaryRecord(payload).evidence);
              const model = env.OPENAI_POLICY_MODEL || "gpt-5.6";
              const policies = await extractPoliciesWithOpenAi(evidence, {
                apiKey: env.OPENAI_API_KEY ?? "",
                model,
              });
              response.statusCode = 200;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ policies, model }));
            } catch {
              response.statusCode = 503;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Policy extraction unavailable" }));
            }
          })();
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
