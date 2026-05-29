import type { ImportTransportFamily } from "./import-transport.config.js";

export type ImportTransportScopeSelectedBy =
    | "import_batch_id"
    | "source_snapshot_version_unique"
    | "source_snapshot_version_latest";

export type ImportTransportScopeResolved = {
    importBatchId: bigint;
    sourceSnapshotVersion: string | null;
    batchName: string;
    importStatus: string;
    validationStatus: string;
    selectedBy: ImportTransportScopeSelectedBy;
};

export type ImportTransportScopeQuery = {
    import_batch_id?: bigint | undefined;
    source_snapshot_version?: string | undefined;
    latest?: boolean | undefined;
};

export type ImportTransportListFilters = {
    review_status?: string | undefined;
    review_decision?: string | undefined;
    promotion_status?: string | undefined;
    validation_status?: string | undefined;
    mode_type?: string | undefined;
    q?: string | undefined;
};

export type ImportTransportListQuery = ImportTransportScopeQuery &
    ImportTransportListFilters & {
        limit?: number | undefined;
        offset?: number | undefined;
        sort?: string | undefined;
        include_total?: boolean | undefined;
        include_geometry?: boolean | undefined;
        include_promoted?: boolean | undefined;
    };

export type ImportTransportCandidateRowDb = {
    id: bigint;
    import_batch_id: bigint;
    external_id: string | null;
    match_status: string | null;
    validation_status: string | null;
    review_status: string | null;
    review_decision: string | null;
    promotion_status: string | null;
    review_note: string | null;
    confidence_score: number | string | null;
    normalized_data: unknown;
    source_refs: unknown;
    created_at: Date | null;
    updated_at: Date | null;
    geometry?: unknown;
    [key: string]: unknown;
};

export type ImportTransportCandidateListItem = {
    id: string;
    external_id: string | null;
    review_status: string;
    review_decision: string | null;
    promotion_status: string | null;
    validation_status: string | null;
    confidence_score: number | null;
    review_note?: string | null;
    normalized_data?: Record<string, unknown> | null;
    source_refs?: Record<string, unknown> | null;
    created_at: string | null;
    updated_at: string | null;
    geometry?: unknown;
    [key: string]: unknown;
};

export type ImportTransportCandidatesListResponse = {
    items: ImportTransportCandidateListItem[];
    total?: number;
    has_more?: boolean;
    import_batch_id: string;
    source_snapshot_version: string | null;
    selected_by: ImportTransportScopeSelectedBy;
};

export type ImportTransportSummaryFamilyMetrics = {
    entity_family: ImportTransportFamily;
    total: number;
    pending: number;
    approved: number;
    promoted: number;
};

export type ImportTransportSummaryValidationRollup = {
    blocked_count: number;
    warning_count: number;
};

export type ImportTransportSummaryRollup = {
    total_candidates: number;
    pending: number;
    ready_for_promotion: number;
    promoted: number;
};

export type ImportTransportSummaryResponse = {
    import_batch_id: string;
    source_snapshot_version: string | null;
    selected_by: ImportTransportScopeSelectedBy;
    batch_name: string;
    import_status: string;
    validation_status: string;
    families: ImportTransportSummaryFamilyMetrics[];
    validation: ImportTransportSummaryValidationRollup;
    rollup: ImportTransportSummaryRollup;
};

export type ImportTransportBatchListItem = {
    id: string;
    public_id: string;
    batch_name: string;
    source_snapshot_version: string | null;
    import_status: string;
    validation_status: string;
    source_dataset_id: string;
    imported_at: string | null;
    created_at: string;
    updated_at: string;
};

export type ImportTransportBatchesListResponse = {
    items: ImportTransportBatchListItem[];
    total: number;
    limit: number;
    offset: number;
};

export type ImportTransportOptionsResponse = {
    families: ImportTransportFamily[];
    mode_types: string[];
    sort_options: Array<{ value: string; label: string }>;
    review_statuses: string[];
    review_decisions: string[];
    promotion_statuses: string[];
    validation_statuses: string[];
};
