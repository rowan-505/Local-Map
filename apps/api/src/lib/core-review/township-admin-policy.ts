/**
 * Shared township-default admin_area_id policy for core-review entities.
 * Canonical source — dashboard imports via @local-map/core-review-policy (packages re-export).
 *
 * **Addresses are intentionally excluded.** Address core-review must keep generic
 * `admin_area_id` selection and save validation (any active admin level: ward/village
 * tract, township, district, etc.). Do not wire addresses to township-admin infer,
 * township-only comboboxes, or omitted-update preserve/clear helpers in this module.
 */

/** Admin level stored on township-default core-review entities. */
export const TOWNSHIP_ADMIN_TARGET_LEVEL = "township" as const;

/**
 * Core-review entity slugs that default admin_area_id to township level.
 *
 * Explicitly excludes:
 * - `addresses` — multi-level admin hierarchy for formal/informal Myanmar addresses
 * - water features, bus routes/variants — no admin_area_id on those entities
 */
export const TOWNSHIP_ADMIN_ENTITY_SLUGS = [
    "streets",
    "places",
    "buildings",
    "land-areas",
    "bus-stops",
] as const;

/** Alias matching product naming in specs. */
export const townshipAdminEntities = TOWNSHIP_ADMIN_ENTITY_SLUGS;

export type TownshipAdminEntitySlug = (typeof TOWNSHIP_ADMIN_ENTITY_SLUGS)[number];

export function isTownshipAdminEntity(slug: string): slug is TownshipAdminEntitySlug {
    return (TOWNSHIP_ADMIN_ENTITY_SLUGS as readonly string[]).includes(slug);
}

/** POST /entity-admin-area/infer `kind` for each township-default slug. */
export type TownshipAdminInferKind = "place" | "street" | "building" | "land_area" | "bus_stop";

export function townshipAdminEntityInferKind(slug: TownshipAdminEntitySlug): TownshipAdminInferKind {
    switch (slug) {
        case "streets":
            return "street";
        case "places":
            return "place";
        case "bus-stops":
            return "bus_stop";
        case "buildings":
            return "building";
        case "land-areas":
            return "land_area";
    }
}

export type TownshipAdminGeometryRole = "point" | "line" | "polygon";

export function townshipAdminEntityGeometryRole(slug: TownshipAdminEntitySlug): TownshipAdminGeometryRole {
    switch (slug) {
        case "streets":
            return "line";
        case "places":
        case "bus-stops":
            return "point";
        case "buildings":
        case "land-areas":
            return "polygon";
    }
}
