import type { Geometry } from "geojson";

import type { EntityAdminAreaInferResult, EntityAdminAreaKind } from "@/src/lib/api";

const COORD_ROUND_FACTOR = 1e7;

function roundCoord(value: number): number {
    return Math.round(value * COORD_ROUND_FACTOR) / COORD_ROUND_FACTOR;
}

function stableCoordinatesKey(coordinates: unknown): string {
    return JSON.stringify(coordinates, (_key, value) =>
        typeof value === "number" ? roundCoord(value) : value,
    );
}

/** Stable geometry fingerprint for infer de-duplication. */
export function stableInferGeometryKey(
    entityKind: EntityAdminAreaKind,
    geomValue: Geometry | null | undefined,
    placePoint: { lat: number; lng: number } | null,
    busStopPoint: { lat: number; lng: number } | null,
): string {
    if (entityKind === "place" && placePoint) {
        return `point:${roundCoord(placePoint.lng)},${roundCoord(placePoint.lat)}`;
    }
    if (entityKind === "bus_stop" && busStopPoint) {
        return `point:${roundCoord(busStopPoint.lng)},${roundCoord(busStopPoint.lat)}`;
    }
    if (!geomValue) {
        return "none";
    }
    return `${geomValue.type}:${stableCoordinatesKey(geomValue.coordinates)}`;
}

export function buildInferDedupKey(params: {
    kind: EntityAdminAreaKind;
    entityPublicId: string | null | undefined;
    currentAdminAreaId: string;
    geometryKey: string;
}): string {
    return [
        params.kind,
        params.entityPublicId?.trim() || "",
        params.currentAdminAreaId.trim(),
        params.geometryKey,
    ].join("|");
}

type InferDedupRun = (signal: AbortSignal) => Promise<EntityAdminAreaInferResult>;

const INFER_SESSION_CACHE_PREFIX = "coremap:entity-admin-infer:";
const INFER_SESSION_CACHE_MAX = 64;

const completedInferByKey = new Map<string, EntityAdminAreaInferResult>();
const pendingInferByKey = new Map<string, Promise<EntityAdminAreaInferResult>>();
const debounceTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();
const abortControllerByKey = new Map<string, AbortController>();
const sessionCacheKeyOrder: string[] = [];

function readInferSessionCache(key: string): EntityAdminAreaInferResult | undefined {
    if (typeof window === "undefined") {
        return undefined;
    }

    try {
        const raw = window.sessionStorage.getItem(INFER_SESSION_CACHE_PREFIX + key);
        if (!raw) {
            return undefined;
        }
        return JSON.parse(raw) as EntityAdminAreaInferResult;
    } catch {
        return undefined;
    }
}

function isCacheableInferResult(result: EntityAdminAreaInferResult): boolean {
    return result.debugReason !== "query_error";
}

function writeInferSessionCache(key: string, result: EntityAdminAreaInferResult): void {
    if (typeof window === "undefined" || !isCacheableInferResult(result)) {
        return;
    }

    try {
        if (!sessionCacheKeyOrder.includes(key)) {
            sessionCacheKeyOrder.push(key);
            while (sessionCacheKeyOrder.length > INFER_SESSION_CACHE_MAX) {
                const evict = sessionCacheKeyOrder.shift();
                if (evict) {
                    window.sessionStorage.removeItem(INFER_SESSION_CACHE_PREFIX + evict);
                }
            }
        }
        window.sessionStorage.setItem(INFER_SESSION_CACHE_PREFIX + key, JSON.stringify(result));
    } catch {
        // Quota or private mode — memory cache still applies.
    }
}

function rememberCompletedInferResult(key: string, result: EntityAdminAreaInferResult): void {
    if (!isCacheableInferResult(result)) {
        completedInferByKey.delete(key);
        if (typeof window !== "undefined") {
            try {
                window.sessionStorage.removeItem(INFER_SESSION_CACHE_PREFIX + key);
            } catch {
                // ignore
            }
        }
        return;
    }

    completedInferByKey.set(key, result);
    writeInferSessionCache(key, result);
}

export function peekCompletedInferResult(key: string): EntityAdminAreaInferResult | undefined {
    const memory = completedInferByKey.get(key);
    if (memory) {
        if (!isCacheableInferResult(memory)) {
            completedInferByKey.delete(key);
            return undefined;
        }
        return memory;
    }

    const session = readInferSessionCache(key);
    if (session) {
        if (!isCacheableInferResult(session)) {
            if (typeof window !== "undefined") {
                try {
                    window.sessionStorage.removeItem(INFER_SESSION_CACHE_PREFIX + key);
                } catch {
                    // ignore
                }
            }
            return undefined;
        }
        completedInferByKey.set(key, session);
        return session;
    }

    return undefined;
}

