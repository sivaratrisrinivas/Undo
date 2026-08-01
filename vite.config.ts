import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { retrievePolicyEvidenceFromSenso, type SensoOfficialSource } from "./src/adapters/senso-evidence-server.ts";
import type { Product } from "./src/domain.ts";

function contentIds(value: string | undefined): ReadonlyArray<string> {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function sensoEvidencePlugin(env: Record<string, string>): Plugin {
  const sources: ReadonlyArray<SensoOfficialSource> = [
    { offerId: "headphone-zone", merchant: "Headphone Zone", sourceUrl: "https://www.headphonezone.in/pages/returns-refunds", scope: { kind: "product", value: "Sennheiser HD 560S" }, contentIds: contentIds(env.SENSO_HEADPHONE_ZONE_CONTENT_IDS) },
    { offerId: "concept-kart", merchant: "Concept Kart", sourceUrl: "https://conceptkart.com/pages/refund-policy", scope: { kind: "category", value: "Headphones" }, contentIds: contentIds(env.SENSO_CONCEPT_KART_CONTENT_IDS) },
    { offerId: "flipkart", merchant: "Flipkart", sourceUrl: "https://www.flipkart.com/pages/returnpolicy", scope: { kind: "category", value: "Headphones" }, contentIds: contentIds(env.SENSO_FLIPKART_CONTENT_IDS) },
  ];
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
              const payload = JSON.parse(body) as { product?: Product };
              if (payload.product === undefined) throw new Error("Product is required");
              const result = await retrievePolicyEvidenceFromSenso(payload.product, {
                apiKey: env.SENSO_API_KEY ?? "",
                sources,
              });
              response.statusCode = 200;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify(result));
            } catch (error) {
              response.statusCode = 503;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Senso unavailable" }));
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
    plugins: [react(), sensoEvidencePlugin(env)],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
    },
  };
});
