import type { RefSource } from "@/src/features/import-review/config/refSources";
import { resolveImportReviewApiFamily } from "@/src/features/import-review/utils/importReviewApiFamily";
import {
    getImportReviewReferenceOptions,
    getImportReviewFormOptions,
    patchImportReviewFamilyOverrides,
    getImportReviewBuildings,
    getImportReviewBuildingsFilterOptions,
    postImportReviewFamilyBulkDecision,
    getImportReviewFamilyCandidateById,
    getImportReviewFamilyCandidates,
    getImportReviewFamilyFilterOptions,
    getImportReviewSummary,
    getRoadClasses,
    patchImportReviewBuildingDecision,
    patchImportReviewBuildingOverrides,
    patchImportReviewFamilyDecision,
    patchImportReviewPlaceDecision,
    patchImportReviewRoadDecision,
    patchImportReviewRoadOverrides,
    postImportReviewBuildingsBulkDecision,
    postImportReviewPlacesBulkDecision,
    postImportReviewRoadsBulkDecision,
    type ImportReviewBuildingsFilterOptionsResponse,
    type ImportReviewBuildingsListParams,
    type ImportReviewBuildingsListResponse,
    type ImportReviewBulkDecisionResponse,
    type ImportReviewBuildingListItem,
    type ImportReviewEnvelopeQuery,
    type ImportReviewFamilyFilterOptionsResponse,
    type ImportReviewFamilyListParams,
    type ImportReviewSummaryResponse,
    type PatchImportReviewBuildingDecisionBody,
    type PatchImportReviewBuildingOverridesBody,
    type PatchImportReviewRoadOverridesBody,
    type PostImportReviewBuildingsBulkBody,
} from "@/src/lib/api";

export type ImportReviewFetchInit = Pick<RequestInit, "signal">;

export type ImportReviewReferenceOption = {
    id: string;
    label: string;
    code?: string;
};

import type { ImportReviewFormOptionsResponse, ImportReviewReferenceOptionsResponse } from "@/src/lib/api";

export type ImportReviewReferenceOptionDto = ImportReviewReferenceOptionsResponse["ref_poi_categories"][number];

export type ImportReviewReferenceOptionsBundle = ImportReviewReferenceOptionsResponse;
export type ImportReviewFormOptionsBundle = ImportReviewFormOptionsResponse;

export type GetImportReviewReferenceOptionsParams = {
    refSource: RefSource;
};

function isBuildingsFamily(apiFamily: string): boolean {
    return normalizeApiFamily(apiFamily) === "buildings";
}

function isPlacesFamily(apiFamily: string): boolean {
    return normalizeApiFamily(apiFamily) === "places";
}

function isRoadsFamily(apiFamily: string): boolean {
    return resolveImportReviewApiFamily(apiFamily).trim().toLowerCase() === "roads";
}

function normalizeApiFamily(apiFamily: string): string {
    return resolveImportReviewApiFamily(apiFamily);
}

export function getImportReviewSummaryClient(
    params: ImportReviewEnvelopeQuery,
    fetchInit?: ImportReviewFetchInit
): Promise<ImportReviewSummaryResponse> {
    return getImportReviewSummary(params, fetchInit);
}

export function getEntityCandidates(
    apiFamily: string,
    params: ImportReviewFamilyListParams,
    fetchInit?: ImportReviewFetchInit
): Promise<ImportReviewBuildingsListResponse> {
    const { include_geometry = false, ...rest } = params;
    if (isBuildingsFamily(apiFamily)) {
        return getImportReviewBuildings(
            { ...rest, include_geometry } as ImportReviewBuildingsListParams,
            fetchInit
        );
    }
    return getImportReviewFamilyCandidates(normalizeApiFamily(apiFamily), { ...rest, include_geometry }, fetchInit);
}

export function getEntityFilterOptions(
    apiFamily: string,
    params: ImportReviewEnvelopeQuery,
    fetchInit?: ImportReviewFetchInit
): Promise<
    ImportReviewBuildingsFilterOptionsResponse | ImportReviewFamilyFilterOptionsResponse
