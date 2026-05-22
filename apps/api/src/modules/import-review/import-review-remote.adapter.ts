import type {
    CandidateReviewGuardContext,
    CandidateReviewRoadDecisionContext,
    ImportReviewDataRepository,
    ImportReviewScopeQuery,
    ImportReviewScopeResolved,
    ReviewActor,
} from "./import-review-data-repository.js";
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
import { RemoteImportReviewRepositoryCore } from "./import-review-remote.repo.js";

/** Supabase-only `import_review.*` datasource. */
export class RemoteImportReviewDataAdapter implements ImportReviewDataRepository {
    constructor(private readonly core: RemoteImportReviewRepositoryCore) {}

    resolveScope(query: ImportReviewScopeQuery): Promise<ImportReviewScopeResolved> {
        return this.core.resolveScope(query);
    }

    fetchSummaryBuckets(scope: ImportReviewScopeResolved) {
        return this.core.fetchSummaryBuckets(scope);
    }

    fetchFamilySummaryMetrics(scope: ImportReviewScopeResolved) {
        return this.core.fetchFamilySummaryMetrics(scope);
    }

    fetchBuildingFilterOptions(scope: ImportReviewScopeResolved) {
        return this.core.fetchBuildingFilterOptions(scope.reviewBatchId);
    }

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
    ) {
        return this.core.countBuildingCandidates(scope.reviewBatchId, filters);
    }

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
    ) {
        return this.core.listBuildingCandidates(scope.reviewBatchId, filters);
    }

    getBuildingById(scope: ImportReviewScopeResolved, id: bigint, includeGeometry: boolean) {
        return this.core.getBuildingCandidateById(id, scope.reviewBatchId, includeGeometry);
    }

    findBuildingCandidateReviewContext(
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<CandidateReviewGuardContext | null> {
        return this.core.findBuildingCandidateReviewContext(id, scope.reviewBatchId);
    }

    updateBuildingReviewDecision(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }) {
        return this.core.updateBuildingReviewDecision({
            id: args.id,
            reviewBatchId: args.scope.reviewBatchId,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            actor: args.actor,
            reviewNote: args.reviewNote,
        });
    }

    patchBuildingReviewOverrides(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        overridesPatch: Record<string, unknown>;
        editedByUserId: bigint | null;
        reviewNote: string | null | undefined;
    }) {
        return this.core.patchBuildingReviewOverrides({
            reviewBatchId: args.scope.reviewBatchId,
            id: args.id,
            overridesPatch: args.overridesPatch,
            editedByUserId: args.editedByUserId,
            reviewNote: args.reviewNote,
        });
    }

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
    }): Promise<ImportReviewBulkDecisionRepoResult> {
        return this.core.bulkBuildingDecisions({
            reviewBatchId: args.scope.reviewBatchId,
            mode: args.mode,
            ids: args.ids,
            filters: args.filters,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            reviewedByUserId: args.actor.reviewedByUserId,
            reviewNote: args.reviewNote,
            force: args.force,
            dryRun: args.dryRun,
        });
    }

    countPlaceCandidates(
        scope: ImportReviewScopeResolved,
        filters: Pick<
            ImportReviewPlacesQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ) {
        return this.core.countPlaceCandidates(scope.reviewBatchId, filters);
    }

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
    ) {
        return this.core.listPlaceCandidates(scope.reviewBatchId, filters);
    }

    findPlaceCandidateReviewContext(
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<CandidateReviewGuardContext | null> {
        return this.core.findPlaceCandidateReviewContext(id, scope.reviewBatchId);
    }

    updatePlaceReviewDecision(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }) {
        return this.core.updatePlaceReviewDecision({
            id: args.id,
            reviewBatchId: args.scope.reviewBatchId,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            actor: args.actor,
            reviewNote: args.reviewNote,
        });
    }

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
    }) {
        return this.core.bulkPlaceDecisions({
            reviewBatchId: args.scope.reviewBatchId,
            mode: args.mode,
            ids: args.ids,
            filters: args.filters,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            reviewedByUserId: args.actor.reviewedByUserId,
            reviewNote: args.reviewNote,
            force: args.force,
            dryRun: args.dryRun,
        });
    }

    countRoadCandidates(
        scope: ImportReviewScopeResolved,
        filters: Pick<
            ImportReviewRoadsQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ) {
        return this.core.countRoadCandidates(scope.reviewBatchId, filters);
    }

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
    ) {
        return this.core.listRoadCandidates(scope.reviewBatchId, filters);
    }

    findRoadCandidateReviewContext(
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<CandidateReviewRoadDecisionContext | null> {
        return this.core.findRoadCandidateReviewContext(id, scope.reviewBatchId);
    }

    fetchRoadCandidatePatchBaseline(scope: ImportReviewScopeResolved, id: bigint) {
        return this.core.fetchRoadCandidatePatchBaseline(id, scope.reviewBatchId);
    }

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
    }) {
        return this.core.patchRoadCandidateReviewOverrides({
            id: args.id,
            reviewBatchId: args.scope.reviewBatchId,
            merged_review_overrides: args.merged_review_overrides,
            canonical_name: args.canonical_name,
            road_class_id: args.road_class_id,
            road_class_label: args.road_class_label,
            surface: args.surface,
            is_oneway: args.is_oneway,
            normalized_geom_geojson: args.normalized_geom_geojson,
            validation_warnings_json: args.validation_warnings_json,
            validation_errors_json: args.validation_errors_json,
            editedByUserId: args.editedByUserId,
            reviewNote: args.reviewNote,
        });
    }

    lookupRefRoadClassById(id: bigint) {
        return this.core.lookupRefRoadClassById(id);
    }

    lookupRefRoadClassByCode(normalizedLowerCode: string) {
        return this.core.lookupRefRoadClassByCode(normalizedLowerCode);
    }

    fetchRoadCandidateRoutingValidationRow(scope: ImportReviewScopeResolved, id: bigint) {
        return this.core.fetchRoadCandidateRoutingValidationRow(id, scope.reviewBatchId);
    }

    persistRoadRoutingValidation(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        validation_errors_json: unknown;
        validation_warnings_json: unknown;
        review_status: string;
        validation_summary: Record<string, unknown>;
        length_m: number | null;
    }) {
        return this.core.persistRoadRoutingValidation({
            id: args.id,
            reviewBatchId: args.scope.reviewBatchId,
            validation_errors_json: args.validation_errors_json,
            validation_warnings_json: args.validation_warnings_json,
            review_status: args.review_status,
            validation_summary: args.validation_summary,
            length_m: args.length_m,
        });
    }

    updateRoadReviewDecision(args: {
        scope: ImportReviewScopeResolved;
        id: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }) {
        return this.core.updateRoadReviewDecision({
            id: args.id,
            reviewBatchId: args.scope.reviewBatchId,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            actor: args.actor,
            reviewNote: args.reviewNote,
        });
    }

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
    }) {
        return this.core.bulkRoadDecisions({
            reviewBatchId: args.scope.reviewBatchId,
            mode: args.mode,
            ids: args.ids,
            filters: args.filters,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            reviewedByUserId: args.actor.reviewedByUserId,
            reviewNote: args.reviewNote,
            force: args.force,
            dryRun: args.dryRun,
        });
    }

    countCandidates(
        family: ImportReviewEntityFamilySlug,
        scope: ImportReviewScopeResolved,
        filters: CandidateListFilters
    ) {
        return this.core.countCandidates(family, scope.reviewBatchId, filters);
    }

    listCandidates(
        family: ImportReviewEntityFamilySlug,
        scope: ImportReviewScopeResolved,
        filters: CandidateListFilters
    ) {
        return this.core.listCandidates(family, scope.reviewBatchId, filters);
    }

    getCandidateById(
        family: ImportReviewEntityFamilySlug,
        scope: ImportReviewScopeResolved,
        id: bigint,
        includeGeometry: boolean
    ) {
        return this.core.getCandidateById(family, id, scope.reviewBatchId, includeGeometry);
    }

    fetchCandidateFilterOptions(family: ImportReviewEntityFamilySlug, scope: ImportReviewScopeResolved) {
        return this.core.fetchCandidateFilterOptions(family, scope.reviewBatchId);
    }

    findCandidateReviewContext(
        family: ImportReviewEntityFamilySlug,
        scope: ImportReviewScopeResolved,
        id: bigint
    ): Promise<CandidateReviewGuardContext | null> {
        return this.core.findCandidateReviewContext(family, id, scope.reviewBatchId);
    }

    updateCandidateReviewDecision(args: {
        family: ImportReviewEntityFamilySlug;
        scope: ImportReviewScopeResolved;
        id: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }) {
        return this.core.updateCandidateReviewDecision({
            family: args.family,
            id: args.id,
            reviewBatchId: args.scope.reviewBatchId,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            actor: args.actor,
            reviewNote: args.reviewNote,
        });
    }

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
    }) {
        return this.core.bulkCandidateDecisions({
            family: args.family,
            reviewBatchId: args.scope.reviewBatchId,
            mode: args.mode,
            ids: args.ids,
            filters: args.filters,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            actor: args.actor,
            reviewNote: args.reviewNote,
            force: args.force,
            dryRun: args.dryRun,
        });
    }

    patchCandidateReviewOverrides(args: {
        family: ImportReviewEntityFamilySlug;
        scope: ImportReviewScopeResolved;
        id: bigint;
        overridesPatch: Record<string, unknown>;
        editedByUserId: bigint | null;
        reviewNote: string | null | undefined;
    }) {
        return this.core.patchCandidateReviewOverrides({
            family: args.family,
            id: args.id,
            reviewBatchId: args.scope.reviewBatchId,
            overridesPatch: args.overridesPatch,
            editedByUserId: args.editedByUserId,
            reviewNote: args.reviewNote,
        });
    }
}
