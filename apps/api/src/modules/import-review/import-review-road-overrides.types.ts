/** GeoJSON-ish object after Zod/coercion (routing checks use PostGIS, not TS geometry types). */
export type ImportReviewRoadGeomJson = Record<string, unknown>;

/** Normalized PATCH keys for `/api/import-review/roads/:id/overrides`. */
export type ImportReviewRoadOverridesPatchNormalized = {
    canonical_name?: string | null | undefined;
    road_class_id?: bigint | null | undefined;
    /** Resolved from `road_class_code` before validation (not stored verbatim in overrides JSON unless also sent as id). */
    road_class_code?: string | null | undefined;
    is_oneway?: boolean | null | undefined;
    surface?: string | null | undefined;
    /** GeoJSON object (LineString or MultiLineString), not raw string. */
    geom?: ImportReviewRoadGeomJson | null | undefined;
};

export type ImportReviewMergedRoadEffectiveState = {
    canonical_name: string | null;
    road_class_id: bigint | null;
    /** Best-effort ref label (usually `ref_road_classes.code`). */
    road_class_label: string | null;
    is_oneway: boolean | null;
    surface: string | null;
    /** GeoJSON geometry for routing checks — after PostGIS normalization this mirrors stored shape. */
    geom_geojson: ImportReviewRoadGeomJson | null;
};

export type ImportReviewRoadOverrideValidationOutcome = {
    errors: string[];
    warnings: string[];
    normalizedPatchForJson: Record<string, unknown>;
    mergedOverridesJson: Record<string, unknown>;
    effectiveState: ImportReviewMergedRoadEffectiveState;
};
