/** @deprecated Use ImportTransportValidationStatus from config/types */
export type ImportTransportValidationStatus =
    | "not_validated"
    | "valid"
    | "warning"
    | "blocked"
    | string;

/** Review queue status on import_transport candidates. */
export type ImportTransportReviewStatus =
    | "pending"
    | "needs_review"
    | "needs_more_review"
    | "approved"
    | "rejected"
    | "ignored"
    | "promoted"
    | "promotion_failed"
    | string;

/** Reviewer decision on a candidate row. */
export type ImportTransportReviewDecision =
    | "approved"
    | "rejected"
    | "needs_more_review"
    | "ignored"
    | "merged"
    | string;

/** Promotion lifecycle on import_transport candidates. */
export type ImportTransportPromotionStatus =
    | "ready"
    | "batched"
    | "promoted"
    | "promotion_failed"
    | "blocked"
    | string;

export type ImportTransportEntitySlug = "routes" | "stops" | "variants" | "route-stops";

export type ImportTransportApiFamily = "routes" | "stops" | "variants" | "route_stops";

export type ImportTransportGeometryType = "point" | "line" | "none";

export type ImportTransportTableColumn = {
    key: string;
    label: string;
    mono?: boolean;
};

export type ImportTransportFilterField =
    | "review_status"
    | "review_decision"
    | "promotion_status"
    | "validation_status"
    | "mode_type"
    | "q"
    | "sort"
    | "limit"
    | "offset"
    | "include_promoted";

export type ImportTransportEntityConfig = {
    slug: ImportTransportEntitySlug;
    apiFamily: ImportTransportApiFamily;
    label: string;
    pluralLabel: string;
    routePath: string;
    geometryType: ImportTransportGeometryType;
    tableColumns: readonly ImportTransportTableColumn[];
    searchableFields: readonly string[];
    filterFields: readonly ImportTransportFilterField[];
    defaultSort: string;
    supportsMapPreview: boolean;
    detailTitleField: string;
    detailSubtitleField: string;
};

export type ImportTransportEntityConfigInput = Omit<ImportTransportEntityConfig, "routePath"> & {
    routePath?: string;
};

export type ImportTransportListItem = {
    id: string;
    external_id: string | null;
    review_status: ImportTransportReviewStatus;
    review_decision: ImportTransportReviewDecision | null;
    promotion_status: ImportTransportPromotionStatus | null;
    validation_status: ImportTransportValidationStatus | null;
    confidence_score: number | null;
    updated_at: string | null;
    created_at?: string | null;
    review_note?: string | null;
    validation_errors?: unknown;
    validation_warnings?: unknown;
    normalized_data?: Record<string, unknown> | null;
    source_refs?: Record<string, unknown> | null;
    [key: string]: unknown;
};

export type ImportTransportDetailItem = ImportTransportListItem & {
    geometry?: unknown;
    geom?: unknown;
};

export type ImportTransportListResponse = {
    items: ImportTransportListItem[];
    total?: number;
    import_batch_id?: string | null;
    source_snapshot_version?: string | null;
    selected_by?: string | null;
};

export type ImportTransportScopeQuery = {
    source_snapshot_version?: string;
    import_batch_id?: string | number;
    latest?: boolean;
};

export type ImportTransportListFilters = {
    review_status: string;
    review_decision: string;
    promotion_status: string;
    validation_status: string;
    mode_type: string;
};

