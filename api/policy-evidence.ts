import { handleVercelRoute } from "../src/server/vercel-runtime.js";

export const maxDuration = 60;

export function POST(request: Request): Promise<Response> {
  return handleVercelRoute("policy-evidence", request);
}
