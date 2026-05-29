import { apiFetch, isAbortError } from "@/src/lib/api";

import { resolveImportTransportApiFamily } from "../utils/importTransportApiFamily";
import type {
    ImportTransportBatchesListParams,
    ImportTransportBatchesListResponse,
    ImportTransportBatchValidationResponse,
    ImportTransportCreatePromotionBatchResponse,
    ImportTransportDetailItem,
    ImportTransportListResponse,
    ImportTransportPromotionBatchDetail,
    ImportTransportPromotionBatchLogsResponse,
    ImportTransportPromotionBatchProgress,
    ImportTransportPromotionBatchPromoteResult,
    ImportTransportPromotionBatchValidationResult,
    ImportTransportPromotionReadyResponse,
    ImportTransportHistoryImportBatchDetail,
    ImportTransportHistoryImportBatchListItem,
    ImportTransportHistoryImportBatchesListParams,
    ImportTransportHistoryListResponse,
    ImportTransportHistoryPromotionBatchDetail,
    ImportTransportHistoryPromotionBatchItem,
    ImportTransportHistoryPromotionBatchItemsParams,
    ImportTransportHistoryPromotionBatchLogsResponse,
    ImportTransportHistoryPromotionBatchListItem,
    ImportTransportHistoryPromotionBatchesListParams,
    ImportTransportGtfsCreateExportResponse,
    ImportTransportGtfsExportDetail,
    ImportTransportGtfsExportListItem,
    ImportTransportGtfsListResponse,
    ImportTransportGtfsOtpBuildListItem,
    ImportTransportScopeQuery,
    ImportTransportSummaryResponse,
    ImportTransportValidateCandidateResponse,
    ImportTransportValidationIssuesResponse,
} from "../config/types";

export type ImportTransportFetchInit = Pick<RequestInit, "signal">;

export type ImportTransportListParams = ImportTransportScopeQuery & {
    limit?: number;
    offset?: number;
    sort?: string;
    q?: string;
    review_status?: string;
    review_decision?: string;
    promotion_status?: string;
    validation_status?: string;
    mode_type?: string;
    include_promoted?: boolean;
    include_total?: boolean;
    include_geometry?: boolean;
};

export type ImportTransportFilterOptionsResponse = {
    review_statuses: string[];
    review_decisions: string[];
    promotion_statuses: string[];
    validation_statuses: string[];
};

const API_PREFIX = "/api/import-transport";

function familyPath(apiFamily: string): string {
    return resolveImportTransportApiFamily(apiFamily);
}

