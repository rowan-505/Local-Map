import type {
    ImportTransportBatchesListParams,
    ImportTransportListFilters,
    ImportTransportScopeQuery,
} from "../config/types";

export function importTransportScopeKey(scope: ImportTransportScopeQuery | null): string {
    if (!scope) {
        return "none";
    }
    if (scope.import_batch_id) {
        return `batch:${scope.import_batch_id}`;
    }
    const snap = scope.source_snapshot_version ?? "";
    const latest = scope.latest ? "1" : "0";
    return `snapshot:${snap}:latest=${latest}`;
}

export type ImportTransportCandidatesListQueryKeyInput = {
    apiFamily: string;
    apiScopeQuery: ImportTransportScopeQuery;
    limit: number;
    offset: number;
    sort: string;
    filters: ImportTransportListFilters;
    qApplied: string;
    showPromoted: boolean;
};

export const importTransportQueryKeys = {
    summary: (scope: ImportTransportScopeQuery | null) =>
        ["import-transport", "summary", importTransportScopeKey(scope)] as const,
    batches: (params: ImportTransportBatchesListParams | null) =>
        params
            ? ([
                  "import-transport",
                  "batches",
                  params.limit ?? 50,
                  params.offset ?? 0,
                  params.import_status ?? "",
                  params.validation_status ?? "",
                  params.source_snapshot_version ?? "",
              ] as const)
            : (["import-transport", "batches", "none"] as const),
    candidatesList: (input: ImportTransportCandidatesListQueryKeyInput | null) =>
        input
            ? ([
                  "import-transport",
                  "candidates",
                  input.apiFamily,
                  importTransportScopeKey(input.apiScopeQuery),
                  input.filters.review_status,
                  input.filters.review_decision,
                  input.filters.promotion_status,
                  input.filters.validation_status,
                  input.filters.mode_type,
                  input.qApplied.trim(),
                  input.sort,
                  input.limit,
                  input.offset,
                  input.showPromoted,
              ] as const)
            : (["import-transport", "candidates", "none"] as const),
    candidateDetail: (
        apiFamily: string,
        id: string,
        scope: ImportTransportScopeQuery | null
    ) =>
        [
            "import-transport",
            "candidate-detail",
            apiFamily,
            id,
            importTransportScopeKey(scope),
        ] as const,
};
