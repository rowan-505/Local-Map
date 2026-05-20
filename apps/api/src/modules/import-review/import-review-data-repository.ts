import type {
    ImportReviewBuildingsQuery,
    ImportReviewBulkFilters,
    ImportReviewCandidatesListQuery,
    ImportReviewPlacesQuery,
    ImportReviewRoadsQuery,
} from "./import-review.schema.js";
import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import type { CandidateListFilters } from "./import-review-candidate-sql.js";
import type { ImportReviewBulkDecisionRepoResult } from "./import-review.types.js";
import type { ImportReviewFamilySummaryMetricsDb } from "./import-review-summary-counts.js";

export type SnapshotIdRow = { id: bigint };

export type ImportReviewSummaryBucketDb = {
    entity_family: string;
    review_batch_id: bigint;
    source_snapshot_version: string;
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    review_decision: string | null;
    promotion_status: string | null;
    row_count: bigint;
};

export type BuildingListRowDb = {
    id: bigint;
    public_id: string;
    review_batch_id: bigint;
    source_snapshot_version: string;
    /** Local staging row id echoed into Supabase workspace. */
    local_staging_id: bigint;
    source_snapshot_id_local: bigint | null;
    external_id: string | null;
    canonical_name: string | null;
    name: string | null;
    class_code: string | null;
    building_type: string | null;
    building_type_id: bigint | null;
    admin_area_id: bigint | null;
    levels: number | null;
    height_m: unknown;
    area_m2: unknown;
    confidence_score: unknown;
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    review_decision: string | null;
    reviewed_by: string | null;
    reviewed_at: Date | null;
    review_note: string | null;
    normalized_data: unknown;
    source_refs: unknown;
    review_overrides: unknown;
    matched_core_id: bigint | null;
    matched_core_table: string | null;
    matched_core_data: unknown;
    f2_comparison: unknown;
    validation_warnings: unknown;
    validation_errors: unknown;
    promotion_status: string | null;
    promoted_core_id: bigint | null;
    created_at: Date;
    updated_at: Date;
    /** GeoJSON polygon from `geom`. */
    geometry: unknown | null;
    /** GeoJSON centroid point. */
    centroid: unknown | null;
    road_candidate_road_class_id?: bigint | null;
    road_candidate_surface?: string | null;
    road_candidate_is_oneway?: boolean | null;
    road_candidate_class_label?: string | null;
};

import type { ImportReviewScopeQuery, ImportReviewScopeResolved } from "./import-review-batch-resolver.js";
export type { ImportReviewScopeQuery, ImportReviewScopeResolved } from "./import-review-batch-resolver.js";

export type ReviewActor = {
    /** Human-readable reviewer label retained for dashboards / tooling. */
    reviewedByText: string;
    /** Supabase FK into `app_auth.auth_users` when numeric user id resolves. */
    reviewedByUserId: bigint | null;
};

export type CandidateReviewGuardContext = {
    match_status: string | null;
    auto_action: string | null;
    promotion_status: string | null;
};

export type CandidateReviewRoadDecisionContext = CandidateReviewGuardContext & {
    validation_warnings: unknown;
    validation_errors: unknown;
};

/** Row snapshot prior to PATCH /roads/:id/overrides (validated + locked in repo transaction). */
export type ImportReviewRoadCandidatePatchBaselineDb = {
    id: bigint;
    promotion_status: string | null;
    canonical_name: string | null;
    road_class_id: bigint | null;
    road_class: string | null;
    surface: string | null;
    is_oneway: boolean | null;
    geom_geojson: unknown | null;
    review_overrides: unknown;
    normalized_data: unknown;
    class_code: string | null;
    matched_core_table: string | null;
    matched_core_id: bigint | null;
    review_note: string | null;
};

export interface ImportReviewDataRepository {
    resolveScope(query: ImportReviewScopeQuery): Promise<ImportReviewScopeResolved>;

    fetchSummaryBuckets(scope: ImportReviewScopeResolved): Promise<{
        rows: ImportReviewSummaryBucketDb[];
        warnings: string[];
    }>;

    fetchFamilySummaryMetrics(scope: ImportReviewScopeResolved): Promise<{
        rows: ImportReviewFamilySummaryMetricsDb[];
        warnings: string[];
    }>;

    fetchBuildingFilterOptions(scope: ImportReviewScopeResolved): Promise<{
        match_status: string[];
        auto_action: string[];
        review_status: string[];
        review_decision: string[];
        class_code: string[];
        promotion_status: string[];
    }>;

    countBuildingCandidates(
        scope: ImportReviewScopeResolved,
        filters: Pick<
            ImportReviewBuildingsQuery,
            | "match_status"
            | "auto_action"
            | "review_status"
            | "review_decision"
            | "class_code"
            | "promotion_status"
            | "include_promoted"
            | "q"
        >
    ): Promise<bigint>;

    listBuildingCandidates(
        scope: ImportReviewScopeResolved,
        filters: Pick<
            ImportReviewBuildingsQuery,
            | "match_status"
            | "auto_action"
            | "review_status"
            | "review_decision"
            | "class_code"
            | "promotion_status"
            | "include_promoted"
            | "q"
            | "limit"
            | "offset"
            | "sort"
            | "include_geometry"
        >
    ): Promise<BuildingListRowDb[]>;

    getBuildingById(
        scope: ImportReviewScopeResolved,
        id: bigint,
        includeGeometry: boolean
    ): Promise<BuildingListRowDb | null>;

