import { createHash } from "node:crypto";

import type { EntityAdminAreaInferInput, EntityAdminAreaInferResult } from "./entity-admin-area.service.js";

const COORD_ROUND_FACTOR = 1e7;

function roundCoord(value: number): number {
    return Math.round(value * COORD_ROUND_FACTOR) / COORD_ROUND_FACTOR;
}

function stableGeometryHash(input: EntityAdminAreaInferInput): string {
    if (input.lat !== undefined && input.lng !== undefined) {
        return `point:${roundCoord(input.lng)},${roundCoord(input.lat)}`;
    }

    if (!input.geometry) {
        return "none";
    }

    const normalized = JSON.stringify(input.geometry, (_key, value) =>
        typeof value === "number" ? roundCoord(value) : value,
    );
    return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

/** Cache key: kind + entity_public_id + current_admin_area_id + geometry hash. */
export function buildEntityAdminAreaInferCacheKey(input: EntityAdminAreaInferInput): string {
    return [
        input.kind,
        input.entity_public_id?.trim() ?? "",
        input.current_admin_area_id?.trim() ?? "",
        stableGeometryHash(input),
    ].join("|");
}

const inferResultCache = new Map<string, EntityAdminAreaInferResult>();
const INFER_RESULT_CACHE_MAX = 128;

function isCacheableInferResult(result: EntityAdminAreaInferResult): boolean {
    return result.debugReason !== "query_error";
}

export function getCachedEntityAdminAreaInferResult(
    key: string,
): EntityAdminAreaInferResult | undefined {
    const cached = inferResultCache.get(key);
    if (cached && !isCacheableInferResult(cached)) {
        inferResultCache.delete(key);
        return undefined;
    }
    return cached;
}

export function setCachedEntityAdminAreaInferResult(
    key: string,
    result: EntityAdminAreaInferResult,
): void {
    if (!isCacheableInferResult(result)) {
        inferResultCache.delete(key);
        return;
    }
    if (inferResultCache.size >= INFER_RESULT_CACHE_MAX && !inferResultCache.has(key)) {
        const oldest = inferResultCache.keys().next().value;
        if (oldest) {
            inferResultCache.delete(oldest);
        }
    }
    inferResultCache.set(key, result);
}

/** Test-only reset. */
export function resetEntityAdminAreaInferCacheForTests(): void {
    inferResultCache.clear();
}
