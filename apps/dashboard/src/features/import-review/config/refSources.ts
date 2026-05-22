export type RefSource =
    | "ref_building_types"
    | "ref_landuse_classes"
    | "ref_poi_categories"
    | "ref_road_classes"
    | "ref_admin_levels"
    | "core_admin_areas"
    | "ref_source_types";

export type RefDropdownFieldConfig = {
    fieldKey: string;
    refSource: RefSource;
    /** API value field; defaults to id. */
    valueKey?: "id" | "code";
    /** Display field when loading options. */
    labelKey?: "name" | "code" | "label";
    /** Human-readable note for future fetch wiring. */
    notes?: string;
};

export const REF_BUILDING_TYPE_ID: RefDropdownFieldConfig = {
    fieldKey: "building_type_id",
    refSource: "ref_building_types",
    valueKey: "id",
    labelKey: "name",
};

export const REF_LANDUSE_CLASS_ID: RefDropdownFieldConfig = {
    fieldKey: "landuse_class_id",
    refSource: "ref_landuse_classes",
    valueKey: "id",
    labelKey: "name",
    notes: "Uses GET /admin/ref/landuse-classes and import-review form options landuse_classes.",
};

export const REF_POI_CATEGORY_ID: RefDropdownFieldConfig = {
    fieldKey: "poi_category_id",
    refSource: "ref_poi_categories",
    valueKey: "id",
    labelKey: "code",
};

export const REF_ROAD_CLASS_ID: RefDropdownFieldConfig = {
    fieldKey: "road_class_id",
    refSource: "ref_road_classes",
    valueKey: "id",
    labelKey: "code",
};

export const REF_ADMIN_LEVEL_ID: RefDropdownFieldConfig = {
    fieldKey: "admin_level_id",
    refSource: "ref_admin_levels",
    valueKey: "id",
    labelKey: "name",
};

export const REF_ADMIN_AREA_ID: RefDropdownFieldConfig = {
    fieldKey: "admin_area_id",
    refSource: "core_admin_areas",
    valueKey: "id",
    labelKey: "name",
    notes: "Uses GET /admin-areas/options via AdminAreaCombobox in override editor.",
};

export const REF_SOURCE_TYPE_ID: RefDropdownFieldConfig = {
    fieldKey: "source_type_id",
    refSource: "ref_source_types",
    valueKey: "id",
    labelKey: "code",
    notes: "Use when source_type_id appears on candidate overrides.",
};
