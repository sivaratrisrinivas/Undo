import { createRedisCheckoutStateStore } from "./checkout-state.js";
import { handleUndoApi, type UndoApiRoute } from "./undo-api.js";

export function handleVercelRoute(route: UndoApiRoute, request: Request): Promise<Response> {
  return handleUndoApi(route, request, {
    env: process.env,
    state: createRedisCheckoutStateStore(process.env),
  });
}
