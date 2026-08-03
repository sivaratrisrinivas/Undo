import { handleVercelRoute } from "../src/server/vercel-runtime.js";

export const maxDuration = 120;

export function POST(request: Request): Promise<Response> {
  return handleVercelRoute("checkout-result", request);
}
