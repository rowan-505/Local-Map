import type { SearchIndexHealthReport } from "./search-index-health.js";

type CacheEntry = {
    value: SearchIndexHealthReport;
    expiresAt: number;
};

const CACHE_KEY = "search:index-health:report";
const DEFAULT_TTL_MS = 30_000;

const store = new Map<string, CacheEntry>();

export const SEARCH_INDEX_HEALTH_CACHE_TTL_MS = DEFAULT_TTL_MS;

export function clearSearchIndexHealthCache(): void {
    store.clear();
}

export function seedSearchIndexHealthCache(
    report: SearchIndexHealthReport,
    options: { ttlMs?: number; now?: number } = {},
): void {
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    store.set(CACHE_KEY, { value: report, expiresAt: now + ttlMs });
}

export function peekSearchIndexHealthCache(
    now: number = Date.now(),
): SearchIndexHealthReport | null {
    const hit = store.get(CACHE_KEY);
    if (!hit || hit.expiresAt <= now) {
        return null;
    }
    return hit.value;
}

export async function getCachedSearchIndexHealthReport(
    loader: () => Promise<SearchIndexHealthReport>,
    options: { refresh?: boolean; ttlMs?: number; now?: number } = {},
): Promise<SearchIndexHealthReport> {
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

    if (!options.refresh) {
        const cached = peekSearchIndexHealthCache(now);
        if (cached) {
            return cached;
        }
    }

    const value = await loader();
    store.set(CACHE_KEY, { value, expiresAt: now + ttlMs });
    return value;
}
