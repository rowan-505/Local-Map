export type SearchAliasIndexedEntity = {
    display_name: string;
    public_id: string;
};

export type SearchAliasList = {
    items: SearchAliasItem[];
    total: number;
    page: number;
    pageSize: number;
    sort?: string;
    order?: "asc" | "desc";
};

export type SearchAliasIndexSync = {
    ok: boolean;
    names_added: number;
    names_removed: number;
    documents_updated: number;
    error?: string;
};

export type SearchAliasItem = {
    id: string;
    entity_type: string;
    entity_id: string;
    alias_text: string;
    normalized_alias: string;
    language_code: string | null;
    alias_type: string;
    source: string | null;
    is_active: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    indexed_entity: SearchAliasIndexedEntity | null;
    index_sync?: SearchAliasIndexSync;
};

export type SearchAliasesListFilters = {
    q?: string;
    entity_type?: string;
    language_code?: string;
    alias_type?: string;
    is_active?: boolean;
    entity_id?: string;
    has_indexed_entity?: boolean;
    sort?: string;
    order?: "asc" | "desc";
    page?: number;
    pageSize?: number;
};

export type CreateSearchAliasBody = {
    entity_type: string;
    entity_id: string;
    alias_text: string;
    alias_type?: string;
    language_code?: string | null;
    source?: string | null;
    is_active?: boolean;
};

export type UpdateSearchAliasBody = {
    alias_text?: string;
    alias_type?: string;
    language_code?: string | null;
    source?: string | null;
    is_active?: boolean;
};

export type SearchDocumentSyncState = "current" | "stale" | "missing" | "ghost";

export type SearchDocumentItem = {
    search_document_id: string | null;
    entity_type: string;
    entity_id: string;
    public_id: string | null;
    display_name: string | null;
    primary_name_my: string | null;
    primary_name_en: string | null;
    primary_name_und: string | null;
    transport_mode: string | null;
    review_status: string | null;
    is_verified: boolean;
    is_public: boolean;
    is_active: boolean;
    importance_score: number;
    confidence_score: number;
    indexed_at: string | null;
    source_updated_at: string | null;
    canonical_source_updated_at: string | null;
    alias_count: number;
    sync_state: SearchDocumentSyncState;
};

export type SearchDocumentList = {
    items: SearchDocumentItem[];
    total: number;
    page: number;
    pageSize: number;
    sort: string;
    order: "asc" | "desc";
};

export type SearchDocumentsListFilters = {
    q?: string;
    entity_type?: string;
    entity_id?: string;
    transport_mode?: string;
    review_status?: string;
    is_verified?: boolean;
    is_public?: boolean;
    is_active?: boolean;
    has_alias?: boolean;
    sync_state?: SearchDocumentSyncState;
    language?: "my" | "en" | "und";
    sort?: string;
    order?: "asc" | "desc";
    page?: number;
    pageSize?: number;
};

export type FailedSearchResolutionType =
    | "alias"
    | "data_fix"
    | "duplicate"
    | "ignored"
    | "other";

export type FailedSearchLinkedAlias = {
    id: string;
    alias_text: string;
};

export type FailedSearchLinkedEntity = {
    entity_type: string;
    entity_id: string;
    display_name: string;
    public_id: string;
};

export type FailedSearchItem = {
    id: string;
    query: string;
    normalized_query: string | null;
    language: string | null;
    category: string | null;
    transport_type: string | null;
    transport_mode: string | null;
    entity_types_key: string | null;
    types: string[] | null;
    area_context_key: string | null;
    result_count: number;
    occurrence_count: number;
    first_seen_at: string;
    last_seen_at: string;
    is_resolved: boolean;
    resolved_at: string | null;
    resolution_type: FailedSearchResolutionType | null;
    linked_alias: FailedSearchLinkedAlias | null;
    linked_entity: FailedSearchLinkedEntity | null;
};

export type FailedSearchList = {
    items: FailedSearchItem[];
    total: number;
    page: number;
    pageSize: number;
    sort: string;
    order: "asc" | "desc";
};

export type FailedSearchesListFilters = {
    q?: string;
    lang?: string;
    resolved?: boolean;
    last_seen_from?: string;
    last_seen_to?: string;
    min_occurrence?: number;
    sort?: string;
    order?: "asc" | "desc";
    page?: number;
    pageSize?: number;
};

