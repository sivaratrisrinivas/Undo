import { handleVercelRoute } from "../src/server/vercel-runtime.js";

export const maxDuration = 30;

export function POST(request: Request): Promise<Response> {
  return handleVercelRoute("checkout-authorizations", request);
}