export type ImportTransportSummaryResponse = {
    import_batch_id?: string | null;
    source_snapshot_version?: string | null;
    selected_by?: string | null;
    batch_name?: string | null;
    import_status?: string | null;
    validation_status?: string | null;
    families: Array<{
        entity_family: string;
        total: number;
        pending: number;
        approved: number;
        promoted: number;
    }>;
    validation?: {
        blocked_count: number;
        warning_count: number;
    };
    rollup?: {
        total_candidates: number;
        pending: number;
        ready_for_promotion: number;
        promoted: number;
    };
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

export type ImportTransportValidationIssue = {
    id: string;
    import_batch_id: string;
    entity_kind: string | null;
    entity_id: string | null;
    entity_source_id: string | null;
    issue_code: string;
    severity: string;
    issue_status: string;
    message: string;
    details: Record<string, unknown>;
    created_at: string;
    resolved_at: string | null;
};

export type ImportTransportValidateCandidateResponse = {
    family: string;
    candidate_id: string;
    validation_status: string;
    issues: ImportTransportValidationIssue[];
    errors: Array<{ issue_code: string; message: string; severity: string }>;
    warnings: Array<{ issue_code: string; message: string; severity: string }>;
    requires_confirmation: boolean;
    promotion_blocked: boolean;
};

export type ImportTransportBatchValidationResponse = {
    import_batch_id: string;
    families: string[];
    validated_count: number;
    valid_count: number;
    warning_count: number;
    blocked_count: number;
    results_by_family: Record<
        string,
        {
            validated_count: number;
            valid_count: number;
            warning_count: number;
            blocked_count: number;
        }
    >;
};

export type ImportTransportValidationIssuesResponse = {
    items: ImportTransportValidationIssue[];
    total: number;
    limit: number;
    offset: number;
};

export type ImportTransportPromotionReadyFamilyCounts = {
    entity_family: string;
    ready: number;
    with_warnings: number;
    blocked: number;
    already_promoted: number;
    already_batched: number;
};

export type ImportTransportPromotionReadyResponse = {
    import_batch_id: string;
    include_warnings: boolean;
    by_family: ImportTransportPromotionReadyFamilyCounts[];
    totals: {
        ready: number;
        with_warnings: number;
        blocked: number;
        already_promoted: number;
        already_batched: number;
    };
};

export type ImportTransportPromotionBatch = {
    id: string;
    public_id: string;
    import_batch_id: string;
    batch_name: string;
    target_schema: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: string | null;
    item_counts: Record<string, unknown>;
    summary: Record<string, unknown>;
    error_message: string | null;
    created_at: string;
    updated_at: string;
};

export type ImportTransportPromotionBatchDetail = ImportTransportPromotionBatch & {
    items: Array<{
        id: string;
        entity_kind: string;
        raw_entity_id: string;
        promotion_status: string;
        match_status: string;
        item_validation_status: string;
        promoted_target_id: string | null;
        error_message: string | null;
        created_at: string;
        updated_at: string;
    }>;
};

export type ImportTransportPromotionStageLog = {
    id: string;
    promotion_batch_id: string;
    stage_key: string;
    stage_label: string;
    stage_status: string;
    message: string | null;
    progress_percent: number;
    details: Record<string, unknown>;
    started_at: string;
    finished_at: string | null;
};

export type ImportTransportPromotionEntityValidationSummary = {
    entity_family: string;
    pending: number;
    valid: number;
    warning: number;
    blocked: number;
    skipped: number;
};

export type ImportTransportPromotionBatchProgress = {
    batch_id: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: string | null;
    by_entity: ImportTransportPromotionEntityValidationSummary[];
    stages: ImportTransportPromotionStageLog[];
};

export type ImportTransportPromotionBatchValidationResult = ImportTransportPromotionBatchProgress & {
    message: string;
};

export type ImportTransportPromotionBatchLogsResponse = {
    batch_id: string;
    items: ImportTransportPromotionStageLog[];
};

export type ImportTransportPromotionBatchPromoteResult = {
    batch_id: string;
    promotion_status: string;
    message: string;
    promoted: number;
    failed: number;
    skipped: number;
    items: Array<{
        promotion_item_id: string;
        entity_kind: string;
        raw_entity_id: string;
        outcome: string;
        promoted_target_id: string | null;
        error_message: string | null;
    }>;
    summary: Record<string, unknown>;
};

export type ImportTransportCreatePromotionBatchResponse = {
    batch: ImportTransportPromotionBatch;
    items_added: number;
    candidates_marked_batched: number;
    by_family: Array<{
        entity_family: string;
        items_added: number;
        marked_batched: number;
    }>;
    message: string;
};

export type ImportTransportBatchesListParams = {
    limit?: number;
    offset?: number;
    import_status?: string;
    validation_status?: string;
    source_snapshot_version?: string;
};

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
    entity_family: string;
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

export type ImportTransportHistoryImportBatchesListParams = {
    import_status?: string;
    validation_status?: string;
    source_dataset_code?: string;
    source_snapshot_version?: string;
    imported_after?: string;
    imported_before?: string;
    limit?: number;
    offset?: number;
};

export type ImportTransportHistoryPromotionBatchesListParams = {
    import_batch_id?: number | string;
    promotion_status?: string;
    validation_status?: string;
    mode?: "one_entity" | "all_entities";
    entity_family?: string;
    created_after?: string;
    created_before?: string;
    limit?: number;
    offset?: number;
};

export type ImportTransportHistoryPromotionBatchItemsParams = {
    entity_kind?: string;
    promotion_status?: string;
    item_validation_status?: string;
    limit?: number;
    offset?: number;
};

export type ImportTransportGtfsListResponse<T> = {
    items: T[];
    total: number;
    limit: number;
    offset: number;
};

export type ImportTransportGtfsCoreTransportSnapshot = {
    snapshot_at: string;
    active_routes: number;
    active_variants: number;
    active_stops: number;
    variants_too_few_stops: number;
    duplicate_sequences: number;
    stops_without_names: number;
    variants_without_frequency: number;
    variants_without_path: number;
};

export type ImportTransportGtfsExportListItem = {
    id: string;
    build_code: string;
    scope: string;
    status: string;
    output_path: string | null;
    route_count: number;
    variant_count: number;
    stop_count: number;
    service_count: number;
    warning_count: number;
    error_count: number;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    core_transport_snapshot: ImportTransportGtfsCoreTransportSnapshot | null;
    validation_status: string;
    latest_otp_build_status: string | null;
    file_count: number;
    dry_run: boolean;
};

export type ImportTransportGtfsExportDetail = ImportTransportGtfsExportListItem & {
    checksum: string | null;
    file_size_bytes: number | null;
    notes: string | null;
    files: Array<{
        id: string;
        file_name: string;
        file_path: string;
        row_count: number | null;
        checksum: string | null;
        created_at: string;
    }>;
    planned_files: string[];
    validation_report: {
        id: string;
        validator_name: string;
        report_status: string;
        error_count: number;
        warning_count: number;
        report_summary: string | null;
        created_at: string;
    } | null;
    otp_builds: ImportTransportGtfsOtpBuildListItem[];
};

export type ImportTransportGtfsOtpBuildListItem = {
    id: string;
    public_id: string;
    export_build_id: string | null;
    build_code: string;
    scope: string;
    otp_version: string | null;
    build_status: string;
    gtfs_input_path: string | null;
    graph_artifact_path: string | null;
    error_message: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    updated_at: string;
};

export type ImportTransportGtfsCreateExportResponse = {
    export: ImportTransportGtfsExportDetail;
    message: string;
    dry_run: boolean;
};
