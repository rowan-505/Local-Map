export type StopMergeFieldSource = "current" | "candidate";

export type StopMergeFieldKey =
    | "name"
    | "name_mm"
    | "name_en"
    | "stop_type"
    | "geom"
    | "admin_area_id"
    | "confidence_score"
    | "review_status"
    | "is_active";

export const STOP_MERGE_COMPARABLE_FIELD_KEYS: readonly StopMergeFieldKey[] = [
    "name",
    "name_mm",
    "name_en",
    "stop_type",
    "geom",
    "admin_area_id",
    "confidence_score",
    "review_status",
    "is_active",
];

export type StopMergeFieldSources = Partial<Record<StopMergeFieldKey, StopMergeFieldSource>>;

export type StopMergeFieldStopSnapshot = {
    readonly name: string;
    readonly name_mm: string | null;
    readonly name_en: string | null;
    readonly stop_type: string;
    readonly admin_area_id: number | null;
    readonly confidence_score: number | null;
    readonly review_status: string;
    readonly is_active: boolean;
    readonly longitude: number | null;
    readonly latitude: number | null;
};

export function resolveMergeFieldValue(
    field: StopMergeFieldKey,
    source: StopMergeFieldSource,
    current: StopMergeFieldStopSnapshot,
    candidate: StopMergeFieldStopSnapshot,
): string | number | boolean | null | { readonly longitude: number; readonly latitude: number } {
    const row = source === "current" ? current : candidate;
    switch (field) {
        case "name":
            return row.name;
        case "name_mm":
            return row.name_mm;
        case "name_en":
            return row.name_en;
        case "stop_type":
            return row.stop_type;
        case "admin_area_id":
            return row.admin_area_id;
        case "confidence_score":
            return row.confidence_score;
        case "review_status":
            return row.review_status;
        case "is_active":
            return row.is_active;
        case "geom":
            if (row.longitude === null || row.latitude === null) {
                return null;
            }
            return { longitude: row.longitude, latitude: row.latitude };
    }
}
