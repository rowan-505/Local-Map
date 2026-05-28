/**
 * Post-061: assignable building types are flat rows in ref.ref_building_types
 * (parent_id IS NULL, is_active IS TRUE).
 */
export const ACTIVE_FLAT_BUILDING_TYPE_SQL = `is_active IS TRUE AND parent_id IS NULL`;

export const BUILDING_TYPE_ID_VALIDATION_MESSAGE =
    "Not found, inactive, deleted, or not a flat active building type.";
