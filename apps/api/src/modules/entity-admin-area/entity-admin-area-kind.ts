import type { EntityAdminAreaKind } from "./entity-admin-area.repo.js";

const ENTITY_ADMIN_AREA_KINDS = new Set<EntityAdminAreaKind>([
    "place",
    "street",
    "building",
    "land_area",
    "bus_stop",
]);

/** Normalize API kind values; `road` is an alias for `street`. */
export function normalizeEntityAdminAreaKind(kind: string): EntityAdminAreaKind | null {
    const normalized = kind === "road" ? "street" : kind;
    if (!ENTITY_ADMIN_AREA_KINDS.has(normalized as EntityAdminAreaKind)) {
        return null;
    }
    return normalized as EntityAdminAreaKind;
}

export function isRoadEntityAdminAreaKind(kind: EntityAdminAreaKind): boolean {
    return kind === "street";
}

/** Entity kinds that use recommend/apply infer UX (no auto-write to form). */
export function isRecommendApplyInferEntityKind(kind: EntityAdminAreaKind): boolean {
    return kind === "street" || kind === "land_area" || kind === "bus_stop";
}