> {
    if (isBuildingsFamily(apiFamily)) {
        return getImportReviewBuildingsFilterOptions(params, fetchInit);
    }
    return getImportReviewFamilyFilterOptions(normalizeApiFamily(apiFamily), params, fetchInit);
}

export function getEntityCandidateDetail(
    apiFamily: string,
    id: string,
    params: ImportReviewEnvelopeQuery & { include_geometry?: boolean },
    fetchInit?: ImportReviewFetchInit
): Promise<ImportReviewBuildingListItem> {
    const { include_geometry = true, ...scope } = params;
    const family = normalizeApiFamily(apiFamily);
    return getImportReviewFamilyCandidateById(
        isBuildingsFamily(family) ? "buildings" : family,
        id,
        { ...scope, include_geometry },
        fetchInit
    );
}

export function patchEntityDecision(
    apiFamily: string,
    id: string,
    body: PatchImportReviewBuildingDecisionBody
): Promise<ImportReviewBuildingListItem> {
    if (isBuildingsFamily(apiFamily)) {
        return patchImportReviewBuildingDecision(id, body);
    }
    if (isPlacesFamily(apiFamily)) {
        return patchImportReviewPlaceDecision(id, body);
    }
    if (isRoadsFamily(apiFamily)) {
        return patchImportReviewRoadDecision(id, body);
    }
    return patchImportReviewFamilyDecision(normalizeApiFamily(apiFamily), id, body);
}

export function patchEntityOverrides(
    apiFamily: string,
    id: string,
    body: PatchImportReviewBuildingOverridesBody | PatchImportReviewRoadOverridesBody
): Promise<ImportReviewBuildingListItem> {
    if (isBuildingsFamily(apiFamily)) {
        return patchImportReviewBuildingOverrides(id, body as PatchImportReviewBuildingOverridesBody);
    }
    if (isRoadsFamily(apiFamily)) {
        return patchImportReviewRoadOverrides(id, body as PatchImportReviewRoadOverridesBody);
    }
    return patchImportReviewFamilyOverrides(normalizeApiFamily(apiFamily), id, body as PatchImportReviewBuildingOverridesBody);
}

export function getImportReviewReferenceOptionsBundle(fetchInit?: ImportReviewFetchInit) {
    return getImportReviewReferenceOptions(fetchInit);
}

export function getImportReviewFormOptionsBundle(fetchInit?: ImportReviewFetchInit) {
    return getImportReviewFormOptions(fetchInit);
}

export function bulkDecision(
    apiFamily: string,
    body: PostImportReviewBuildingsBulkBody
): Promise<ImportReviewBulkDecisionResponse> {
    if (isBuildingsFamily(apiFamily)) {
        return postImportReviewBuildingsBulkDecision(body);
    }
    if (isPlacesFamily(apiFamily)) {
        return postImportReviewPlacesBulkDecision(body);
    }
    if (isRoadsFamily(apiFamily)) {
        return postImportReviewRoadsBulkDecision(body);
    }
    return postImportReviewFamilyBulkDecision(normalizeApiFamily(apiFamily), body);
}

export async function getReferenceOptions(
    params: GetImportReviewReferenceOptionsParams,
    fetchInit?: ImportReviewFetchInit
): Promise<ImportReviewReferenceOption[]> {
    if (params.refSource === "ref_landuse_classes") {
        const formOptions = await getImportReviewFormOptions(fetchInit);
        return formOptions.landuse_classes.map((r) => ({
            id: String(r.value),
            label: r.label,
            code: r.code ?? undefined,
        }));
    }
    const bundle = await getImportReviewReferenceOptionsBundle(fetchInit);
    const rows = bundle[params.refSource as keyof ImportReviewReferenceOptionsResponse] ?? [];
    return rows.map((r: ImportReviewReferenceOptionDto) => ({
        id: r.id,
        label: r.code?.trim() || r.name?.trim() || r.id,
        code: r.code ?? undefined,
    }));
}
