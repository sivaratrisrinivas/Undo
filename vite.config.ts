import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { createMemoryCheckoutStateStore } from "./src/server/checkout-state.ts";
import { handleUndoApi, type UndoApiRoute } from "./src/server/undo-api.ts";

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
  }
  return headers;
}

async function requestBody(request: IncomingMessage): Promise<string | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  request.setEncoding("utf8");
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

async function writeResponse(webResponse: Response, response: ServerResponse): Promise<void> {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

function undoApiPlugin(env: Record<string, string>): Plugin {
  const state = createMemoryCheckoutStateStore();
  const routes: ReadonlyArray<UndoApiRoute> = [
    "policy-evidence",
    "policy-extraction",
    "checkout-quotes",
    "checkout-authorizations",
    "checkout",
    "checkout-result",
  ];
  return {
    name: "undo-live-api",
    configureServer(server) {
      for (const route of routes) {
        server.middlewares.use(`/api/${route}`, (request, response) => {
          const run = async () => {
            const url = new URL(request.url ?? `/api/${route}`, "http://localhost");
            const body = await requestBody(request);
            const init: RequestInit = {
              method: request.method ?? "GET",
              headers: requestHeaders(request),
              ...(body === undefined ? {} : { body }),
            };
            const webRequest = new Request(url, init);
            await writeResponse(
              await handleUndoApi(route, webRequest, { env, state }),
              response,
            );
          };
          run().catch(() => {
            if (response.headersSent) return response.end();
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Undo API unavailable" }));
          });
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), undoApiPlugin(env)],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
    },
  };
});
