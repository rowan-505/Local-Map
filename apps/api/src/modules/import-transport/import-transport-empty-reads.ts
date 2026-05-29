import { IMPORT_TRANSPORT_FAMILIES, type ImportTransportFamily } from "./import-transport.config.js";
import type {
    ImportTransportCandidatesListResponse,
    ImportTransportScopeQuery,
    ImportTransportScopeSelectedBy,
    ImportTransportSummaryResponse,
} from "./import-transport.types.js";
import type { ImportTransportPromotionReadyResponse } from "./import-transport-promotion.types.js";

function selectedByForQuery(query: ImportTransportScopeQuery): ImportTransportScopeSelectedBy {
    return query.import_batch_id != null ? "import_batch_id" : "source_snapshot_version_latest";
}

export function emptyImportTransportSummary(
    query: ImportTransportScopeQuery
): ImportTransportSummaryResponse {
    return {
        import_batch_id: query.import_batch_id?.toString() ?? "0",
        source_snapshot_version: query.source_snapshot_version ?? null,
        selected_by: selectedByForQuery(query),
        batch_name: "",
        import_status: "",
        validation_status: "",
        families: IMPORT_TRANSPORT_FAMILIES.map((entity_family) => ({
            entity_family,
            total: 0,
            pending: 0,
            approved: 0,
            promoted: 0,
        })),
        validation: { blocked_count: 0, warning_count: 0 },
        rollup: {
            total_candidates: 0,
            pending: 0,
            ready_for_promotion: 0,
            promoted: 0,
        },
    };
}

export function emptyImportTransportCandidatesList(
    query: ImportTransportScopeQuery
): ImportTransportCandidatesListResponse {
    return {
        items: [],
        total: 0,
        has_more: false,
        import_batch_id: query.import_batch_id?.toString() ?? "0",
        source_snapshot_version: query.source_snapshot_version ?? null,
        selected_by: selectedByForQuery(query),
    };
}

export function emptyImportTransportPromotionReady(
    importBatchId: bigint,
    includeWarnings: boolean,
    families: readonly ImportTransportFamily[] = IMPORT_TRANSPORT_FAMILIES
): ImportTransportPromotionReadyResponse {
    const by_family = families.map((entity_family) => ({
        entity_family,
        ready: 0,
        with_warnings: 0,
        blocked: 0,
        already_promoted: 0,
        already_batched: 0,
    }));

    return {
        import_batch_id: importBatchId.toString(),
        include_warnings: includeWarnings,
        by_family,
        totals: {
            ready: 0,
            with_warnings: 0,
            blocked: 0,
            already_promoted: 0,
            already_batched: 0,
        },
    };
}
