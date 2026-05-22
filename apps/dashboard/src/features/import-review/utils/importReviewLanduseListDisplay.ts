import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { dash } from "./entityPageUtils";

/** Bilingual ref label: "Residential — လူနေရပ်ကွက်" */
export function formatLanduseClassLabel(row: ImportReviewBuildingListItem): string {
    const en = row.landuse_class_name?.trim();
    const mm = row.landuse_class_name_mm?.trim();
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

export function formatLanduseImportedClassCode(row: ImportReviewBuildingListItem): string {
    const fromColumn = row.class_code?.trim();
    return fromColumn ?? "";
}

export function formatLanduseClassTableCell(row: ImportReviewBuildingListItem): string {
    return dash(formatLanduseClassLabel(row));
}

export function formatLanduseSourceClassCell(row: ImportReviewBuildingListItem): string {
    return dash(formatLanduseImportedClassCode(row));
}
