/**
 * Phase 8 YBS Supabase dry-run import plan types.
 *
 * Does not touch the database.
 */

import type { BulkImportReadiness, RouteReadinessReport } from "./route-import-policy.js";

export const PHASE8_SCHEMA_VERSION = 3;

export type PlanActionType =
    | "create_import_batch"
    | "upsert_operator"
    | "insert_route"
    | "update_unreviewed_route"
    | "skip_protected_route"
    | "insert_route_name"
    | "insert_route_variant"
    | "insert_stop"
    | "reuse_existing_stop"
    | "merge_additional_stop_data"
    | "hold_dashboard_review_stop"
    | "insert_stop_name"
    | "insert_route_stop"
    | "insert_route_path"
    | "insert_fare"
    | "insert_source_link"
    | "reuse_source_link"
    | "insert_import_error"
    | "blocked_conflict";

export type SourceLinkEntityType =
    | "operator"
    | "stop"
    | "route"
    | "route_variant"
    | "route_path"
    | "route_stop"
    | "fare";

export type ReviewStatus =
    | "imported_unreviewed"
    | "needs_review"
    | "reviewed"
    | "verified"
    | "rejected"
    | "manual_protected";

export type PlanAction = {
    action: PlanActionType;
    entity_type: SourceLinkEntityType | "import_batch" | "import_error";
    external_id: string | null;
    entity_ref: string;
    existing_entity_id?: number | null;
    payload: Record<string, unknown>;
    reason?: string;
};

export type PlanBlocker = {
    code: string;
    message: string;
    route_code?: string;
    variant_code?: string;
    candidate_id?: string;
};

export type PlanConflict = {
    code: string;
    message: string;
    entity_type: string;
    external_id?: string;
    existing_entity_id?: number | null;
    route_code?: string;
    candidate_id?: string;
};

export type PlanWarning = {
    code: string;
    message: string;
    route_code?: string;
    variant_code?: string;
    candidate_id?: string;
};

export type RouteGeometryReviewReport = {
    route_code: string;
    placeholder_stop_geometry_count: number;
    placeholder_route_path_count: number;
    public_hidden_until_review: boolean;
    validator_required: boolean;
};

export type ImportBatchPlan = {
    action: "create_import_batch";
    entity_ref: string;
    payload: {
        source_name: string;
        source_kind: string;
        import_scope: string;
        import_mode: string;
        status: string;
        source_file_path: string;
        notes: string;
    };
};

export type DryRunPlan = {
    schema_version: number;
    generated_at: string;
    run_root: string;
    source_name: string;
    source_kind: string;
    import_batch: ImportBatchPlan;
    actions: PlanAction[];
    blockers: PlanBlocker[];
    warnings: PlanWarning[];
    conflicts: PlanConflict[];
    route_geometry_reports: RouteGeometryReviewReport[];
    route_readiness_reports: RouteReadinessReport[];
    bulk_import_readiness: BulkImportReadiness;
    summary: DryRunPlanSummary;
};

export type DryRunPlanSummary = {
    routes_to_insert: number;
    routes_to_update: number;
    routes_skipped_protected: number;
    operators_to_upsert: number;
    route_variants_to_insert: number;
    stops_to_create: number;
    stops_to_reuse: number;
    stops_to_merge: number;
    stop_names_to_insert: number;
    route_names_to_insert: number;
    route_stops_to_insert: number;
    route_paths_to_insert: number;
    fares_to_insert: number;
    source_links_to_create: number;
    source_links_to_reuse: number;
    import_errors_planned: number;
    blocked_conflicts: number;
    blockers: number;
    warnings: number;
    placeholder_stop_geometry_count: number;
    placeholder_route_path_count: number;
    conflicts: number;
    total_actions: number;
};

export type Phase8DryRunReport = {
    generated_at: string;
    run_root: string;
    plan_path: string;
    summary: DryRunPlanSummary;
    blockers: PlanBlocker[];
    warnings: PlanWarning[];
    conflicts: PlanConflict[];
    route_geometry_reports: RouteGeometryReviewReport[];
    route_readiness_reports: RouteReadinessReport[];
    bulk_import_readiness: BulkImportReadiness;
};
