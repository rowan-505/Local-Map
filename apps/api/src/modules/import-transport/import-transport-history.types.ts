import type { ImportTransportFamily } from "./import-transport.config.js";

export type ImportTransportHistoryListResponse<T> = {
    items: T[];
    total: number;
    limit: number;
    offset: number;
};

export type ImportTransportHistorySourceDataset = {
    id: string;
    code: string;
    name: string;
    transport_mode: string;
    source_format: string;
    provider_name: string | null;
    region_code: string | null;
};

export type ImportTransportHistoryEntityCounts = {
    entity_family: ImportTransportFamily;
    total: number;
    pending_review: number;
    approved: number;
    promoted: number;
    validation_blocked: number;
    validation_warning: number;
    validation_valid: number;
    validation_not_validated: number;
};

export type ImportTransportHistoryValidationCounts = {
    issue_blocked_count: number;
    issue_warning_count: number;
    candidate_blocked_count: number;
    candidate_warning_count: number;
};

export type ImportTransportHistoryPromotionRollup = {
    promotion_batch_count: number;
    latest_promoted_at: string | null;
    latest_validated_at: string | null;
};

export type ImportTransportHistoryImportBatchListItem = {
    id: string;
    public_id: string;
    batch_name: string;
    import_status: string;
    validation_status: string;
    source_snapshot_version: string | null;
    source_dataset: ImportTransportHistorySourceDataset;
    imported_at: string | null;
    validated_at: string | null;
    created_at: string;
    updated_at: string;
    total_candidates: number;
    counts_by_entity: ImportTransportHistoryEntityCounts[];
    validation: ImportTransportHistoryValidationCounts;
    promotion_batches: ImportTransportHistoryPromotionRollup;
};

export type ImportTransportHistoryPromotionBatchSummary = {
    id: string;
    batch_name: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    created_at: string;
    promoted_at: string | null;
    validated_at: string | null;
    promoted_count: number;
    failed_count: number;
    skipped_count: number;
};

export type ImportTransportHistoryImportBatchDetail = ImportTransportHistoryImportBatchListItem & {
    source_file_name: string | null;
    source_file_checksum: string | null;
    record_counts: Record<string, unknown>;
    summary: Record<string, unknown>;
    error_message: string | null;
    promotion_batch_summaries: ImportTransportHistoryPromotionBatchSummary[];
};

export type ImportTransportHistoryPromotionBatchListItem = {
    id: string;
    public_id: string;
    batch_name: string;
    import_batch_id: string;
    import_batch_name: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    mode: string | null;
    entity_family: string | null;
    include_warnings: boolean;
    item_total: number;
    promoted_count: number;
    failed_count: number;
    skipped_count: number;
    validation_blocked_count: number;
    validation_warning_count: number;
    created_at: string;
    updated_at: string;
    validated_at: string | null;
    promoted_at: string | null;
};

export type ImportTransportHistoryPromotionBatchDetail = ImportTransportHistoryPromotionBatchListItem & {
    target_schema: string;
    item_counts: Record<string, unknown>;
    summary: Record<string, unknown>;
    error_message: string | null;
    counts_by_entity: ImportTransportHistoryEntityCounts[];
    source_import_batch: {
        id: string;
        batch_name: string;
        import_status: string;
        source_snapshot_version: string | null;
        source_dataset: ImportTransportHistorySourceDataset;
    };
};

export type ImportTransportHistoryPromotionBatchItem = {
    id: string;
    entity_kind: string;
    raw_entity_id: string;
    promotion_status: string;
    item_validation_status: string;
    match_status: string;
    promoted_target_schema: string | null;
    promoted_target_table: string | null;
    promoted_target_id: string | null;
    promoted_core_id: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
};

export type ImportTransportHistoryPromotionBatchLogsResponse = {
    batch_id: string;
    items: Array<{
        id: string;
        stage_key: string;
        stage_label: string;
        stage_status: string;
        message: string | null;
        progress_percent: number;
        details: Record<string, unknown>;
        started_at: string;
        finished_at: string | null;
    }>;
};
