import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";

/**
 * Shared lightweight list SELECT contract — every family list query includes these
 * logical fields (SQL may alias/pad with NULLs for uniform BuildingListRowDb shape).
 */
export type ImportReviewLightweightListContract = {
    /** Primary key column on the candidate table (always `id`). */
    idColumn: "id";
    /** Human-readable label: `canonical_name` plus optional shaped `name` column. */
    displayNameColumns: readonly ("canonical_name" | "name")[];
    /** Family type/class filter column when present. */
    typeClassColumn: "class_code";
    statusColumns: readonly [
        "match_status",
        "auto_action",
        "review_status",
        "review_decision",
        "promotion_status",
    ];
    confidenceColumn: "confidence_score";
    timestamps: readonly ["created_at", "updated_at"];
    /** Primary geometry column used for `has_geometry` only — never ST_AsGeoJSON in list. */
    geometryPresenceColumn: string | undefined;
};

export function lightweightListContractForFamily(
    config: ImportReviewEntityFamilyConfig
): ImportReviewLightweightListContract {
    const displayNameColumns: ("canonical_name" | "name")[] = ["canonical_name"];
    if (config.listRowShape.name !== null) {
        displayNameColumns.push("name");
    }

    return {
        idColumn: "id",
        displayNameColumns,
        typeClassColumn: "class_code",
        statusColumns: [
            "match_status",
            "auto_action",
            "review_status",
            "review_decision",
            "promotion_status",
        ],
        confidenceColumn: "confidence_score",
        timestamps: ["created_at", "updated_at"],
        geometryPresenceColumn: config.geometryColumns.primary,
    };
}

/** Default list mode for all families unless explicitly set to `full`. */
export function useLightweightImportReviewList(
    config: ImportReviewEntityFamilyConfig,
    includeGeometry: boolean
): boolean {
    return !includeGeometry && (config.listSelectMode ?? "summary") === "summary";
}
