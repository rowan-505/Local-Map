import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import {
    deriveImportedNameEn,
    deriveImportedNameMm,
    normPick,
    pickEffectiveNameEn,
    pickEffectiveNameMm,
    reviewerFacingNameOrNull,
    type ImportReviewRoadNameRow,
} from "./importReviewNameFields";

function asOverrideRecord(review_overrides: unknown): Record<string, unknown> {
    if (review_overrides && typeof review_overrides === "object" && !Array.isArray(review_overrides)) {
        return review_overrides as Record<string, unknown>;
    }
    return {};
}

function trimString(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const s = String(value).trim();
    return s.length > 0 ? s : null;
}

function normTagPick(data: unknown, tagKey: string): string | null {
    const tags = normPick(data, "tags");
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
        return trimString((tags as Record<string, unknown>)[tagKey]);
    }
    return null;
}

function boolFromUnknown(value: unknown): boolean | null {
    if (value === true || value === "true" || value === 1 || value === "1") {
        return true;
    }
    if (value === false || value === "false" || value === 0 || value === "0") {
        return false;
    }
    return null;
}

/** Effective Myanmar name for road list cells (overrides → API → imported). */
export function deriveRoadListNameMm(row: ImportReviewRoadNameRow): string | null {
    const ov = asOverrideRecord(row.review_overrides);
    return (
        reviewerFacingNameOrNull(pickEffectiveNameMm(ov, row)) ??
        reviewerFacingNameOrNull(row.name_mm) ??
        reviewerFacingNameOrNull(row.effective_name_mm) ??
        deriveImportedNameMm(row)
    );
}

/** Effective English name for road list cells (overrides → API → imported). */
export function deriveRoadListNameEn(row: ImportReviewRoadNameRow): string | null {
    const ov = asOverrideRecord(row.review_overrides);
    return (
        reviewerFacingNameOrNull(pickEffectiveNameEn(ov, row)) ??
        reviewerFacingNameOrNull(row.name_en) ??
        reviewerFacingNameOrNull(row.effective_name_en) ??
        deriveImportedNameEn(row)
    );
}

/** Effective admin area label for road list cells. */
export function deriveRoadListAdminArea(row: ImportReviewBuildingListItem): string | null {
    const ov = asOverrideRecord(row.review_overrides);
    if (Object.prototype.hasOwnProperty.call(ov, "admin_area_id") && ov.admin_area_id === null) {
        return null;
    }

    return (
        trimString(row.admin_area_name) ??
        trimString(row.effective_admin_area_name) ??
        null
    );
}

/** Effective surface for road list cells. */
export function deriveRoadListSurface(row: ImportReviewBuildingListItem): string | null {
    const ov = asOverrideRecord(row.review_overrides);
    if (Object.prototype.hasOwnProperty.call(ov, "surface")) {
        const fromOverride = ov.surface === null ? null : trimString(ov.surface);
        if (fromOverride) {
            return fromOverride;
        }
    }

    const nd = row.normalized_data;
    return (
        trimString(row.road_candidate_surface) ??
        normTagPick(nd, "surface") ??
        trimString(normPick(nd, "surface"))
    );
}

/** Effective road class label for road list cells. */
export function deriveRoadListRoadClass(
    row: ImportReviewBuildingListItem,
    roadClassLabelById: Map<string, string>,
): string | null {
    const ov = asOverrideRecord(row.review_overrides);
    if (Object.prototype.hasOwnProperty.call(ov, "road_class_id")) {
        const overrideId = ov.road_class_id === null ? null : trimString(ov.road_class_id);
        if (overrideId) {
            return roadClassLabelById.get(overrideId) ?? overrideId;
        }
    }

    const candidateLabel = trimString(row.road_candidate_class_label);
    if (candidateLabel) {
        return candidateLabel;
    }

    const candidateId = trimString(row.road_candidate_road_class_id);
    if (candidateId) {
        return roadClassLabelById.get(candidateId) ?? candidateId;
    }

    const nd = row.normalized_data;
    return (
        trimString(row.class_code) ??
        normTagPick(nd, "highway") ??
        trimString(normPick(nd, "highway")) ??
        trimString(normPick(nd, "road_class"))
    );
}

/** Effective one-way flag for road list cells. */
export function deriveRoadListOneway(row: ImportReviewBuildingListItem): boolean | null {
    const ov = asOverrideRecord(row.review_overrides);
    if (Object.prototype.hasOwnProperty.call(ov, "is_oneway")) {
        return boolFromUnknown(ov.is_oneway);
    }
    if (row.road_candidate_is_oneway !== null && row.road_candidate_is_oneway !== undefined) {
        return row.road_candidate_is_oneway;
    }
    return boolFromUnknown(normPick(row.normalized_data, "is_oneway"));
}

export function formatRoadListOneway(value: boolean | null): string {
    if (value === true) {
        return "yes";
    }
    if (value === false) {
        return "no";
    }
    return "—";
}

/** Length in meters for road list cells. */
export function deriveRoadListLengthM(row: ImportReviewBuildingListItem): string | number | null {
    if (row.length_m !== null && row.length_m !== undefined && Number.isFinite(Number(row.length_m))) {
        return row.length_m;
    }

    const fromNorm = normPick(row.normalized_data, "length_m");
    if (fromNorm === null || fromNorm === undefined) {
        return null;
    }
    if (typeof fromNorm === "number" || typeof fromNorm === "string") {
        return fromNorm;
    }
    return null;
}

/** Map / snap label — external_id only when no reviewer-facing name exists. */
export function deriveRoadDisplayStreetName(row: ImportReviewRoadNameRow): string {
    const nameMm = deriveRoadListNameMm(row) ?? "";
    const nameEn = deriveRoadListNameEn(row) ?? "";
    if (nameMm) {
        return nameMm;
    }
    if (nameEn) {
        return nameEn;
    }
    const externalId = trimString(row.external_id);
    if (externalId) {
        return externalId;
    }
    return String(row.id);
}

/** Drawer title — never treats OSM refs as names; safe when both name_mm and name_en are missing. */
export function deriveRoadDrawerTitle(row: ImportReviewRoadNameRow): string {
    const nameMm = deriveRoadListNameMm(row);
    const nameEn = deriveRoadListNameEn(row);
    if (nameMm && nameEn) {
        return `${nameMm} / ${nameEn}`;
    }
    if (nameMm) {
        return nameMm;
    }
    if (nameEn) {
        return nameEn;
    }
    return `Road candidate ${row.id}`;
}