export function getImportTransportSummary(
    params: ImportTransportScopeQuery,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportSummaryResponse> {
    return apiFetch<ImportTransportSummaryResponse>(
        `${API_PREFIX}/summary`,
        { signal: fetchInit?.signal },
        params
    );
}

export function getImportTransportBatches(
    params: ImportTransportBatchesListParams = {},
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportBatchesListResponse> {
    return apiFetch<ImportTransportBatchesListResponse>(
        `${API_PREFIX}/batches`,
        { signal: fetchInit?.signal },
        params
    );
}

export function getImportTransportCandidates(
    apiFamily: string,
    params: ImportTransportListParams,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportListResponse> {
    return apiFetch<ImportTransportListResponse>(
        `${API_PREFIX}/${familyPath(apiFamily)}`,
        { signal: fetchInit?.signal },
        params
    );
}

export function getImportTransportCandidateDetail(
    apiFamily: string,
    id: string,
    params: ImportTransportScopeQuery & { include_geometry?: boolean },
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportDetailItem> {
    return apiFetch<ImportTransportDetailItem>(
        `${API_PREFIX}/${familyPath(apiFamily)}/${encodeURIComponent(id)}`,
        { signal: fetchInit?.signal },
        params
    );
}

export function getImportTransportFilterOptions(
    apiFamily: string,
    params: ImportTransportScopeQuery,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportFilterOptionsResponse> {
    return apiFetch<ImportTransportFilterOptionsResponse>(
        `${API_PREFIX}/${familyPath(apiFamily)}/filter-options`,
        { signal: fetchInit?.signal },
        params
    );
}

export function getImportTransportOptions(fetchInit?: ImportTransportFetchInit) {
    return apiFetch<ImportTransportOptionsResponse>(`${API_PREFIX}/options`, {
        signal: fetchInit?.signal,
    });
}

export type ImportTransportOptionsResponse = {
    families: string[];
    mode_types: string[];
    sort_options: Array<{ value: string; label: string }>;
    review_statuses: string[];
    review_decisions: string[];
    promotion_statuses: string[];
    validation_statuses: string[];
};

export function getImportTransportValidationIssues(
    params: ImportTransportScopeQuery & {
        entity_kind?: string;
        entity_id?: string | number;
        severity?: string;
        limit?: number;
        offset?: number;
    },
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportValidationIssuesResponse> {
    return apiFetch<ImportTransportValidationIssuesResponse>(
        `${API_PREFIX}/validation/issues`,
        { signal: fetchInit?.signal },
        params
    );
}

export function postImportTransportValidateCandidate(
    apiFamily: string,
    id: string,
    scope: ImportTransportScopeQuery,
    body: { confirm_warnings?: boolean; review_note?: string } = {},
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportValidateCandidateResponse> {
    return apiFetch<ImportTransportValidateCandidateResponse>(
        `${API_PREFIX}/${familyPath(apiFamily)}/${encodeURIComponent(id)}/validate`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: fetchInit?.signal,
        },
        scope
    );
}

export function postImportTransportBatchValidation(
    body: ImportTransportScopeQuery & {
        families?: string[];
        confirm_warnings?: boolean;
        review_note?: string;
    },
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportBatchValidationResponse> {
    return apiFetch<ImportTransportBatchValidationResponse>(`${API_PREFIX}/validation/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: fetchInit?.signal,
    });
}

export function getImportTransportPromotionReady(
    params: { import_batch_id: string | number; include_warnings?: boolean },
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportPromotionReadyResponse> {
    return apiFetch<ImportTransportPromotionReadyResponse>(
        `${API_PREFIX}/promotion/ready`,
        { signal: fetchInit?.signal },
        params
    );
}

export function postImportTransportPromotionBatch(
    body: {
        import_batch_id: number;
        mode: "one_entity" | "all_entities";
        entity_family?: string | null;
        include_warnings?: boolean;
    },
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportCreatePromotionBatchResponse> {
    return apiFetch<ImportTransportCreatePromotionBatchResponse>(`${API_PREFIX}/promotion/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: fetchInit?.signal,
    });
}

export function getImportTransportPromotionBatches(
    params: { import_batch_id?: string | number; limit?: number; offset?: number } = {},
    fetchInit?: ImportTransportFetchInit
) {
    return apiFetch<{
        items: ImportTransportPromotionBatchDetail[];
        total: number;
        limit: number;
        offset: number;
    }>(`${API_PREFIX}/promotion/batches`, { signal: fetchInit?.signal }, params);
}

export function getImportTransportPromotionBatchById(
    id: string,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportPromotionBatchDetail> {
    return apiFetch<ImportTransportPromotionBatchDetail>(
        `${API_PREFIX}/promotion/batches/${encodeURIComponent(id)}`,
        { signal: fetchInit?.signal }
    );
}

export function postImportTransportPromotionBatchValidate(
    id: string,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportPromotionBatchValidationResult> {
    return apiFetch<ImportTransportPromotionBatchValidationResult>(
        `${API_PREFIX}/promotion/batches/${encodeURIComponent(id)}/validate`,
        {
            method: "POST",
            signal: fetchInit?.signal,
        }
    );
}

export function getImportTransportPromotionBatchProgress(
    id: string,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportPromotionBatchProgress> {
    return apiFetch<ImportTransportPromotionBatchProgress>(
        `${API_PREFIX}/promotion/batches/${encodeURIComponent(id)}/progress`,
        { signal: fetchInit?.signal }
    );
}

export function getImportTransportPromotionBatchLogs(
    id: string,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportPromotionBatchLogsResponse> {
    return apiFetch<ImportTransportPromotionBatchLogsResponse>(
        `${API_PREFIX}/promotion/batches/${encodeURIComponent(id)}/logs`,
        { signal: fetchInit?.signal }
    );
}

export function postImportTransportPromotionBatchPromote(
    id: string,
    body: { confirm_warnings?: boolean; review_note?: string | null },
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportPromotionBatchPromoteResult> {
    return apiFetch<ImportTransportPromotionBatchPromoteResult>(
        `${API_PREFIX}/promotion/batches/${encodeURIComponent(id)}/promote`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: fetchInit?.signal,
        }
    );
}

export function getImportTransportHistoryImportBatches(
    params: ImportTransportHistoryImportBatchesListParams = {},
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportHistoryListResponse<ImportTransportHistoryImportBatchListItem>> {
    return apiFetch<ImportTransportHistoryListResponse<ImportTransportHistoryImportBatchListItem>>(
        `${API_PREFIX}/history/import-batches`,
        { signal: fetchInit?.signal },
        params
    );
}

export function getImportTransportHistoryImportBatchById(
    id: string,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportHistoryImportBatchDetail> {
    return apiFetch<ImportTransportHistoryImportBatchDetail>(
        `${API_PREFIX}/history/import-batches/${encodeURIComponent(id)}`,
        { signal: fetchInit?.signal }
    );
}

export function getImportTransportHistoryPromotionBatches(
    params: ImportTransportHistoryPromotionBatchesListParams = {},
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportHistoryListResponse<ImportTransportHistoryPromotionBatchListItem>> {
    return apiFetch<ImportTransportHistoryListResponse<ImportTransportHistoryPromotionBatchListItem>>(
        `${API_PREFIX}/history/promotion-batches`,
        { signal: fetchInit?.signal },
        params
    );
}

export function getImportTransportHistoryPromotionBatchById(
    id: string,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportHistoryPromotionBatchDetail> {
    return apiFetch<ImportTransportHistoryPromotionBatchDetail>(
        `${API_PREFIX}/history/promotion-batches/${encodeURIComponent(id)}`,
        { signal: fetchInit?.signal }
    );
}

export function getImportTransportHistoryPromotionBatchItems(
    id: string,
    params: ImportTransportHistoryPromotionBatchItemsParams = {},
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportHistoryListResponse<ImportTransportHistoryPromotionBatchItem>> {
    return apiFetch<ImportTransportHistoryListResponse<ImportTransportHistoryPromotionBatchItem>>(
        `${API_PREFIX}/history/promotion-batches/${encodeURIComponent(id)}/items`,
        { signal: fetchInit?.signal },
        params
    );
}

export function getImportTransportHistoryPromotionBatchLogs(
    id: string,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportHistoryPromotionBatchLogsResponse> {
    return apiFetch<ImportTransportHistoryPromotionBatchLogsResponse>(
        `${API_PREFIX}/history/promotion-batches/${encodeURIComponent(id)}/logs`,
        { signal: fetchInit?.signal }
    );
}

export function getImportTransportGtfsExports(
    params: { scope?: string; status?: string; limit?: number; offset?: number } = {},
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportGtfsListResponse<ImportTransportGtfsExportListItem>> {
    return apiFetch<ImportTransportGtfsListResponse<ImportTransportGtfsExportListItem>>(
        `${API_PREFIX}/gtfs/exports`,
        { signal: fetchInit?.signal },
        params
    );
}

export function postImportTransportGtfsExportDryRun(
    body: { scope?: string; dry_run?: boolean } = {},
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportGtfsCreateExportResponse> {
    return apiFetch<ImportTransportGtfsCreateExportResponse>(`${API_PREFIX}/gtfs/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: body.scope ?? "yangon_local_bus", dry_run: body.dry_run ?? true }),
        signal: fetchInit?.signal,
    });
}

export function getImportTransportGtfsExportById(
    id: string,
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportGtfsExportDetail> {
    return apiFetch<ImportTransportGtfsExportDetail>(
        `${API_PREFIX}/gtfs/exports/${encodeURIComponent(id)}`,
        { signal: fetchInit?.signal }
    );
}

export function getImportTransportGtfsOtpBuilds(
    params: {
        export_build_id?: number | string;
        scope?: string;
        build_status?: string;
        limit?: number;
        offset?: number;
    } = {},
    fetchInit?: ImportTransportFetchInit
): Promise<ImportTransportGtfsListResponse<ImportTransportGtfsOtpBuildListItem>> {
    return apiFetch<ImportTransportGtfsListResponse<ImportTransportGtfsOtpBuildListItem>>(
        `${API_PREFIX}/gtfs/otp-builds`,
        { signal: fetchInit?.signal },
        params
    );
}

export { isAbortError };