export function hasPendingInferDebounce(key: string): boolean {
    return debounceTimerByKey.has(key);
}

export function hasPendingInferFlight(key: string): boolean {
    return pendingInferByKey.has(key);
}

/** Abort debounce, in-flight fetch, and cached result for a key. */
export function abortInferDedupKey(key: string): void {
    const timer = debounceTimerByKey.get(key);
    if (timer !== undefined) {
        clearTimeout(timer);
        debounceTimerByKey.delete(key);
    }

    abortControllerByKey.get(key)?.abort();
    abortControllerByKey.delete(key);
    pendingInferByKey.delete(key);
    completedInferByKey.delete(key);
    if (typeof window !== "undefined") {
        try {
            window.sessionStorage.removeItem(INFER_SESSION_CACHE_PREFIX + key);
        } catch {
            // ignore
        }
    }
    const orderIdx = sessionCacheKeyOrder.indexOf(key);
    if (orderIdx >= 0) {
        sessionCacheKeyOrder.splice(orderIdx, 1);
    }
}

export function abortInferDedupKeysExcept(keepKey: string | null): void {
    for (const key of [...debounceTimerByKey.keys()]) {
        if (key !== keepKey) {
            abortInferDedupKey(key);
        }
    }
    for (const key of [...pendingInferByKey.keys()]) {
        if (key !== keepKey) {
            abortInferDedupKey(key);
        }
    }
    for (const key of [...completedInferByKey.keys()]) {
        if (key !== keepKey) {
            completedInferByKey.delete(key);
        }
    }
}

/**
 * Schedule or join a debounced infer request keyed by stable inputs.
 * Reuses completed results and in-flight promises for the same key.
 */
export function scheduleInferDeduped(
    key: string,
    debounceMs: number,
    run: InferDedupRun,
): Promise<EntityAdminAreaInferResult> {
    const cached = peekCompletedInferResult(key);
    if (cached) {
        return Promise.resolve(cached);
    }

    const pending = pendingInferByKey.get(key);
    if (pending) {
        return pending;
    }

    if (debounceTimerByKey.has(key)) {
        return new Promise((resolve, reject) => {
            const waitForFlight = () => {
                const cachedResult = peekCompletedInferResult(key);
                if (cachedResult) {
                    resolve(cachedResult);
                    return;
                }

                const flight = pendingInferByKey.get(key);
                if (flight) {
                    void flight.then(resolve, reject);
                    return;
                }

                if (!debounceTimerByKey.has(key) && !pendingInferByKey.has(key)) {
                    reject(new Error("Infer debounce cancelled"));
                    return;
                }

                setTimeout(waitForFlight, 25);
            };

            waitForFlight();
        });
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            debounceTimerByKey.delete(key);

            const cachedAfterDebounce = peekCompletedInferResult(key);
            if (cachedAfterDebounce) {
                resolve(cachedAfterDebounce);
                return;
            }

            const existingFlight = pendingInferByKey.get(key);
            if (existingFlight) {
                void existingFlight.then(resolve, reject);
                return;
            }

            const abortController = new AbortController();
            abortControllerByKey.set(key, abortController);

            const flight = run(abortController.signal)
                .then((result) => {
                    rememberCompletedInferResult(key, result);
                    pendingInferByKey.delete(key);
                    abortControllerByKey.delete(key);
                    return result;
                })
                .catch((error: unknown) => {
                    pendingInferByKey.delete(key);
                    abortControllerByKey.delete(key);
                    throw error;
                });

            pendingInferByKey.set(key, flight);
            void flight.then(resolve, reject);
        }, debounceMs);

        debounceTimerByKey.set(key, timer);
    });
}

/** Test-only reset. */
export function resetInferDedupStateForTests(): void {
    for (const key of debounceTimerByKey.keys()) {
        abortInferDedupKey(key);
    }
    completedInferByKey.clear();
    pendingInferByKey.clear();
    debounceTimerByKey.clear();
    abortControllerByKey.clear();
    sessionCacheKeyOrder.length = 0;
    if (typeof window !== "undefined") {
        try {
            for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
                const storageKey = window.sessionStorage.key(i);
                if (storageKey?.startsWith(INFER_SESSION_CACHE_PREFIX)) {
                    window.sessionStorage.removeItem(storageKey);
                }
            }
        } catch {
            // ignore
        }
    }
}
