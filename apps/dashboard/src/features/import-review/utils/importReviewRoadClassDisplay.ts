import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { RoadClassOption } from "@/src/lib/api";

export type ImportReviewRoadClassOptionInput = Pick<RoadClassOption, "id" | "code">;

export type ImportReviewRoadClassLookup = {
    idByCode: Map<string, string>;
    codeById: Map<string, string>;
    labelById: Map<string, string>;
};

export function buildImportReviewRoadClassLookup(
    options: readonly ImportReviewRoadClassOptionInput[]
): ImportReviewRoadClassLookup {
    const idByCode = new Map<string, string>();
    const codeById = new Map<string, string>();
    const labelById = new Map<string, string>();

    for (const option of options) {
        const id = trimString(option.id);
        const code = normalizeRoadClassCodeToken(option.code);
        if (!id) {
            continue;
        }
        if (code) {
            idByCode.set(code.toLowerCase(), id);
            codeById.set(id, code);
            labelById.set(id, code);
        } else {
            labelById.set(id, id);
        }
    }

    return { idByCode, codeById, labelById };
}

/** Normalize list labels like `secondary — Secondary` to bare code when needed. */
export function normalizeRoadClassCodeToken(raw: string | null | undefined): string | null {
    const trimmed = trimString(raw);
    if (!trimmed) {
        return null;
    }
    const beforeDash = trimmed.split("—")[0]?.split(" - ")[0]?.trim();
    return beforeDash && beforeDash.length > 0 ? beforeDash : trimmed;
}

function trimString(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const s = String(value).trim();
    return s.length > 0 ? s : null;
}

function roadClassIdFromRow(row: ImportReviewBuildingListItem): string | null {
    return (
        trimString(row.road_class_id) ??
        trimString(row.road_candidate_road_class_id) ??
        null
    );
}

/**
 * ROAD CLASS list column — reviewed/reference class only; class_code is last-resort fallback.
 */
export function displayImportReviewRoadClassColumn(
    row: ImportReviewBuildingListItem,
    roadClassOptions: readonly ImportReviewRoadClassOptionInput[] = []
): string {
    const record = row as Record<string, unknown>;
    const roadClassId = roadClassIdFromRow(row);
    const lookup =
        roadClassOptions.length > 0 ? buildImportReviewRoadClassLookup(roadClassOptions) : null;
    const fromMap =
        roadClassId && lookup
            ? lookup.labelById.get(roadClassId) ?? lookup.codeById.get(roadClassId) ?? null
            : null;

    const label =
        trimString(row.road_class_label) ??
        trimString(row.road_class_name) ??
        trimString(row.road_class) ??
        trimString(record.road_class) ??
        fromMap ??
        trimString(row.road_candidate_class_label) ??
        trimString(row.class_code) ??
        null;

    return label ?? "—";
}

/** Sync list-row road class fields after a successful road direct-edit save. */
export function enrichImportReviewRoadListRowAfterSave(
    row: ImportReviewBuildingListItem,
    roadClassOptions: readonly ImportReviewRoadClassOptionInput[] = []
): ImportReviewBuildingListItem {
    const roadClassId = roadClassIdFromRow(row);
    const displayLabel = displayImportReviewRoadClassColumn(row, roadClassOptions);
    const roadClassText = trimString(row.road_class);
    const roadClassLabel =
        trimString(row.road_class_label) ?? (displayLabel !== "—" ? displayLabel : null);

    return {
        ...row,
        road_class_id: roadClassId,
        road_candidate_road_class_id: roadClassId,
        road_class: roadClassText ?? roadClassLabel,
        road_class_label: roadClassLabel,
        road_candidate_class_label: roadClassLabel ?? trimString(row.road_candidate_class_label),
    };
}
