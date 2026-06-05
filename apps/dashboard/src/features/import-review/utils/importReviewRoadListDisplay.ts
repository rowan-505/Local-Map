import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { reviewerFacingNameOrNull, type ImportReviewRoadNameRow } from "./importReviewNameFields";
import { getImportReviewDisplayName } from "./importReviewNaming";
import {
    displayImportReviewRoadClassColumn,
    type ImportReviewRoadClassOptionInput,
} from "./importReviewRoadClassDisplay";

function typedColumnFields(fields: unknown): Record<string, unknown> {
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
        return fields as Record<string, unknown>;
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

function boolFromUnknown(value: unknown): boolean | null {
    if (value === true || value === "true" || value === 1 || value === "1") {
        return true;
    }
    if (value === false || value === "false" || value === 0 || value === "0") {
        return false;
    }
    return null;
}

/** Typed Myanmar name for road list cells (direct-edit column only). */
export function deriveRoadListNameMm(row: ImportReviewRoadNameRow): string | null {
    return reviewerFacingNameOrNull(row.name_mm);
}

/** Typed English name for road list cells (direct-edit column only). */
export function deriveRoadListNameEn(row: ImportReviewRoadNameRow): string | null {
    return reviewerFacingNameOrNull(row.name_en);
}

/** Effective admin area label for road list cells. */
export function deriveRoadListAdminArea(row: ImportReviewBuildingListItem): string | null {
    const ov = typedColumnFields(row);
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
    const ov = typedColumnFields(row);
    if (Object.prototype.hasOwnProperty.call(ov, "surface")) {
        const fromOverride = ov.surface === null ? null : trimString(ov.surface);
        if (fromOverride) {
            return fromOverride;
        }
    }

    return trimString(row.road_candidate_surface);
}

/** Effective road class label for road list cells (shared resolver with edit drawer). */
export function deriveRoadListRoadClass(
    row: ImportReviewBuildingListItem,
    roadClassOptions: readonly ImportReviewRoadClassOptionInput[],
): string | null {
    const label = displayImportReviewRoadClassColumn(row, roadClassOptions);
    return label === "—" ? null : label;
}

/** Effective one-way flag for road list cells. */
export function deriveRoadListOneway(row: ImportReviewBuildingListItem): boolean | null {
    const ov = typedColumnFields(row);
    if (Object.prototype.hasOwnProperty.call(ov, "is_oneway")) {
        return boolFromUnknown(ov.is_oneway);
    }
    if (row.road_candidate_is_oneway !== null && row.road_candidate_is_oneway !== undefined) {
        return row.road_candidate_is_oneway;
    }
    return null;
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

/** Drawer title — typed names first, then legacy/source fallbacks. */
export function deriveRoadDrawerTitle(row: ImportReviewRoadNameRow): string {
    return getImportReviewDisplayName(row as ImportReviewBuildingListItem, { label: "Road" });
}