    findBuildingCandidateReviewContext(
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<CandidateReviewGuardContext | null>;

    updateBuildingReviewDecision(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null>;

    patchBuildingReviewOverrides(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        overridesPatch: Record<string, unknown>;
        editedByUserId: bigint | null;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null>;

    bulkBuildingDecisions(args: {
        scope: ImportReviewScopeResolved;
        mode: "ids" | "filters";
        ids?: bigint[];
        filters?: ImportReviewBulkFilters;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
        force: boolean;
        dryRun: boolean;
    }): Promise<ImportReviewBulkDecisionRepoResult>;

    countPlaceCandidates(
        scope: ImportReviewScopeResolved,
        filters: Pick<
            ImportReviewPlacesQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ): Promise<bigint>;

    listPlaceCandidates(
        scope: ImportReviewScopeResolved,
        filters: Pick<
            ImportReviewPlacesQuery,
            | "match_status"
            | "auto_action"
            | "review_status"
            | "review_decision"
            | "q"
            | "limit"
            | "offset"
            | "sort"
            | "include_geometry"
        >
    ): Promise<BuildingListRowDb[]>;

    findPlaceCandidateReviewContext(
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<CandidateReviewGuardContext | null>;

    updatePlaceReviewDecision(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null>;

    bulkPlaceDecisions(args: {
        scope: ImportReviewScopeResolved;
        mode: "ids" | "filters";
        ids?: bigint[];
        filters?: ImportReviewBulkFilters;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
        force: boolean;
        dryRun: boolean;
    }): Promise<ImportReviewBulkDecisionRepoResult>;

    countRoadCandidates(
        scope: ImportReviewScopeResolved,
        filters: Pick<
            ImportReviewRoadsQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ): Promise<bigint>;

    listRoadCandidates(
        scope: ImportReviewScopeResolved,
        filters: Pick<
            ImportReviewRoadsQuery,
            | "match_status"
            | "auto_action"
            | "review_status"
            | "review_decision"
            | "q"
            | "limit"
            | "offset"
            | "sort"
            | "include_geometry"
        >
    ): Promise<BuildingListRowDb[]>;

    findRoadCandidateReviewContext(
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<CandidateReviewRoadDecisionContext | null>;

    fetchRoadCandidatePatchBaseline(
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<ImportReviewRoadCandidatePatchBaselineDb | null>;

    patchRoadCandidateReviewOverrides(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        merged_review_overrides: Record<string, unknown>;
        canonical_name: string | null;
        road_class_id: bigint | null;
        road_class_label: string | null;
        surface: string | null;
        is_oneway: boolean | null;
        normalized_geom_geojson: string | null;
        validation_warnings_json: unknown;
        validation_errors_json: unknown;
        editedByUserId: bigint | null;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null>;

    lookupRefRoadClassById(id: bigint): Promise<{ id: bigint; code: string } | null>;

    lookupRefRoadClassByCode(normalizedLowerCode: string): Promise<{ id: bigint; code: string } | null>;

    fetchRoadCandidateRoutingValidationRow(
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<import("./import-review-road-routing-validation.js").ImportReviewRoadRoutingValidationRow | null>;

    persistRoadRoutingValidation(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        validation_errors_json: unknown;
        validation_warnings_json: unknown;
        review_status: string;
        validation_summary: Record<string, unknown>;
    }): Promise<BuildingListRowDb | null>;

    updateRoadReviewDecision(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null>;

    bulkRoadDecisions(args: {
        scope: ImportReviewScopeResolved;
        mode: "ids" | "filters";
        ids?: bigint[];
        filters?: ImportReviewBulkFilters;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
        force: boolean;
        dryRun: boolean;
    }): Promise<ImportReviewBulkDecisionRepoResult>;

    countCandidates(
        family: ImportReviewEntityFamilySlug,
        scope: ImportReviewScopeResolved,
        filters: CandidateListFilters
    ): Promise<bigint>;

    listCandidates(
        family: ImportReviewEntityFamilySlug,
        scope: ImportReviewScopeResolved,
        filters: CandidateListFilters
    ): Promise<BuildingListRowDb[]>;

    getCandidateById(
        family: ImportReviewEntityFamilySlug,
        scope: ImportReviewScopeResolved,
        id: bigint,
        includeGeometry: boolean
    ): Promise<BuildingListRowDb | null>;

    fetchCandidateFilterOptions(
        family: ImportReviewEntityFamilySlug,
        scope: ImportReviewScopeResolved
    ): Promise<Record<string, string[]>>;

    findCandidateReviewContext(
        family: ImportReviewEntityFamilySlug,
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<CandidateReviewGuardContext | null>;

    updateCandidateReviewDecision(args: {
        family: ImportReviewEntityFamilySlug;
        scope: ImportReviewScopeResolved;
        id: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null>;

    bulkCandidateDecisions(args: {
        family: ImportReviewEntityFamilySlug;
        scope: ImportReviewScopeResolved;
        mode: "ids" | "filters";
        ids?: bigint[];
        filters?: ImportReviewBulkFilters;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
        force: boolean;
        dryRun: boolean;
    }): Promise<ImportReviewBulkDecisionRepoResult>;

    patchCandidateReviewOverrides(args: {
        family: ImportReviewEntityFamilySlug;
        scope: ImportReviewScopeResolved;
        id: bigint;
        overridesPatch: Record<string, unknown>;
        editedByUserId: bigint | null;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null>;
}
