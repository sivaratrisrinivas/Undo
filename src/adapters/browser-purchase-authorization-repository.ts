import type {
  PurchaseAuthorizationRepository,
  StoredPurchaseAuthorization,
} from "../workflow";

const STORAGE_PREFIX = "undo:purchase-authorization:";

/** Minimal exclusive-lock capability required for atomic browser storage transitions. */
export type AuthorizationLockManager = {
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T>;
};

function storageKey(id: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(id)}`;
}

function parseStoredAuthorization(value: string | null): StoredPurchaseAuthorization | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.authorizationSnapshot !== "string" ||
      typeof record.assessmentSnapshot !== "string" ||
      (record.state !== "active" && record.state !== "invalidated" && record.state !== "used")
    ) {
      return undefined;
    }
    return {
      authorizationSnapshot: record.authorizationSnapshot,
      assessmentSnapshot: record.assessmentSnapshot,
      state: record.state,
    };
  } catch (_cause: unknown) {
    return undefined;
  }
}

/** Persists authorization lifecycles across reloads with per-ID Web Lock transitions. */
export function createBrowserPurchaseAuthorizationRepository(
  storage: Storage,
  locks: AuthorizationLockManager,
): PurchaseAuthorizationRepository {
  return {
    async create(id, value) {
      try {
        return await locks.request(storageKey(id), () => {
          const key = storageKey(id);
          if (storage.getItem(key) !== null) return "duplicate" as const;
          storage.setItem(key, JSON.stringify(value));
          return "created" as const;
        });
      } catch (_cause: unknown) {
        return "unavailable";
      }
    },
    async read(id, authorizationSnapshot) {
      try {
        return await locks.request(storageKey(id), () => {
          const value = parseStoredAuthorization(storage.getItem(storageKey(id)));
          return value === undefined || value.authorizationSnapshot !== authorizationSnapshot
            ? { _tag: "invalid" as const }
            : { _tag: "ok" as const, value };
        });
      } catch (_cause: unknown) {
        return { _tag: "unavailable" };
      }
    },
    async transition(id, authorizationSnapshot, nextState) {
      try {
        return await locks.request(storageKey(id), () => {
          const key = storageKey(id);
          const value = parseStoredAuthorization(storage.getItem(key));
          if (value === undefined || value.authorizationSnapshot !== authorizationSnapshot) {
            return "invalid" as const;
          }
          if (value.state !== "active") return value.state;
          storage.setItem(key, JSON.stringify({ ...value, state: nextState }));
          return "updated" as const;
        });
      } catch (_cause: unknown) {
        return "unavailable";
      }
    },
  };
}
