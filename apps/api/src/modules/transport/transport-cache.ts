/**
 * Simple in-memory, short-TTL cache for Transport READ endpoints.
 *
 * Scope and safety:
 *   - Process-local only. No Redis / external cache.
 *   - Transport API only (this module is imported solely by the Transport service).
 *   - All Transport endpoints are admin-only and return the same payload for every
 *     admin, so a single shared cache (keyed by query params) is safe.
 *   - Every Transport mutation calls {@link clearTransportCache}, so cached list /
 *     overview data can be at most one TTL window stale and never survives a write.
 *   - Mutation endpoints are never cached.
 *
 * Enable dev hit/miss logging with `TRANSPORT_CACHE_LOG=1` (silent otherwise).
 */

type CacheEntry = { value: unknown; expiresAt: number };

const store = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
let generation = 0;

const CACHE_LOG = process.env.TRANSPORT_CACHE_LOG === "1";

function log(message: string): void {
    if (CACHE_LOG) {
        // eslint-disable-next-line no-console
        console.log(`[transport.cache] ${message}`);
    }
}

/**
 * Returns a cached value when present and unexpired, otherwise runs `loader`,
 * stores its result for `ttlMs`, and returns it. Loader errors are propagated and
 * never cached (so a transient failure or schema-unavailable state is not stuck).
 */
export async function getTransportCached<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>
): Promise<T> {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.expiresAt > now) {
        log(`HIT ${key}`);
        return hit.value as T;
    }
    const pending = inFlight.get(key);
    if (pending) {
        log(`JOIN ${key}`);
        return pending as Promise<T>;
    }
    log(`MISS ${key}`);
    const startedGeneration = generation;
    const promise = (async () => {
        const value = await loader();
        if (generation === startedGeneration) {
            store.set(key, { value, expiresAt: Date.now() + ttlMs });
        }
        return value;
    })();
    inFlight.set(key, promise);
    try {
        return await promise;
    } finally {
        if (inFlight.get(key) === promise) {
            inFlight.delete(key);
        }
    }
}

/** Drops every cached Transport entry. Called after any Transport mutation. */
export function clearTransportCache(): void {
    const size = store.size;
    generation += 1;
    store.clear();
    inFlight.clear();
    log(`CLEAR (${size} entr${size === 1 ? "y" : "ies"})`);
}

/**
 * Builds a deterministic cache key from a prefix + query params. Keys are sorted
 * and undefined values dropped so equivalent queries map to the same entry
 * regardless of property order.
 */
export function transportCacheKey(prefix: string, params: Record<string, unknown>): string {
    const entries = Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${String(value)}`);
    return entries.length > 0 ? `${prefix}?${entries.join("&")}` : prefix;
}
