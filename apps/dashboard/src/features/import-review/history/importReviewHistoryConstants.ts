/** Default page size for history tables. */
export const IMPORT_REVIEW_HISTORY_PAGE_SIZE = 50;

export const IMPORT_REVIEW_HISTORY_REVIEW_STATUSES = [
    "",
    "uploaded",
    "reviewing",
    "review_completed",
    "needs_attention",
    "archived",
] as const;

export const IMPORT_REVIEW_HISTORY_PUBLISH_STATUSES = [
    "",
    "draft",
    "validating",
    "ready",
    "partial",
    "blocked",
    "promoting",
    "promoted",
    "partially_promoted",
    "failed",
    "cancelled",
] as const;

/** Entity families shown in history filters (promotion-capable import-review families). */
export const IMPORT_REVIEW_HISTORY_ENTITY_FAMILIES = [
    "",
    "buildings",
    "places",
    "roads",
    "landuse",
    "water_lines",
    "water_polygons",
    "admin_areas",
    "routing_barriers",
    "addresses",
] as const;
