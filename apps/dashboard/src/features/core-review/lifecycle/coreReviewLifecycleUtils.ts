import type { CoreReviewEntitySlug } from "@/src/lib/api";

export type CoreReviewLifecycleStatusFilter = "active" | "deleted" | "all";

export const CORE_REVIEW_ENTITY_LABELS: Record<CoreReviewEntitySlug, string> = {
    buildings: "building",
    places: "place",
    streets: "road",
    "bus-stops": "bus stop",
    "bus-routes": "bus route",
    "bus-route-variants": "bus route variant",
    landuse: "landuse area",
    "water-lines": "water line",
    "water-polygons": "water polygon",
    addresses: "address",
    "admin-areas": "admin area",
};

export function coreReviewEntityLabel(slug: CoreReviewEntitySlug): string {
    return CORE_REVIEW_ENTITY_LABELS[slug] ?? slug;
}

export function parseCoreReviewStatusFilter(
    status: string | null,
    includeDeleted: boolean
): CoreReviewLifecycleStatusFilter {
    if (status === "active" || status === "deleted" || status === "all") {
        return status;
    }
    if (includeDeleted) {
        return "all";
    }
    return "active";
}

/** Whether a list/detail row should be treated as deleted for UI actions. */
export function isCoreReviewRowDeleted(row: Record<string, unknown>): boolean {
    const deletedAt = row.deletedAt ?? row.deleted_at;
    if (deletedAt != null && deletedAt !== "") {
        return true;
    }
    if (row.isActive === false || row.is_active === false) {
        return true;
    }
    return false;
}

export function coreReviewRowLifecycleAction(
    row: Record<string, unknown>,
    listStatus: CoreReviewLifecycleStatusFilter
): "soft-delete" | "restore" | null {
    const deleted = isCoreReviewRowDeleted(row);
    if (listStatus === "active") {
        return deleted ? null : "soft-delete";
    }
    if (listStatus === "deleted") {
        return deleted ? "restore" : null;
    }
    return deleted ? "restore" : "soft-delete";
}
