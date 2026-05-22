import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { normPick } from "./entityPageUtils";

function asOverrideRecord(review_overrides: unknown): Record<string, unknown> {
    if (review_overrides && typeof review_overrides === "object" && !Array.isArray(review_overrides)) {
        return review_overrides as Record<string, unknown>;
    }
    return {};
}

function normTagPick(data: unknown, tagKey: string): string | null {
    const tags = normPick(data, "tags");
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
        const v = (tags as Record<string, unknown>)[tagKey];
        if (v === null || v === undefined) {
            return null;
        }
        const s = String(v).trim();
        return s.length > 0 ? s : null;
    }
    return null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
    for (const v of values) {
        if (v && v.trim()) {
            return v.trim();
        }
    }
    return null;
}

const CLASS_TAG_KEYS: Partial<Record<string, readonly string[]>> = {
    water_lines: ["waterway"],
    water_polygons: ["water", "natural"],
    landuse: ["landuse", "amenity", "natural"],
};

/** Imported class/type from column, normalized_data tags, or root keys (no review_overrides). */
export function deriveImportedClassCode(
    row: ImportReviewBuildingListItem,
    apiFamily: string
): string | null {
    const fromColumn = row.class_code?.trim();
    if (fromColumn) {
        return fromColumn;
    }

    const nd = row.normalized_data;
    const fromNorm = normPick(nd, "class_code");
    if (fromNorm !== null && fromNorm !== undefined) {
        const s = String(fromNorm).trim();
        if (s) {
            return s;
        }
    }

    for (const key of CLASS_TAG_KEYS[apiFamily] ?? []) {
        const fromTag = normTagPick(nd, key);
        if (fromTag) {
            return fromTag;
        }
        const fromRoot = normPick(nd, key);
        if (fromRoot !== null && fromRoot !== undefined) {
            const s = String(fromRoot).trim();
            if (s) {
                return s;
            }
        }
    }

    return null;
}

/** Effective class for override editor + tables (overrides win, then API effective, then imported). */
export function readEffectiveClassCode(row: ImportReviewBuildingListItem, apiFamily: string): string {
    const ov = asOverrideRecord(row.review_overrides);

    if (Object.prototype.hasOwnProperty.call(ov, "class_code")) {
        const v = ov.class_code;
        return v === null || v === undefined ? "" : String(v);
    }
    if (apiFamily === "water_lines" && Object.prototype.hasOwnProperty.call(ov, "waterway_class")) {
        const v = ov.waterway_class;
        return v === null || v === undefined ? "" : String(v);
    }
    if (apiFamily === "water_polygons" && Object.prototype.hasOwnProperty.call(ov, "water_class")) {
        const v = ov.water_class;
        return v === null || v === undefined ? "" : String(v);
    }

    return (
        firstNonEmpty(
            row.effective_class_code ?? null,
            deriveImportedClassCode(row, apiFamily)
        ) ?? ""
    );
}

export function readEffectiveAdminLevelId(row: ImportReviewBuildingListItem): string {
    const ov = asOverrideRecord(row.review_overrides);
    if (Object.prototype.hasOwnProperty.call(ov, "admin_level_id")) {
        const v = ov.admin_level_id;
        return v === null || v === undefined ? "" : String(v);
    }
    const effective = row.effective_admin_level_id;
    if (effective !== null && effective !== undefined && String(effective).trim()) {
        return String(effective);
    }
    const fromNorm = normPick(row.normalized_data, "admin_level_id");
    return fromNorm !== null && fromNorm !== undefined ? String(fromNorm) : "";
}

export function readEffectiveParentAdminAreaId(row: ImportReviewBuildingListItem): string {
    const ov = asOverrideRecord(row.review_overrides);
    if (Object.prototype.hasOwnProperty.call(ov, "parent_id")) {
        const v = ov.parent_id;
        return v === null || v === undefined ? "" : String(v);
    }
    const effective = row.effective_parent_id;
    if (effective !== null && effective !== undefined && String(effective).trim()) {
        return String(effective);
    }
    const fromNorm = normPick(row.normalized_data, "parent_id");
    return fromNorm !== null && fromNorm !== undefined ? String(fromNorm) : "";
}
