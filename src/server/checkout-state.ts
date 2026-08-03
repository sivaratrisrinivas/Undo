import { Redis } from "@upstash/redis";

import type { PravaCheckoutRequest, PravaCheckoutResult } from "../domain.js";

export type CheckoutAuthorizationState = {
  readonly request: string;
  readonly grant: string;
};

export type PersistedPaymentSessionState = {
  readonly request: PravaCheckoutRequest;
  readonly paymentGrant: string;
  readonly expiresAt: string;
  readonly merchantCheckoutMayHaveStarted: boolean;
  readonly finalResult?: PravaCheckoutResult;
  readonly pendingReport?: {
    readonly transactionReference: string;
    readonly result: PravaCheckoutResult;
  };
};

export type CheckoutStateStore = {
  createAuthorization(
    authorizationId: string,
    state: CheckoutAuthorizationState,
    ttlSeconds: number,
  ): Promise<boolean>;
  consumeAuthorization(
    authorizationId: string,
    expected: CheckoutAuthorizationState,
    ttlSeconds: number,
  ): Promise<"consumed" | "missing" | "mismatch">;
  savePaymentSession(
    sessionId: string,
    state: PersistedPaymentSessionState,
    ttlSeconds: number,
  ): Promise<void>;
  getPaymentSession(sessionId: string): Promise<PersistedPaymentSessionState | undefined>;
  acquirePaymentLock(sessionId: string, owner: string, ttlMilliseconds: number): Promise<boolean>;
  releasePaymentLock(sessionId: string, owner: string): Promise<void>;
};

const KEY_PREFIX = "undo:v1";

function authorizationKey(authorizationId: string): string {
  return `${KEY_PREFIX}:authorization:${authorizationId}`;
}

function paymentKey(sessionId: string): string {
  return `${KEY_PREFIX}:payment:${sessionId}`;
}

function paymentLockKey(sessionId: string): string {
  return `${paymentKey(sessionId)}:lock`;
}

function positiveTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("State TTL must be positive");
  return value;
}

function parsePaymentState(value: unknown): PersistedPaymentSessionState | undefined {
  if (value === null) return undefined;
  if (value === undefined) return undefined;
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Stored payment state is invalid");
  }
  return parsed as PersistedPaymentSessionState;
}

/** Durable checkout state for Vercel Functions, backed by Marketplace Upstash Redis. */
export function createRedisCheckoutStateStore(
  env: Readonly<Record<string, string | undefined>>,
): CheckoutStateStore {
  const url = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  if (url === undefined || url === "" || token === undefined || token === "") {
    throw new Error("Upstash Redis checkout state is not configured");
  }
  const redis = new Redis({ url, token });
  return {
    async createAuthorization(authorizationId, state, ttlSeconds) {
      const result = await redis.set(
        authorizationKey(authorizationId),
        JSON.stringify(state),
        { nx: true, ex: positiveTtl(ttlSeconds) },
      );
      return result === "OK";
    },
    async consumeAuthorization(authorizationId, expected, ttlSeconds) {
      const key = authorizationKey(authorizationId);
      const consumedMarker = JSON.stringify({ consumed: true });
      const result = await redis.eval<[string, string, number], number>(
        [
          "local current = redis.call('GET', KEYS[1])",
          "if not current then return 0 end",
          "if current ~= ARGV[1] then return -1 end",
          "redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])",
          "return 1",
        ].join("\n"),
        [key],
        [JSON.stringify(expected), consumedMarker, positiveTtl(ttlSeconds)],
      );
      return result === 1 ? "consumed" : result === 0 ? "missing" : "mismatch";
    },
    async savePaymentSession(sessionId, state, ttlSeconds) {
      await redis.set(paymentKey(sessionId), JSON.stringify(state), {
        ex: positiveTtl(ttlSeconds),
      });
    },
    async getPaymentSession(sessionId) {
      const value = await redis.get<PersistedPaymentSessionState>(paymentKey(sessionId));
      return parsePaymentState(value);
    },
    async acquirePaymentLock(sessionId, owner, ttlMilliseconds) {
      const result = await redis.set(paymentLockKey(sessionId), owner, {
        nx: true,
        px: ttlMilliseconds,
      });
      return result === "OK";
    },
    async releasePaymentLock(sessionId, owner) {
      await redis.eval<[string], number>(
        [
          "if redis.call('GET', KEYS[1]) == ARGV[1] then",
          "  return redis.call('DEL', KEYS[1])",
          "end",
          "return 0",
        ].join("\n"),
        [paymentLockKey(sessionId)],
        [owner],
      );
    },
  };
}

/** In-process implementation used by Vite development and focused tests. */
export function createMemoryCheckoutStateStore(): CheckoutStateStore {
  const authorizations = new Map<string, { value: string; expiresAt: number }>();
  const paymentSessions = new Map<string, { value: string; expiresAt: number }>();
  const locks = new Map<string, { owner: string; expiresAt: number }>();
  const alive = <T extends { expiresAt: number }>(value: T | undefined): T | undefined => {
    return value !== undefined && value.expiresAt > Date.now() ? value : undefined;
  };
  return {
    createAuthorization(authorizationId, state, ttlSeconds) {
      const current = alive(authorizations.get(authorizationId));
      if (current !== undefined) return Promise.resolve(false);
      authorizations.set(authorizationId, {
        value: JSON.stringify(state),
        expiresAt: Date.now() + positiveTtl(ttlSeconds) * 1000,
      });
      return Promise.resolve(true);
    },
    consumeAuthorization(authorizationId, expected, ttlSeconds) {
      const current = alive(authorizations.get(authorizationId));
      if (current === undefined) return Promise.resolve("missing" as const);
      if (current.value !== JSON.stringify(expected)) return Promise.resolve("mismatch" as const);
      authorizations.set(authorizationId, {
        value: JSON.stringify({ consumed: true }),
        expiresAt: Date.now() + positiveTtl(ttlSeconds) * 1000,
      });
      return Promise.resolve("consumed" as const);
    },
    savePaymentSession(sessionId, state, ttlSeconds) {
      paymentSessions.set(sessionId, {
        value: JSON.stringify(state),
        expiresAt: Date.now() + positiveTtl(ttlSeconds) * 1000,
      });
      return Promise.resolve();
    },
    getPaymentSession(sessionId) {
      const current = alive(paymentSessions.get(sessionId));
      return Promise.resolve(current === undefined ? undefined : parsePaymentState(current.value));
    },
    acquirePaymentLock(sessionId, owner, ttlMilliseconds) {
      const current = alive(locks.get(sessionId));
      if (current !== undefined) return Promise.resolve(false);
      locks.set(sessionId, { owner, expiresAt: Date.now() + ttlMilliseconds });
      return Promise.resolve(true);
    },
    releasePaymentLock(sessionId, owner) {
      if (locks.get(sessionId)?.owner === owner) locks.delete(sessionId);
      return Promise.resolve();
    },
  };
}
