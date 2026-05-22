import type { UseFormSetValue } from "react-hook-form";

import type { RefBoundaryStatus } from "@/src/lib/api";
import type { CoreEntityFormValues } from "@/src/lib/core-review/entityConfigs/types";

/** Stable ref.ref_admin_levels.code value — used for UI logic only (submit still uses numeric id). */
export const VILLAGE_ADMIN_LEVEL_CODE = "village";

/** Stable ref.ref_boundary_statuses.code values — lookup keys, not display labels. */
export const SETTLEMENT_EXTENT_BOUNDARY_STATUS_CODE = "settlement_extent";
export const OFFICIAL_BOUNDARY_STATUS_CODE = "official";

export const VILLAGE_BOUNDARY_CAUTION_TITLE = "Village boundary caution";

export function villageBoundaryCautionText(settlementExtentLabel: string): string {
    return `If you do not know the exact official village boundary, use ${settlementExtentLabel} and draw the visible built-up village area. This can be used for search and approximate address locality, but it should not be treated as a legal/admin boundary.`;
}

export const VILLAGE_OFFICIAL_BOUNDARY_WARNING =
    "Only use Official boundary if this polygon comes from a trusted official or surveyed source.";

export type BoundaryDependentDirtyFlags = {
    isOfficialBoundary: boolean;
    boundaryConfidenceScore: boolean;
    addressUsage: boolean;
};

export function defaultBoundaryStatusCodeForAdminLevel(adminLevelCode: string): string {
    const normalized = adminLevelCode.trim().toLowerCase();
    if (!normalized) {
        return OFFICIAL_BOUNDARY_STATUS_CODE;
    }
    return normalized === VILLAGE_ADMIN_LEVEL_CODE
        ? SETTLEMENT_EXTENT_BOUNDARY_STATUS_CODE
        : OFFICIAL_BOUNDARY_STATUS_CODE;
}

export function applyBoundaryStatusRefDefaults(
    row: RefBoundaryStatus,
    setValue: UseFormSetValue<CoreEntityFormValues>,
    dirty: BoundaryDependentDirtyFlags = {
        isOfficialBoundary: false,
        boundaryConfidenceScore: false,
        addressUsage: false,
    },
): void {
    setValue("boundary_status", row.code);
    if (!dirty.isOfficialBoundary) {
        setValue("is_official_boundary", row.default_is_official_boundary);
    }
    if (!dirty.boundaryConfidenceScore) {
        setValue("boundary_confidence_score", row.default_boundary_confidence_score);
    }
    if (!dirty.addressUsage) {
        setValue("address_usage", row.default_address_usage_code ?? OFFICIAL_BOUNDARY_STATUS_CODE);
    }
}

export function applyBoundaryStatusRefDefaultsAll(
    row: RefBoundaryStatus,
    setValue: UseFormSetValue<CoreEntityFormValues>,
): void {
    applyBoundaryStatusRefDefaults(row, setValue);
}
