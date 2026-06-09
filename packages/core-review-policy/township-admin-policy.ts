/**
 * Re-export canonical policy from API (single source of truth).
 * Addresses are excluded — they use generic admin-area selection, not township-default.
 */
export {
    TOWNSHIP_ADMIN_TARGET_LEVEL,
    TOWNSHIP_ADMIN_ENTITY_SLUGS,
    townshipAdminEntities,
    isTownshipAdminEntity,
    townshipAdminEntityInferKind,
    townshipAdminEntityGeometryRole,
    type TownshipAdminEntitySlug,
    type TownshipAdminInferKind,
    type TownshipAdminGeometryRole,
} from "../../apps/api/src/lib/core-review/township-admin-policy";
