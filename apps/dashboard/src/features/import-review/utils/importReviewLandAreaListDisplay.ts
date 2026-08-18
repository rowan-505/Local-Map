import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { dash } from "./entityPageUtils";

/** Bilingual ref label: "Residential — လူနေရပ်ကွက်" */
export function formatLandAreaClassLabel(row: ImportReviewBuildingListItem): string {
    const en = row.land_area_class_name?.trim();
    const mm = row.land_area_class_name_mm?.trim();
    if (en && mm) {
        return `${en} — ${mm}`;
    }
    if (en) {
        return en;
    }
    if (mm) {
        return mm;
    }
    return "";
}

export function formatLandAreaImportedClassCode(row: ImportReviewBuildingListItem): string {
    const fromColumn = row.class_code?.trim();
    return fromColumn ?? "";
}

export function formatLandAreaClassTableCell(row: ImportReviewBuildingListItem): string {
    return dash(formatLandAreaClassLabel(row));
}

export function formatLandAreaSourceClassCell(row: ImportReviewBuildingListItem): string {
    return dash(formatLandAreaImportedClassCode(row));
}
