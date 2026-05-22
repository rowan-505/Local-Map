export type ImportReviewFormOption = {
    value: string | number;
    label: string;
    code?: string | null;
    name_mm?: string | null;
};

export type ImportReviewAdminAreaFormOption = ImportReviewFormOption & {
    id: string;
    canonical_name: string;
    name_en?: string | null;
    admin_level_id: string;
    parent_id?: string | null;
};

export type ImportReviewFormOptionsResponse = {
    admin_areas: ImportReviewAdminAreaFormOption[];
    admin_levels: ImportReviewFormOption[];
    road_classes: ImportReviewFormOption[];
    poi_categories: ImportReviewFormOption[];
    building_types: ImportReviewFormOption[];
    landuse_classes: ImportReviewFormOption[];
    waterway_classes: ImportReviewFormOption[];
    water_classes: ImportReviewFormOption[];
    barrier_types: ImportReviewFormOption[];
    surface_presets: ImportReviewFormOption[];
};
