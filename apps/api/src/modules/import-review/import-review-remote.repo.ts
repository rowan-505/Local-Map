import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    ImportReviewBuildingSort,
    ImportReviewBulkFilters,
    ImportReviewBuildingsQuery,
    ImportReviewPlacesQuery,
    ImportReviewRoadsQuery,
} from "./import-review.schema.js";
import type { ImportReviewBulkDecisionRepoResult, ImportReviewBulkSkippedReason } from "./import-review.types.js";
import type {
    BuildingListRowDb,
    ImportReviewRoadCandidatePatchBaselineDb,
    ImportReviewScopeQuery,
    ImportReviewScopeResolved,
    ImportReviewSummaryBucketDb,
    ReviewActor,
} from "./import-review-data-repository.js";
import { resolveImportReviewBatchScope } from "./import-review-batch-resolver.js";
import {
    IMPORT_REVIEW_ENTITY_FAMILIES,
    getImportReviewEntityConfig,
    type ImportReviewEntityFamilySlug,
} from "./import-review-config.js";
import { buildCandidateRowQueryParts, type CandidateListFilters } from "./import-review-candidate-sql.js";
import { buildReviewOverridesMergeExpr } from "./import-review-overrides-merge.js";
import {
    GenericImportReviewCandidateRepository,
    buildSummaryAggregationSql,
} from "./import-review-generic-candidate.repo.js";
import {
    buildFamilySummaryMetricsSql,
    type ImportReviewFamilySummaryMetricsDb,
} from "./import-review-summary-counts.js";

export type { BuildingListRowDb } from "./import-review-data-repository.js";

const BUILDING_ORDER_BY: Record<ImportReviewBuildingSort, Prisma.Sql> = {
    updated_at_desc: Prisma.sql`b.updated_at DESC`,
    updated_at_asc: Prisma.sql`b.updated_at ASC`,
    created_at_desc: Prisma.sql`b.created_at DESC`,
    created_at_asc: Prisma.sql`b.created_at ASC`,
    id_desc: Prisma.sql`b.id DESC`,
    id_asc: Prisma.sql`b.id ASC`,
    confidence_score_desc: Prisma.sql`b.confidence_score DESC NULLS LAST`,
    confidence_score_asc: Prisma.sql`b.confidence_score ASC NULLS LAST`,
    canonical_name_asc: Prisma.sql`b.canonical_name ASC NULLS LAST`,
    canonical_name_desc: Prisma.sql`b.canonical_name DESC NULLS LAST`,
    external_id_asc: Prisma.sql`b.external_id ASC NULLS LAST`,
    external_id_desc: Prisma.sql`b.external_id DESC NULLS LAST`,
};

const PLACE_ORDER_BY: Record<ImportReviewBuildingSort, Prisma.Sql> = {
    updated_at_desc: Prisma.sql`p.updated_at DESC`,
    updated_at_asc: Prisma.sql`p.updated_at ASC`,
    created_at_desc: Prisma.sql`p.created_at DESC`,
    created_at_asc: Prisma.sql`p.created_at ASC`,
    id_desc: Prisma.sql`p.id DESC`,
    id_asc: Prisma.sql`p.id ASC`,
    confidence_score_desc: Prisma.sql`p.confidence_score DESC NULLS LAST`,
    confidence_score_asc: Prisma.sql`p.confidence_score ASC NULLS LAST`,
    canonical_name_asc: Prisma.sql`p.canonical_name ASC NULLS LAST`,
    canonical_name_desc: Prisma.sql`p.canonical_name DESC NULLS LAST`,
    external_id_asc: Prisma.sql`p.external_id ASC NULLS LAST`,
    external_id_desc: Prisma.sql`p.external_id DESC NULLS LAST`,
};

const ROAD_ORDER_BY: Record<ImportReviewBuildingSort, Prisma.Sql> = {
    updated_at_desc: Prisma.sql`r.updated_at DESC`,
    updated_at_asc: Prisma.sql`r.updated_at ASC`,
    created_at_desc: Prisma.sql`r.created_at DESC`,
    created_at_asc: Prisma.sql`r.created_at ASC`,
    id_desc: Prisma.sql`r.id DESC`,
    id_asc: Prisma.sql`r.id ASC`,
    confidence_score_desc: Prisma.sql`r.confidence_score DESC NULLS LAST`,
    confidence_score_asc: Prisma.sql`r.confidence_score ASC NULLS LAST`,
    canonical_name_asc: Prisma.sql`r.canonical_name ASC NULLS LAST`,
    canonical_name_desc: Prisma.sql`r.canonical_name DESC NULLS LAST`,
    external_id_asc: Prisma.sql`r.external_id ASC NULLS LAST`,
    external_id_desc: Prisma.sql`r.external_id DESC NULLS LAST`,
};

type DbClient = PrismaClient | Prisma.TransactionClient;

function sqlBigintArray(ids: bigint[]): Prisma.Sql {
    return Prisma.sql`ARRAY[${Prisma.join(
        ids.map((id) => Prisma.sql`${id}`),
        ", "
    )}]::bigint[]`;
}

/**
 * Index ideas for import-review building lists (add via migrations when needed):
 * - import_review.building_candidates (source_snapshot_id, updated_at DESC) INCLUDE (id) for default list paging.
 * - import_review.building_candidates (source_snapshot_id, match_status) / (source_snapshot_id, review_status) if those filters dominate.
 * - Optional: pg_trgm + GIN on lower(canonical_name), lower(external_id) if case-insensitive substring search becomes hot at scale.
 *
 * Reads/writes Supabase `import_review.*` candidates scoped by `review_batch_id`.
 */
export class RemoteImportReviewRepositoryCore {
    private readonly genericCandidates: GenericImportReviewCandidateRepository;

    constructor(private readonly prisma: PrismaClient) {
        this.genericCandidates = new GenericImportReviewCandidateRepository(prisma);
    }

    private async pgRegclassExists(fullyQualifiedName: string): Promise<boolean> {
        return this.genericCandidates.pgRegclassExists(fullyQualifiedName);
    }

    countCandidates(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint,
        filters: CandidateListFilters
    ): Promise<bigint> {
        return this.genericCandidates.countCandidates(family, reviewBatchId, filters);
    }

    listCandidates(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint,
        filters: CandidateListFilters
    ): Promise<BuildingListRowDb[]> {
        return this.genericCandidates.listCandidates(family, reviewBatchId, filters);
    }

    getCandidateById(
        family: ImportReviewEntityFamilySlug,
        id: bigint,
        reviewBatchId: bigint,
        includeGeometry: boolean
    ): Promise<BuildingListRowDb | null> {
        return this.genericCandidates.getCandidateById(family, reviewBatchId, id, includeGeometry);
    }

