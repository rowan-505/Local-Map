import { TOWNSHIP_ADMIN_TARGET_LEVEL } from "../../lib/core-review/township-admin-policy.js";

/** Admin level used as admin_area_id on township-default core-review entities. */
export const ENTITY_ADMIN_AREA_TARGET_LEVEL = TOWNSHIP_ADMIN_TARGET_LEVEL;

/** Roles allowed to save a manual township that does not contain/intersect entity geometry. */
export const ENTITY_ADMIN_AREA_OVERRIDE_ROLES = new Set(["admin"]);

/**
 * Admin levels that must not be stored as admin_area_id on point/line/polygon entities.
 * (Admin area polygons are edited only in the Admin Areas module.)
 */
export const ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES = new Set([
    "country",
    "myanmar",
    "nation",
    "region",
    "state",
    "state_region",
    "division",
    "district",
    "ward",
    "city",
    "village",
    "hamlet",
    "village_tract",
    "quarter",
    "suburb",
    "neighbourhood",
    "neighborhood",
]);

export function canOverrideEntityAdminAreaGeometryMismatch(roles: string[]): boolean {
    return roles.some((role) => ENTITY_ADMIN_AREA_OVERRIDE_ROLES.has(role));
}