export type ResolveFailedSearchBody = {
    action: "resolve";
    resolution_type: FailedSearchResolutionType;
    linked_alias_id?: string;
};

export type ReopenFailedSearchBody = {
    action: "reopen";
};

export type UpdateFailedSearchBody = ResolveFailedSearchBody | ReopenFailedSearchBody;

export type SearchAnalyticsPeriod = "today" | "7d" | "30d" | "custom";

export type SearchAnalyticsDashboard = {
    range: {
        period: SearchAnalyticsPeriod;
        from: string;
        to: string;
        previous_from: string;
        previous_to: string;
        timeseries_bucket: "hour" | "day";
    };
    summary: {
        total_searches: number;
        zero_result_count: number;
        zero_result_rate: number;
        searches_with_click: number;
        click_through_rate: number;
        no_click_rate: number;
        latency_p50_ms: number | null;
        latency_p95_ms: number | null;
    };
    timeseries: Array<{
        bucket: string;
        searches: number;
        zero_result_rate: number;
        latency_p50_ms: number | null;
        latency_p95_ms: number | null;
        click_count: number;
    }>;
    top_searches: Array<{
        normalized_query: string;
        search_count: number;
        zero_result_count: number;
        zero_result_rate: number;
        click_count: number;
    }>;
    top_failed_searches: Array<{
        normalized_query: string;
        search_count: number;
        zero_result_count: number;
        zero_result_rate: number;
        click_count: number;
    }>;
    trending_queries: Array<{
        normalized_query: string;
        current_count: number;
        previous_count: number;
        growth: number;
    }>;
    top_clicked_entities: Array<{
        entity_type: string;
        entity_id: string;
        display_name: string | null;
        click_count: number;
    }>;
    by_language: Array<{ key: string; count: number }>;
    by_category: Array<{ key: string; count: number }>;
};

export type SearchAnalyticsFilters = {
    period?: SearchAnalyticsPeriod;
    from?: string;
    to?: string;
};

export type SearchIndexHealthStatus = "healthy" | "unhealthy";

export type SearchIndexHealthSeverity = "healthy" | "warning" | "critical";

export type SearchIndexRunSummary = {
    id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    entity_counts: unknown;
};

export type SearchIndexHealthFamily = {
    entity_family: string;
    search_entity_type: string;
    expected_searchable_count: number;
    canonical_count: number;
    indexed_count: number;
    missing_count: number;
    ghost_count: number;
    stale_count: number;
    latest_indexed_at: string | null;
    latest_source_updated_at: string | null;
    severity: SearchIndexHealthSeverity;
    severity_reasons: string[];
    status: SearchIndexHealthStatus;
};

export type SearchIndexHealthReport = {
    overall_status: SearchIndexHealthStatus;
    overall_severity: SearchIndexHealthSeverity;
    overall_severity_reasons: string[];
    health_query_ok: boolean;
    health_query_error: string | null;
    totals: {
        expected_searchable_count: number;
        canonical_count: number;
        indexed_count: number;
        missing_count: number;
        ghost_count: number;
        stale_count: number;
    };
    families: SearchIndexHealthFamily[];
    last_rebuild_run: SearchIndexRunSummary | null;
    last_successful_run: SearchIndexRunSummary | null;
};

export type SearchIndexMaintenanceOperationStatus =
    | "success"
    | "partial"
    | "failed"
    | "skipped"
    | "conflict";

export type SearchIndexMaintenanceOperation = {
    operation: "health_check" | "reindex_family" | "reindex_entity" | "repair_unhealthy";
    status: SearchIndexMaintenanceOperationStatus;
    duration_ms: number;
    affected_families: string[];
    entity_family: string | null;
    entity_type: string | null;
    entity_id: string | null;
    rebuild_views: string[];
    rebuild_run_id: string | null;
    rows_rebuilt: number;
    message: string | null;
    health_before: SearchIndexHealthReport;
    health_after: SearchIndexHealthReport;
};

export type ReindexSearchFamilyBody = {
    entity_family: string;
};

export type ReindexSearchEntityBody = {
    entity_type: string;
    entity_id: string;
};