    fetchCandidateFilterOptions(family: ImportReviewEntityFamilySlug, reviewBatchId: bigint) {
        return this.genericCandidates.fetchCandidateFilterOptions(family, reviewBatchId);
    }

    findCandidateReviewContext(
        family: ImportReviewEntityFamilySlug,
        id: bigint,
        reviewBatchId: bigint
    ) {
        return this.genericCandidates.findCandidateReviewContext(family, reviewBatchId, id);
    }

    updateCandidateReviewDecision(args: {
        family: ImportReviewEntityFamilySlug;
        id: bigint;
        reviewBatchId: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        return this.genericCandidates.updateCandidateReviewDecision(args);
    }

    patchCandidateReviewOverrides(args: {
        family: ImportReviewEntityFamilySlug;
        id: bigint;
        reviewBatchId: bigint;
        overridesPatch: Record<string, unknown>;
        editedByUserId: bigint | null;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        if (args.family === "buildings") {
            return this.patchBuildingReviewOverrides({
                id: args.id,
                reviewBatchId: args.reviewBatchId,
                overridesPatch: args.overridesPatch,
                editedByUserId: args.editedByUserId,
                reviewNote: args.reviewNote,
            });
        }
        return this.genericCandidates.patchCandidateReviewOverrides({
            family: args.family,
            reviewBatchId: args.reviewBatchId,
            id: args.id,
            overridesPatch: args.overridesPatch,
            editedByUserId: args.editedByUserId,
            reviewNote: args.reviewNote,
        });
    }

    bulkCandidateDecisions(args: {
        family: ImportReviewEntityFamilySlug;
        reviewBatchId: bigint;
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
        return this.genericCandidates.bulkCandidateDecisions({
            family: args.family,
            reviewBatchId: args.reviewBatchId,
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


    async resolveScope(query: ImportReviewScopeQuery): Promise<ImportReviewScopeResolved> {
        return resolveImportReviewBatchScope(this.prisma, query);
    }

    async fetchSummaryBuckets(scope: ImportReviewScopeResolved): Promise<{
        rows: ImportReviewSummaryBucketDb[];
        warnings: string[];
    }> {
        const warnings: string[] = [];
        const parts: Prisma.Sql[] = [];
        const reviewBatchId = scope.reviewBatchId;

        for (const family of IMPORT_REVIEW_ENTITY_FAMILIES) {
            const config = getImportReviewEntityConfig(family);
            const tableName = `import_review.${config.importReviewTable}`;
            if (await this.pgRegclassExists(tableName)) {
                parts.push(buildSummaryAggregationSql(config, reviewBatchId));
            } else {
                warnings.push(
                    `Summary skipped optional family ${family}: table ${tableName} not found.`
                );
            }
        }

        if (parts.length === 0) {
            return { rows: [], warnings };
        }

        const rows = await this.prisma.$queryRaw<ImportReviewSummaryBucketDb[]>(
            Prisma.join(parts, " UNION ALL ")
        );
        return { rows, warnings };
    }

    async fetchFamilySummaryMetrics(scope: ImportReviewScopeResolved): Promise<{
        rows: ImportReviewFamilySummaryMetricsDb[];
        warnings: string[];
    }> {
        const warnings: string[] = [];
        const parts: Prisma.Sql[] = [];
        const reviewBatchId = scope.reviewBatchId;

        for (const family of IMPORT_REVIEW_ENTITY_FAMILIES) {
            const config = getImportReviewEntityConfig(family);
            const tableName = `import_review.${config.importReviewTable}`;
            if (await this.pgRegclassExists(tableName)) {
                parts.push(buildFamilySummaryMetricsSql(config, reviewBatchId));
            } else {
                warnings.push(
                    `Family metrics skipped optional family ${family}: table ${tableName} not found.`
                );
            }
        }

        if (parts.length === 0) {
            return { rows: [], warnings };
        }

        const rows = await this.prisma.$queryRaw<ImportReviewFamilySummaryMetricsDb[]>(
            Prisma.join(parts, " UNION ALL ")
        );
        return { rows, warnings };
    }

    async fetchBuildingFilterOptions(reviewBatchId: bigint): Promise<{
        match_status: string[];
        auto_action: string[];
        review_status: string[];
        review_decision: string[];
        class_code: string[];
        promotion_status: string[];
    }> {
        const opts = await this.fetchCandidateFilterOptions("buildings", reviewBatchId);
        return {
            match_status: opts.match_status ?? [],
            auto_action: opts.auto_action ?? [],
            review_status: opts.review_status ?? [],
            review_decision: opts.review_decision ?? [],
            class_code: opts.class_code ?? [],
            promotion_status: opts.promotion_status ?? [],
        };
    }

    private buildingListWhereClause(
        reviewBatchId: bigint,
        filters: Pick<
            ImportReviewBuildingsQuery,
            | "match_status"
            | "auto_action"
            | "review_status"
            | "review_decision"
            | "class_code"
            | "promotion_status"
            | "q"
        > & { include_promoted?: boolean }
    ): Prisma.Sql {
        const UNREVIEWED = "__unreviewed__";
        const parts: Prisma.Sql[] = [
            Prisma.sql`b.review_batch_id = ${reviewBatchId}`,
            Prisma.sql`b.entity_family = 'buildings'`,
        ];

        if (!filters.include_promoted && filters.promotion_status === undefined) {
            parts.push(
                Prisma.sql`b.promotion_status IS DISTINCT FROM 'promoted'`,
                Prisma.sql`b.review_status IS DISTINCT FROM 'promoted'`
            );
        }

        if (filters.match_status !== undefined) {
            parts.push(Prisma.sql`b.match_status = ${filters.match_status}`);
        }

        if (filters.auto_action !== undefined) {
            parts.push(Prisma.sql`b.auto_action = ${filters.auto_action}`);
        }

        if (filters.review_status !== undefined) {
            if (filters.review_status === UNREVIEWED) {
                parts.push(
                    Prisma.sql`(b.review_status IS NULL OR trim(coalesce(b.review_status, '')) = '')`
                );
            } else {
                parts.push(Prisma.sql`b.review_status = ${filters.review_status}`);
            }
        }

        if (filters.review_decision !== undefined) {
            if (filters.review_decision === UNREVIEWED) {
                parts.push(
                    Prisma.sql`(b.review_decision IS NULL OR trim(coalesce(b.review_decision, '')) = '')`
                );
            } else {
                parts.push(Prisma.sql`b.review_decision = ${filters.review_decision}`);
            }
        }

        if (filters.promotion_status !== undefined) {
            if (filters.promotion_status === UNREVIEWED) {
                parts.push(
                    Prisma.sql`(b.promotion_status IS NULL OR trim(coalesce(b.promotion_status, '')) = '')`
                );
            } else {
                parts.push(Prisma.sql`b.promotion_status = ${filters.promotion_status}`);
            }
        }

        if (filters.class_code !== undefined) {
            parts.push(Prisma.sql`b.class_code = ${filters.class_code}`);
        }

        if (filters.q !== undefined) {
            const t = filters.q;
            parts.push(
                Prisma.sql`(strpos(lower(b.external_id), lower(${t})) > 0 OR strpos(lower(coalesce(b.canonical_name, '')), lower(${t})) > 0)`
            );
        }

        return Prisma.join(parts, " AND ");
    }

    private placeListWhereClause(
        reviewBatchId: bigint,
        filters: Pick<
            ImportReviewPlacesQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ): Prisma.Sql {
        const UNREVIEWED = "__unreviewed__";
        const parts: Prisma.Sql[] = [
            Prisma.sql`p.review_batch_id = ${reviewBatchId}`,
            Prisma.sql`p.entity_family = 'places'`,
        ];

        if (filters.match_status !== undefined) {
            parts.push(Prisma.sql`p.match_status = ${filters.match_status}`);
        }

        if (filters.auto_action !== undefined) {
            parts.push(Prisma.sql`p.auto_action = ${filters.auto_action}`);
        }

        if (filters.review_status !== undefined) {
            if (filters.review_status === UNREVIEWED) {
                parts.push(
                    Prisma.sql`(p.review_status IS NULL OR trim(coalesce(p.review_status, '')) = '')`
                );
            } else {
                parts.push(Prisma.sql`p.review_status = ${filters.review_status}`);
            }
        }

        if (filters.review_decision !== undefined) {
            if (filters.review_decision === UNREVIEWED) {
                parts.push(
                    Prisma.sql`(p.review_decision IS NULL OR trim(coalesce(p.review_decision, '')) = '')`
                );
            } else {
                parts.push(Prisma.sql`p.review_decision = ${filters.review_decision}`);
            }
        }

        if (filters.q !== undefined) {
            const t = filters.q;
            parts.push(
                Prisma.sql`(strpos(lower(p.external_id), lower(${t})) > 0 OR strpos(lower(coalesce(p.canonical_name, '')), lower(${t})) > 0)`
            );
        }

        return Prisma.join(parts, " AND ");
    }

    private roadListWhereClause(
        reviewBatchId: bigint,
        filters: Pick<
            ImportReviewRoadsQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ): Prisma.Sql {
        const UNREVIEWED = "__unreviewed__";
        const parts: Prisma.Sql[] = [
            Prisma.sql`r.review_batch_id = ${reviewBatchId}`,
            Prisma.sql`r.entity_family = 'roads'`,
        ];

        if (filters.match_status !== undefined) {
            parts.push(Prisma.sql`r.match_status = ${filters.match_status}`);
        }

        if (filters.auto_action !== undefined) {
            parts.push(Prisma.sql`r.auto_action = ${filters.auto_action}`);
        }

        if (filters.review_status !== undefined) {
            if (filters.review_status === UNREVIEWED) {
                parts.push(
                    Prisma.sql`(r.review_status IS NULL OR trim(coalesce(r.review_status, '')) = '')`
                );
            } else {
                parts.push(Prisma.sql`r.review_status = ${filters.review_status}`);
            }
        }

        if (filters.review_decision !== undefined) {
            if (filters.review_decision === UNREVIEWED) {
                parts.push(
                    Prisma.sql`(r.review_decision IS NULL OR trim(coalesce(r.review_decision, '')) = '')`
                );
            } else {
                parts.push(Prisma.sql`r.review_decision = ${filters.review_decision}`);
            }
        }

        if (filters.q !== undefined) {
            const t = filters.q;
            parts.push(
                Prisma.sql`(strpos(lower(r.external_id), lower(${t})) > 0 OR strpos(lower(coalesce(r.canonical_name, '')), lower(${t})) > 0)`
            );
        }

        return Prisma.join(parts, " AND ");
    }

    async countBuildingCandidates(
        reviewBatchId: bigint,
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
    ): Promise<bigint> {
        return this.countCandidates("buildings", reviewBatchId, filters);
    }

    async listBuildingCandidates(
        reviewBatchId: bigint,
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
    ): Promise<BuildingListRowDb[]> {
        return this.listCandidates("buildings", reviewBatchId, filters);
    }

    async getBuildingCandidateById(
        id: bigint,
        reviewBatchId: bigint,
        includeGeometry: boolean
    ): Promise<BuildingListRowDb | null> {
        return this.getCandidateById("buildings", id, reviewBatchId, includeGeometry);
    }

    async findBuildingCandidateReviewContext(
        id: bigint,
        reviewBatchId: bigint
    ): Promise<{ match_status: string | null; auto_action: string | null; promotion_status: string | null } | null> {
        return this.findCandidateReviewContext("buildings", id, reviewBatchId);
    }

    async updateBuildingReviewDecision(args: {
        id: bigint;
        reviewBatchId: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        return this.updateCandidateReviewDecision({ family: "buildings", ...args });
    }

    async countPlaceCandidates(
        reviewBatchId: bigint,
        filters: Pick<
            ImportReviewPlacesQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ): Promise<bigint> {
        return this.countCandidates("places", reviewBatchId, filters);
    }

    async listPlaceCandidates(
        reviewBatchId: bigint,
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
    ): Promise<BuildingListRowDb[]> {
        return this.listCandidates("places", reviewBatchId, filters);
    }

    async findPlaceCandidateReviewContext(
        id: bigint,
        reviewBatchId: bigint
    ): Promise<{ match_status: string | null; auto_action: string | null; promotion_status: string | null } | null> {
        return this.findCandidateReviewContext("places", id, reviewBatchId);
    }

    async updatePlaceReviewDecision(args: {
        id: bigint;
        reviewBatchId: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        return this.updateCandidateReviewDecision({ family: "places", ...args });
    }

    async countRoadCandidates(
        reviewBatchId: bigint,
        filters: Pick<
            ImportReviewRoadsQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ): Promise<bigint> {
        return this.countCandidates("roads", reviewBatchId, filters);
    }

    async listRoadCandidates(
        reviewBatchId: bigint,
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
    ): Promise<BuildingListRowDb[]> {
        return this.listCandidates("roads", reviewBatchId, filters);
    }

    async findRoadCandidateReviewContext(
        id: bigint,
        reviewBatchId: bigint
    ): Promise<{
        match_status: string | null;
        auto_action: string | null;
        promotion_status: string | null;
        validation_warnings: unknown;
        validation_errors: unknown;
    } | null> {
        const rows = await this.prisma.$queryRaw<
            {
                match_status: string | null;
                auto_action: string | null;
                promotion_status: string | null;
                validation_warnings: unknown;
                validation_errors: unknown;
            }[]
        >`
            SELECT
                r.match_status,
                r.auto_action,
                r.promotion_status,
                r.validation_warnings,
                r.validation_errors
            FROM import_review.road_candidates AS r
            WHERE r.id = ${id} AND (r.review_batch_id = ${reviewBatchId} AND r.entity_family = 'roads')
            LIMIT 1
        `;
        const row = rows[0];
        return row === undefined ? null : row;
    }

    async fetchRoadCandidatePatchBaseline(id: bigint, reviewBatchId: bigint): Promise<ImportReviewRoadCandidatePatchBaselineDb | null> {
        const rows = await this.prisma.$queryRaw<ImportReviewRoadCandidatePatchBaselineDb[]>`
            SELECT
                r.id,
                r.promotion_status,
                r.canonical_name,
                r.road_class_id,
                r.road_class,
                r.surface,
                r.is_oneway,
                CASE
                    WHEN r.geom IS NOT NULL THEN ST_AsGeoJSON(r.geom)::json
                    ELSE NULL::json
                END AS geom_geojson,
                COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb) AS review_overrides,
                r.normalized_data,
                r.class_code,
                r.matched_core_table,
                r.matched_core_id,
                r.review_note
            FROM import_review.road_candidates AS r
            WHERE r.id = ${id}
              AND r.review_batch_id = ${reviewBatchId}
              AND r.entity_family = 'roads'
            LIMIT 1
        `;
        const row = rows[0];
        return row === undefined ? null : row;
    }

    async fetchRoadCandidateRoutingValidationRow(
        id: bigint,
        reviewBatchId: bigint
    ): Promise<import("./import-review-road-routing-validation.js").ImportReviewRoadRoutingValidationRow | null> {
        const rows = await this.prisma.$queryRaw<
            import("./import-review-road-routing-validation.js").ImportReviewRoadRoutingValidationRow[]
        >`
            SELECT
                r.id,
                r.review_batch_id,
                r.external_id,
                r.canonical_name,
                r.road_class_id,
                r.road_class,
                r.class_code,
                r.surface,
                r.is_oneway,
                CASE WHEN r.geom IS NOT NULL THEN ST_AsGeoJSON(r.geom)::json ELSE NULL::json END AS geom_geojson,
                COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb) AS review_overrides,
                r.normalized_data,
                r.matched_core_table,
                r.matched_core_id,
                r.review_note,
                r.review_status,
                r.review_decision,
                NULL::json AS boundary_geom
            FROM import_review.road_candidates AS r
            WHERE r.id = ${id}
              AND r.review_batch_id = ${reviewBatchId}
              AND r.entity_family = 'roads'
            LIMIT 1
        `;
        const row = rows[0];
        return row === undefined ? null : row;
    }

    async persistRoadRoutingValidation(args: {
        id: bigint;
        reviewBatchId: bigint;
        validation_errors_json: unknown;
        validation_warnings_json: unknown;
        review_status: string;
        validation_summary: Record<string, unknown>;
        length_m: number | null;
    }): Promise<BuildingListRowDb | null> {
        const errorsJson = JSON.stringify(args.validation_errors_json);
        const warningsJson = JSON.stringify(args.validation_warnings_json);
        const summaryJson = JSON.stringify(args.validation_summary);
        const roadsConfig = getImportReviewEntityConfig("roads");
        const rowParts = buildCandidateRowQueryParts(roadsConfig, true);
        const lengthSet =
            args.length_m === null
                ? Prisma.sql`length_m = NULL`
                : Prisma.sql`length_m = ${args.length_m}::numeric`;

        const rows = await this.prisma.$queryRaw<BuildingListRowDb[]>`
            WITH updated AS (
                UPDATE import_review.road_candidates AS r
                SET
                    validation_errors = ${errorsJson}::jsonb,
                    validation_warnings = ${warningsJson}::jsonb,
                    review_status = ${args.review_status},
                    review_overrides = COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb)
                        || jsonb_build_object('validation_summary', ${summaryJson}::jsonb),
                    ${lengthSet},
                    updated_at = now()
                WHERE r.id = ${args.id}
                  AND r.review_batch_id = ${args.reviewBatchId}
                  AND r.entity_family = 'roads'
                RETURNING r.id
            )
            SELECT ${rowParts.select}
            FROM ${rowParts.from}
            INNER JOIN updated AS u ON r.id = u.id
        `;
        return rows[0] ?? null;
    }

    async patchRoadCandidateReviewOverrides(args: {
        id: bigint;
        reviewBatchId: bigint;
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
    }): Promise<BuildingListRowDb | null> {
        const merge = JSON.stringify(args.merged_review_overrides);
        const warningsJson = JSON.stringify(args.validation_warnings_json);
        const errorsJson = JSON.stringify(args.validation_errors_json);
        const auditSupported = await this.pgRegclassExists("import_review.review_candidate_edits");
        const roadsConfig = getImportReviewEntityConfig("roads");
        const rowParts = buildCandidateRowQueryParts(roadsConfig, true);

        return this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<{ review_overrides: unknown }[]>`
                SELECT COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb) AS review_overrides
                  FROM import_review.road_candidates AS r
                 WHERE r.id = ${args.id}
                   AND r.review_batch_id = ${args.reviewBatchId}
                   AND r.entity_family = 'roads'
                 FOR UPDATE
            `;
            const before = locked[0];
            if (before === undefined) {
                return null;
            }

            const geomSet =
                args.normalized_geom_geojson === null || args.normalized_geom_geojson === ""
                    ? null
                    : Prisma.sql`ST_Multi(ST_LineMerge(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${args.normalized_geom_geojson}::json), 4326)), 2)))`;

            const setPieces: Prisma.Sql[] = [
                Prisma.sql`review_overrides = COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb) || ${merge}::jsonb`,
                Prisma.sql`canonical_name = ${args.canonical_name}`,
                Prisma.sql`road_class_id = ${args.road_class_id}`,
                Prisma.sql`road_class = ${args.road_class_label}`,
                Prisma.sql`surface = ${args.surface}`,
                Prisma.sql`is_oneway = ${args.is_oneway}`,
                Prisma.sql`validation_warnings = ${warningsJson}::jsonb`,
                Prisma.sql`validation_errors = ${errorsJson}::jsonb`,
                Prisma.sql`updated_at = now()`,
            ];
            if (geomSet !== null) {
                setPieces.push(Prisma.sql`geom = ${geomSet}`);
                setPieces.push(
                    Prisma.sql`length_m = ROUND(ST_Length(${geomSet}::geography)::numeric, 2)`
                );
            }
            if (args.reviewNote !== undefined) {
                setPieces.push(Prisma.sql`review_note = ${args.reviewNote}`);
            }
            const updateSetClause = Prisma.join(setPieces, ", ");

            const rows = await tx.$queryRaw<BuildingListRowDb[]>`
                WITH updated AS (
                    UPDATE import_review.road_candidates AS r
                       SET ${updateSetClause}
                     WHERE r.id = ${args.id}
                       AND r.review_batch_id = ${args.reviewBatchId}
                       AND r.entity_family = 'roads'
                    RETURNING r.id
                )
                SELECT ${rowParts.select}
                FROM ${rowParts.from}
                INNER JOIN updated AS u ON r.id = u.id
            `;

            const updated = rows[0];
            if (updated === undefined) {
                return null;
            }

            if (auditSupported) {
                const beforeJson = JSON.stringify({ review_overrides: before.review_overrides ?? {} });
                const afterJson = JSON.stringify({ review_overrides: updated.review_overrides ?? {} });
                await tx.$executeRaw`
                    INSERT INTO import_review.review_candidate_edits (
                        review_batch_id,
                        entity_family,
                        candidate_table,
                        candidate_id,
                        edited_by,
                        edit_type,
                        before_data,
                        after_data
                    )
                    VALUES (
                        ${args.reviewBatchId},
                        'roads',
                        'road_candidates',
                        ${args.id},
                        ${args.editedByUserId},
                        'override_update',
                        ${beforeJson}::jsonb,
                        ${afterJson}::jsonb
                    )
                `;
            }

            return updated;
        });
    }

    async updateRoadReviewDecision(args: {
        id: bigint;
        reviewBatchId: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        return this.updateCandidateReviewDecision({ family: "roads", ...args });
    }

    async lookupRefRoadClassById(id: bigint): Promise<{ id: bigint; code: string } | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint; code: string }[]>`
            SELECT rc.id, rc.code
              FROM ref.ref_road_classes AS rc
             WHERE rc.id = ${id}
             LIMIT 1
        `;
        const row = rows[0];
        return row === undefined ? null : row;
    }

    async lookupRefRoadClassByCode(normalizedLowerCode: string): Promise<{ id: bigint; code: string } | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint; code: string }[]>`
            SELECT rc.id, rc.code
              FROM ref.ref_road_classes AS rc
             WHERE lower(rc.code) = ${normalizedLowerCode}
             ORDER BY rc.id ASC
             LIMIT 2
        `;
        if (rows.length !== 1) {
            return null;
        }
        return rows[0] ?? null;
    }

    private buildBulkModeBWhere(reviewBatchId: bigint, filters: ImportReviewBulkFilters): Prisma.Sql {
        const parts: Prisma.Sql[] = [Prisma.sql`(b.review_batch_id = ${reviewBatchId} AND b.entity_family = 'buildings')`];

        if (filters.match_status !== undefined) {
            parts.push(Prisma.sql`b.match_status = ${filters.match_status}`);
        }
        if (filters.auto_action !== undefined) {
            parts.push(Prisma.sql`b.auto_action = ${filters.auto_action}`);
        }
        if (filters.review_decision === null) {
            parts.push(Prisma.sql`b.review_decision IS NULL`);
        } else if (filters.review_decision !== undefined) {
            parts.push(Prisma.sql`b.review_decision = ${filters.review_decision}`);
        }

        return Prisma.join(parts, " AND ");
    }

    private buildBulkModeBWherePlaces(reviewBatchId: bigint, filters: ImportReviewBulkFilters): Prisma.Sql {
        const parts: Prisma.Sql[] = [Prisma.sql`(p.review_batch_id = ${reviewBatchId} AND p.entity_family = 'places')`];

        if (filters.match_status !== undefined) {
            parts.push(Prisma.sql`p.match_status = ${filters.match_status}`);
        }
        if (filters.auto_action !== undefined) {
            parts.push(Prisma.sql`p.auto_action = ${filters.auto_action}`);
        }
        if (filters.review_decision === null) {
            parts.push(Prisma.sql`p.review_decision IS NULL`);
        } else if (filters.review_decision !== undefined) {
            parts.push(Prisma.sql`p.review_decision = ${filters.review_decision}`);
        }

        return Prisma.join(parts, " AND ");
    }

    private buildBulkModeBWhereRoads(reviewBatchId: bigint, filters: ImportReviewBulkFilters): Prisma.Sql {
        const parts: Prisma.Sql[] = [Prisma.sql`(r.review_batch_id = ${reviewBatchId} AND r.entity_family = 'roads')`];

        if (filters.match_status !== undefined) {
            parts.push(Prisma.sql`r.match_status = ${filters.match_status}`);
        }
        if (filters.auto_action !== undefined) {
            parts.push(Prisma.sql`r.auto_action = ${filters.auto_action}`);
        }
        if (filters.review_decision === null) {
            parts.push(Prisma.sql`r.review_decision IS NULL`);
        } else if (filters.review_decision !== undefined) {
            parts.push(Prisma.sql`r.review_decision = ${filters.review_decision}`);
        }

        return Prisma.join(parts, " AND ");
    }

    private buildBulkUpdateSetClause(args: {
        reviewDecision: string;
        reviewStatus: string;
        reviewedByUserId: bigint | null;
        reviewNote: string | null | undefined;
    }): Prisma.Sql {
        const sets: Prisma.Sql[] = [
            Prisma.sql`review_decision = ${args.reviewDecision}`,
            Prisma.sql`review_status = ${args.reviewStatus}`,
            Prisma.sql`reviewed_at = now()`,
            Prisma.sql`updated_at = now()`,
        ];
        if (args.reviewedByUserId !== null) {
            sets.push(Prisma.sql`reviewed_by = ${args.reviewedByUserId}`);
        } else {
            sets.push(Prisma.sql`reviewed_by = NULL`);
        }

        if (args.reviewNote !== undefined) {
            sets.push(Prisma.sql`review_note = ${args.reviewNote}`);
        }

        return Prisma.join(sets, ", ");
    }

    private bucketsToSkippedReasons(buckets: Map<string, bigint>): ImportReviewBulkSkippedReason[] {
        const out: ImportReviewBulkSkippedReason[] = [];

        for (const [reason, count] of buckets) {
            if (reason === "eligible") {
                continue;
            }
            const n = Number(count);
            if (n > 0) {
                out.push({ reason, count: n });
            }
        }

        out.sort((a, b) => a.reason.localeCompare(b.reason));
        return out;
    }

    private async bulkClassifyByIds(
        tx: DbClient,
        reviewBatchId: bigint,
        ids: bigint[],
        reviewDecision: string,
        force: boolean
    ): Promise<Map<string, bigint>> {
        const idArray = sqlBigintArray(ids);
        const rows = await tx.$queryRaw<{ bucket: string; c: bigint }[]>`
            WITH requested AS (
                SELECT DISTINCT x.id
                FROM unnest(${idArray}) AS x(id)
            ),
            joined AS (
                SELECT
                    r.id,
                    CASE
                        WHEN b.id IS NULL THEN 'not_found'
                        WHEN b.promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (b.match_status = 'manual_protected' OR b.auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN b.match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            b.match_status = 'new_auto' AND b.auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM requested AS r
                LEFT JOIN import_review.building_candidates AS b
                    ON b.id = r.id AND (b.review_batch_id = ${reviewBatchId} AND b.entity_family = 'buildings')
            )
            SELECT bucket, count(*)::bigint AS c
            FROM joined
            GROUP BY bucket
        `;

        return new Map(rows.map((r) => [r.bucket, r.c]));
    }

    private async bulkClassifyByFilters(
        tx: DbClient,
        reviewBatchId: bigint,
        filters: ImportReviewBulkFilters,
        reviewDecision: string,
        force: boolean
    ): Promise<Map<string, bigint>> {
        const whereFiltered = this.buildBulkModeBWhere(reviewBatchId, filters);
        const rows = await tx.$queryRaw<{ bucket: string; c: bigint }[]>`
            WITH candidates AS (
                SELECT b.id, b.match_status, b.auto_action, b.promotion_status
                FROM import_review.building_candidates AS b
                WHERE ${whereFiltered}
            ),
            classified AS (
                SELECT
                    id,
                    CASE
                        WHEN promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (match_status = 'manual_protected' OR auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            match_status = 'new_auto' AND auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM candidates
            )
            SELECT bucket, count(*)::bigint AS c
            FROM classified
            GROUP BY bucket
        `;

        return new Map(rows.map((r) => [r.bucket, r.c]));
    }

    private async bulkApplyByIds(
        tx: DbClient,
        reviewBatchId: bigint,
        ids: bigint[],
        reviewDecision: string,
        reviewStatus: string,
        reviewedByUserId: bigint | null,
        reviewNote: string | null | undefined,
        force: boolean
    ): Promise<number> {
        const setClause = this.buildBulkUpdateSetClause({
            reviewDecision,
            reviewStatus,
            reviewedByUserId,
            reviewNote,
        });
        const idArray = sqlBigintArray(ids);
        const rows = await tx.$queryRaw<{ id: bigint }[]>`
            WITH requested AS (
                SELECT DISTINCT x.id
                FROM unnest(${idArray}) AS x(id)
            ),
            joined AS (
                SELECT
                    r.id,
                    CASE
                        WHEN b.id IS NULL THEN 'not_found'
                        WHEN b.promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (b.match_status = 'manual_protected' OR b.auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN b.match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            b.match_status = 'new_auto' AND b.auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM requested AS r
                LEFT JOIN import_review.building_candidates AS b
                    ON b.id = r.id AND (b.review_batch_id = ${reviewBatchId} AND b.entity_family = 'buildings')
            ),
            eligible AS (SELECT id FROM joined WHERE bucket = 'eligible')
            UPDATE import_review.building_candidates AS b
            SET ${setClause}
            FROM eligible AS e
            WHERE b.id = e.id AND (b.review_batch_id = ${reviewBatchId} AND b.entity_family = 'buildings')
            RETURNING b.id
        `;

        return rows.length;
    }

    private async bulkApplyByFilters(
        tx: DbClient,
        reviewBatchId: bigint,
        filters: ImportReviewBulkFilters,
        reviewDecision: string,
        reviewStatus: string,
        reviewedByUserId: bigint | null,
        reviewNote: string | null | undefined,
        force: boolean
    ): Promise<number> {
        const setClause = this.buildBulkUpdateSetClause({
            reviewDecision,
            reviewStatus,
            reviewedByUserId,
            reviewNote,
        });
        const whereFiltered = this.buildBulkModeBWhere(reviewBatchId, filters);
        const rows = await tx.$queryRaw<{ id: bigint }[]>`
            WITH candidates AS (
                SELECT b.id, b.match_status, b.auto_action, b.promotion_status
                FROM import_review.building_candidates AS b
                WHERE ${whereFiltered}
            ),
            classified AS (
                SELECT
                    id,
                    CASE
                        WHEN promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (match_status = 'manual_protected' OR auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            match_status = 'new_auto' AND auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM candidates
            ),
            eligible AS (SELECT id FROM classified WHERE bucket = 'eligible')
            UPDATE import_review.building_candidates AS b
            SET ${setClause}
            FROM eligible AS e
            WHERE b.id = e.id AND (b.review_batch_id = ${reviewBatchId} AND b.entity_family = 'buildings')
            RETURNING b.id
        `;

        return rows.length;
    }

    async bulkBuildingDecisions(args: {
        reviewBatchId: bigint;
        mode: "ids" | "filters";
        ids?: bigint[];
        filters?: ImportReviewBulkFilters;
        reviewDecision: string;
        reviewStatus: string;
        reviewedByUserId: bigint | null;
        reviewNote: string | null | undefined;
        force: boolean;
        dryRun: boolean;
    }): Promise<ImportReviewBulkDecisionRepoResult> {
        return this.genericCandidates.bulkCandidateDecisions({
            family: "buildings",
            reviewBatchId: args.reviewBatchId,
            mode: args.mode,
            ids: args.ids,
            filters: args.filters,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            reviewedByUserId: args.reviewedByUserId,
            reviewNote: args.reviewNote,
            force: args.force,
            dryRun: args.dryRun,
        });
    }

    private async bulkClassifyByIdsPlaces(
        tx: DbClient,
        reviewBatchId: bigint,
        ids: bigint[],
        reviewDecision: string,
        force: boolean
    ): Promise<Map<string, bigint>> {
        const idArray = sqlBigintArray(ids);
        const rows = await tx.$queryRaw<{ bucket: string; c: bigint }[]>`
            WITH requested AS (
                SELECT DISTINCT x.id
                FROM unnest(${idArray}) AS x(id)
            ),
            joined AS (
                SELECT
                    req.id,
                    CASE
                        WHEN p.id IS NULL THEN 'not_found'
                        WHEN p.promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (p.match_status = 'manual_protected' OR p.auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN p.match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            p.match_status = 'new_auto' AND p.auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM requested AS req
                LEFT JOIN import_review.place_candidates AS p
                    ON p.id = req.id AND (p.review_batch_id = ${reviewBatchId} AND p.entity_family = 'places')
            )
            SELECT bucket, count(*)::bigint AS c
            FROM joined
            GROUP BY bucket
        `;

        return new Map(rows.map((r) => [r.bucket, r.c]));
    }

    private async bulkClassifyByFiltersPlaces(
        tx: DbClient,
        reviewBatchId: bigint,
        filters: ImportReviewBulkFilters,
        reviewDecision: string,
        force: boolean
    ): Promise<Map<string, bigint>> {
        const whereFiltered = this.buildBulkModeBWherePlaces(reviewBatchId, filters);
        const rows = await tx.$queryRaw<{ bucket: string; c: bigint }[]>`
            WITH candidates AS (
                SELECT p.id, p.match_status, p.auto_action, p.promotion_status
                FROM import_review.place_candidates AS p
                WHERE ${whereFiltered}
            ),
            classified AS (
                SELECT
                    id,
                    CASE
                        WHEN promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (match_status = 'manual_protected' OR auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            match_status = 'new_auto' AND auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM candidates
            )
            SELECT bucket, count(*)::bigint AS c
            FROM classified
            GROUP BY bucket
        `;

        return new Map(rows.map((r) => [r.bucket, r.c]));
    }

    private async bulkApplyByIdsPlaces(
        tx: DbClient,
        reviewBatchId: bigint,
        ids: bigint[],
        reviewDecision: string,
        reviewStatus: string,
        reviewedByUserId: bigint | null,
        reviewNote: string | null | undefined,
        force: boolean
    ): Promise<number> {
        const setClause = this.buildBulkUpdateSetClause({
            reviewDecision,
            reviewStatus,
            reviewedByUserId,
            reviewNote,
        });
        const idArray = sqlBigintArray(ids);
        const rows = await tx.$queryRaw<{ id: bigint }[]>`
            WITH requested AS (
                SELECT DISTINCT x.id
                FROM unnest(${idArray}) AS x(id)
            ),
            joined AS (
                SELECT
                    req.id,
                    CASE
                        WHEN p.id IS NULL THEN 'not_found'
                        WHEN p.promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (p.match_status = 'manual_protected' OR p.auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN p.match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            p.match_status = 'new_auto' AND p.auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM requested AS req
                LEFT JOIN import_review.place_candidates AS p
                    ON p.id = req.id AND (p.review_batch_id = ${reviewBatchId} AND p.entity_family = 'places')
            ),
            eligible AS (SELECT id FROM joined WHERE bucket = 'eligible')
            UPDATE import_review.place_candidates AS p
            SET ${setClause}
            FROM eligible AS e
            WHERE p.id = e.id AND (p.review_batch_id = ${reviewBatchId} AND p.entity_family = 'places')
            RETURNING p.id
        `;

        return rows.length;
    }

    private async bulkApplyByFiltersPlaces(
        tx: DbClient,
        reviewBatchId: bigint,
        filters: ImportReviewBulkFilters,
        reviewDecision: string,
        reviewStatus: string,
        reviewedByUserId: bigint | null,
        reviewNote: string | null | undefined,
        force: boolean
    ): Promise<number> {
        const setClause = this.buildBulkUpdateSetClause({
            reviewDecision,
            reviewStatus,
            reviewedByUserId,
            reviewNote,
        });
        const whereFiltered = this.buildBulkModeBWherePlaces(reviewBatchId, filters);
        const rows = await tx.$queryRaw<{ id: bigint }[]>`
            WITH candidates AS (
                SELECT p.id, p.match_status, p.auto_action, p.promotion_status
                FROM import_review.place_candidates AS p
                WHERE ${whereFiltered}
            ),
            classified AS (
                SELECT
                    id,
                    CASE
                        WHEN promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (match_status = 'manual_protected' OR auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            match_status = 'new_auto' AND auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM candidates
            ),
            eligible AS (SELECT id FROM classified WHERE bucket = 'eligible')
            UPDATE import_review.place_candidates AS p
            SET ${setClause}
            FROM eligible AS e
            WHERE p.id = e.id AND (p.review_batch_id = ${reviewBatchId} AND p.entity_family = 'places')
            RETURNING p.id
        `;

        return rows.length;
    }

    private async bulkClassifyByIdsRoads(
        tx: DbClient,
        reviewBatchId: bigint,
        ids: bigint[],
        reviewDecision: string,
        force: boolean
    ): Promise<Map<string, bigint>> {
        const idArray = sqlBigintArray(ids);
        const rows = await tx.$queryRaw<{ bucket: string; c: bigint }[]>`
            WITH requested AS (
                SELECT DISTINCT x.id
                FROM unnest(${idArray}) AS x(id)
            ),
            joined AS (
                SELECT
                    req.id,
                    CASE
                        WHEN rd.id IS NULL THEN 'not_found'
                        WHEN rd.promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (rd.match_status = 'manual_protected' OR rd.auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN rd.match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            rd.match_status = 'new_auto' AND rd.auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM requested AS req
                LEFT JOIN import_review.road_candidates AS rd
                    ON rd.id = req.id AND (rd.review_batch_id = ${reviewBatchId} AND rd.entity_family = 'roads')
            )
            SELECT bucket, count(*)::bigint AS c
            FROM joined
            GROUP BY bucket
        `;

        return new Map(rows.map((r) => [r.bucket, r.c]));
    }

    private async bulkClassifyByFiltersRoads(
        tx: DbClient,
        reviewBatchId: bigint,
        filters: ImportReviewBulkFilters,
        reviewDecision: string,
        force: boolean
    ): Promise<Map<string, bigint>> {
        const whereFiltered = this.buildBulkModeBWhereRoads(reviewBatchId, filters);
        const rows = await tx.$queryRaw<{ bucket: string; c: bigint }[]>`
            WITH candidates AS (
                SELECT r.id, r.match_status, r.auto_action, r.promotion_status
                FROM import_review.road_candidates AS r
                WHERE ${whereFiltered}
            ),
            classified AS (
                SELECT
                    id,
                    CASE
                        WHEN promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (match_status = 'manual_protected' OR auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            match_status = 'new_auto' AND auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM candidates
            )
            SELECT bucket, count(*)::bigint AS c
            FROM classified
            GROUP BY bucket
        `;

        return new Map(rows.map((r) => [r.bucket, r.c]));
    }

    private async bulkApplyByIdsRoads(
        tx: DbClient,
        reviewBatchId: bigint,
        ids: bigint[],
        reviewDecision: string,
        reviewStatus: string,
        reviewedByUserId: bigint | null,
        reviewNote: string | null | undefined,
        force: boolean
    ): Promise<number> {
        const setClause = this.buildBulkUpdateSetClause({
            reviewDecision,
            reviewStatus,
            reviewedByUserId,
            reviewNote,
        });
        const idArray = sqlBigintArray(ids);
        const rows = await tx.$queryRaw<{ id: bigint }[]>`
            WITH requested AS (
                SELECT DISTINCT x.id
                FROM unnest(${idArray}) AS x(id)
            ),
            joined AS (
                SELECT
                    req.id,
                    CASE
                        WHEN rd.id IS NULL THEN 'not_found'
                        WHEN rd.promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (rd.match_status = 'manual_protected' OR rd.auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN rd.match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            rd.match_status = 'new_auto' AND rd.auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM requested AS req
                LEFT JOIN import_review.road_candidates AS rd
                    ON rd.id = req.id AND (rd.review_batch_id = ${reviewBatchId} AND rd.entity_family = 'roads')
            ),
            eligible AS (SELECT id FROM joined WHERE bucket = 'eligible')
            UPDATE import_review.road_candidates AS r
            SET ${setClause}
            FROM eligible AS e
            WHERE r.id = e.id AND (r.review_batch_id = ${reviewBatchId} AND r.entity_family = 'roads')
            RETURNING r.id
        `;

        return rows.length;
    }

    private async bulkApplyByFiltersRoads(
        tx: DbClient,
        reviewBatchId: bigint,
        filters: ImportReviewBulkFilters,
        reviewDecision: string,
        reviewStatus: string,
        reviewedByUserId: bigint | null,
        reviewNote: string | null | undefined,
        force: boolean
    ): Promise<number> {
        const setClause = this.buildBulkUpdateSetClause({
            reviewDecision,
            reviewStatus,
            reviewedByUserId,
            reviewNote,
        });
        const whereFiltered = this.buildBulkModeBWhereRoads(reviewBatchId, filters);
        const rows = await tx.$queryRaw<{ id: bigint }[]>`
            WITH candidates AS (
                SELECT r.id, r.match_status, r.auto_action, r.promotion_status
                FROM import_review.road_candidates AS r
                WHERE ${whereFiltered}
            ),
            classified AS (
                SELECT
                    id,
                    CASE
                        WHEN promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
                        WHEN (match_status = 'manual_protected' OR auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
                        WHEN match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
                        WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                            match_status = 'new_auto' AND auto_action = 'insert_candidate'
                        ) THEN 'ineligible_bulk_approval'
                        ELSE 'eligible'
                    END AS bucket
                FROM candidates
            ),
            eligible AS (SELECT id FROM classified WHERE bucket = 'eligible')
            UPDATE import_review.road_candidates AS r
            SET ${setClause}
            FROM eligible AS e
            WHERE r.id = e.id AND (r.review_batch_id = ${reviewBatchId} AND r.entity_family = 'roads')
            RETURNING r.id
        `;

        return rows.length;
    }

    async patchBuildingReviewOverrides(args: {
        reviewBatchId: bigint;
        id: bigint;
        overridesPatch: Record<string, unknown>;
        editedByUserId: bigint | null;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        const buildingConfig = getImportReviewEntityConfig("buildings");
        const auditSupported = await this.pgRegclassExists("import_review.review_candidate_edits");
        const overridesMerge = buildReviewOverridesMergeExpr(buildingConfig, args.overridesPatch);

        const setParts: Prisma.Sql[] = [
            Prisma.sql`review_overrides = ${overridesMerge}`,
            Prisma.sql`updated_at = now()`,
        ];
        if (args.reviewNote !== undefined) {
            setParts.push(Prisma.sql`review_note = ${args.reviewNote}`);
        }
        const updateSetClause = Prisma.join(setParts, ", ");

        return this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<{ review_overrides: unknown }[]>`
                SELECT COALESCE(to_jsonb(b.review_overrides), '{}'::jsonb) AS review_overrides
                  FROM import_review.building_candidates AS b
                 WHERE b.id = ${args.id}
                   AND b.review_batch_id = ${args.reviewBatchId}
                   AND b.entity_family = 'buildings'
                 FOR UPDATE
            `;
            const before = locked[0];
            if (before === undefined) {
                return null;
            }

            const buildingConfig = getImportReviewEntityConfig("buildings");
            const rowParts = buildCandidateRowQueryParts(buildingConfig, true);
            const rows = await tx.$queryRaw<BuildingListRowDb[]>`
                WITH updated AS (
                    UPDATE import_review.building_candidates AS b
                       SET ${updateSetClause}
                     WHERE b.id = ${args.id}
                       AND b.review_batch_id = ${args.reviewBatchId}
                       AND b.entity_family = 'buildings'
                    RETURNING b.id
                )
                SELECT ${rowParts.select}
                FROM ${rowParts.from}
                INNER JOIN updated AS u ON b.id = u.id
            `;

            const updated = rows[0];
            if (updated === undefined) {
                return null;
            }

            if (auditSupported) {
                const beforeJson = JSON.stringify({ review_overrides: before.review_overrides ?? {} });
                const afterJson = JSON.stringify({ review_overrides: updated.review_overrides ?? {} });
                await tx.$executeRaw`
                    INSERT INTO import_review.review_candidate_edits (
                        review_batch_id,
                        entity_family,
                        candidate_table,
                        candidate_id,
                        edited_by,
                        edit_type,
                        before_data,
                        after_data
                    )
                    VALUES (
                        ${args.reviewBatchId},
                        'buildings',
                        'building_candidates',
                        ${args.id},
                        ${args.editedByUserId},
                        'override_update',
                        ${beforeJson}::jsonb,
                        ${afterJson}::jsonb
                    )
                `;
            }

            return updated;
        });
    }

    async bulkPlaceDecisions(args: {
        reviewBatchId: bigint;
        mode: "ids" | "filters";
        ids?: bigint[];
        filters?: ImportReviewBulkFilters;
        reviewDecision: string;
        reviewStatus: string;
        reviewedByUserId: bigint | null;
        reviewNote: string | null | undefined;
        force: boolean;
        dryRun: boolean;
    }): Promise<ImportReviewBulkDecisionRepoResult> {
        return this.genericCandidates.bulkCandidateDecisions({
            family: "places",
            reviewBatchId: args.reviewBatchId,
            mode: args.mode,
            ids: args.ids,
            filters: args.filters,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            reviewedByUserId: args.reviewedByUserId,
            reviewNote: args.reviewNote,
            force: args.force,
            dryRun: args.dryRun,
        });
    }

    async bulkRoadDecisions(args: {
        reviewBatchId: bigint;
        mode: "ids" | "filters";
        ids?: bigint[];
        filters?: ImportReviewBulkFilters;
        reviewDecision: string;
        reviewStatus: string;
        reviewedByUserId: bigint | null;
        reviewNote: string | null | undefined;
        force: boolean;
        dryRun: boolean;
    }): Promise<ImportReviewBulkDecisionRepoResult> {
        return this.genericCandidates.bulkCandidateDecisions({
            family: "roads",
            reviewBatchId: args.reviewBatchId,
            mode: args.mode,
            ids: args.ids,
            filters: args.filters,
            reviewDecision: args.reviewDecision,
            reviewStatus: args.reviewStatus,
            reviewedByUserId: args.reviewedByUserId,
            reviewNote: args.reviewNote,
            force: args.force,
            dryRun: args.dryRun,
        });
    }
}
