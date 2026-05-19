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
import {
    ImportReviewBatchAmbiguousError,
    ImportReviewBatchNotFoundError,
    ImportReviewInvalidScopeError,
} from "./import-review-errors.js";
import { logImportReviewBatchResolveHintsDev } from "./import-review-database-url.js";

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
    constructor(private readonly prisma: PrismaClient) {}

    private async pgRegclassExists(fullyQualifiedName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT to_regclass(${fullyQualifiedName}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }


    async resolveScope(query: ImportReviewScopeQuery): Promise<ImportReviewScopeResolved> {
        if (query.review_batch_id != null) {
            const rows = await this.prisma.$queryRaw<
                { id: bigint; source_snapshot_version: string; source_snapshot_id_local: bigint | null }[]
            >`
                SELECT id, source_snapshot_version, source_snapshot_id_local
                FROM import_review.review_batches
                WHERE id = ${query.review_batch_id}
                LIMIT 2
            `;
            if (rows.length === 0) {
                throw new ImportReviewBatchNotFoundError(query.review_batch_id.toString());
            }
            if (rows.length > 1) {
                throw new ImportReviewInvalidScopeError("review_batch_id resolution was ambiguous");
            }
            const row = rows[0]!;
            return {
                reviewBatchId: row.id,
                snapshotVersion: row.source_snapshot_version,
                sourceSnapshotIdLocal: row.source_snapshot_id_local,
            };
        }

        const v = query.source_snapshot_version?.trim();
        if (!v) {
            throw new ImportReviewInvalidScopeError(
                "Provide source_snapshot_version (alias: snapshot_version) or review_batch_id"
            );
        }

        const rows = await this.prisma.$queryRaw<
            { id: bigint; source_snapshot_version: string; source_snapshot_id_local: bigint | null }[]
        >`
            SELECT id, source_snapshot_version, source_snapshot_id_local
            FROM import_review.review_batches
            WHERE source_snapshot_version = ${v}
            ORDER BY id DESC
            LIMIT 2
        `;

        if (rows.length === 0) {
            await logImportReviewBatchResolveHintsDev(this.prisma, v);
            throw new ImportReviewBatchNotFoundError(v);
        }
        if (rows.length > 1) {
            throw new ImportReviewBatchAmbiguousError(v);
        }
        const row = rows[0]!;
        return {
            reviewBatchId: row.id,
            snapshotVersion: row.source_snapshot_version,
            sourceSnapshotIdLocal: row.source_snapshot_id_local,
        };
    }

    async fetchSummaryBuckets(scope: ImportReviewScopeResolved): Promise<{
        rows: ImportReviewSummaryBucketDb[];
        warnings: string[];
    }> {
        const warnings: string[] = [];
        const parts: Prisma.Sql[] = [];
        const reviewBatchId = scope.reviewBatchId;

        const buildingsAgg = Prisma.sql`
            SELECT
                'buildings'::text AS entity_family,
                c.review_batch_id,
                c.source_snapshot_version,
                c.match_status,
                c.auto_action,
                c.review_status,
                c.review_decision,
                c.promotion_status,
                count(*)::bigint AS row_count
            FROM import_review.building_candidates AS c
            WHERE c.review_batch_id = ${reviewBatchId} AND c.entity_family = 'buildings'
            GROUP BY
                c.review_batch_id,
                c.source_snapshot_version,
                c.match_status,
                c.auto_action,
                c.review_status,
                c.review_decision,
                c.promotion_status
        `;
        parts.push(buildingsAgg);

        if (await this.pgRegclassExists("import_review.place_candidates")) {
            parts.push(Prisma.sql`
                SELECT
                    'places'::text AS entity_family,
                    c.review_batch_id,
                    c.source_snapshot_version,
                    c.match_status,
                    c.auto_action,
                    c.review_status,
                    c.review_decision,
                    c.promotion_status,
                    count(*)::bigint AS row_count
                FROM import_review.place_candidates AS c
                WHERE c.review_batch_id = ${reviewBatchId} AND c.entity_family = 'places'
                GROUP BY
                    c.review_batch_id,
                    c.source_snapshot_version,
                    c.match_status,
                    c.auto_action,
                    c.review_status,
                    c.review_decision,
                    c.promotion_status
            `);
        } else {
            warnings.push("Summary skipped optional family places: table import_review.place_candidates not found.");
        }

        if (await this.pgRegclassExists("import_review.road_candidates")) {
            parts.push(Prisma.sql`
                SELECT
                    'roads'::text AS entity_family,
                    c.review_batch_id,
                    c.source_snapshot_version,
                    c.match_status,
                    c.auto_action,
                    c.review_status,
                    c.review_decision,
                    c.promotion_status,
                    count(*)::bigint AS row_count
                FROM import_review.road_candidates AS c
                WHERE c.review_batch_id = ${reviewBatchId} AND c.entity_family = 'roads'
                GROUP BY
                    c.review_batch_id,
                    c.source_snapshot_version,
                    c.match_status,
                    c.auto_action,
                    c.review_status,
                    c.review_decision,
                    c.promotion_status
            `);
        } else {
            warnings.push("Summary skipped optional family roads: table import_review.road_candidates not found.");
        }

        const rows = await this.prisma.$queryRaw<ImportReviewSummaryBucketDb[]>(Prisma.join(parts, " UNION ALL "));
        return { rows, warnings };
    }

    /** Distinct non-empty values per column for filter dropdowns (read-only). */
    async fetchBuildingFilterOptions(reviewBatchId: bigint): Promise<{
        match_status: string[];
        auto_action: string[];
        review_status: string[];
        review_decision: string[];
        class_code: string[];
        promotion_status: string[];
    }> {
        const distinctStrings = async (
            columnSql: Prisma.Sql
        ): Promise<string[]> => {
            const rows = await this.prisma.$queryRaw<{ v: string }[]>`
                SELECT DISTINCT ${columnSql} AS v
                FROM import_review.building_candidates AS b
                WHERE b.review_batch_id = ${reviewBatchId}
                  AND b.entity_family = 'buildings'
                  AND ${columnSql} IS NOT NULL
                  AND trim(${columnSql}) <> ''
                ORDER BY 1
            `;
            return rows.map((r) => r.v);
        };

        const [match_status, auto_action, review_status, review_decision, class_code, promotion_status] =
            await Promise.all([
                distinctStrings(Prisma.sql`b.match_status`),
                distinctStrings(Prisma.sql`b.auto_action`),
                distinctStrings(Prisma.sql`b.review_status`),
                distinctStrings(Prisma.sql`b.review_decision`),
                distinctStrings(Prisma.sql`b.class_code`),
                distinctStrings(Prisma.sql`b.promotion_status`),
            ]);

        return { match_status, auto_action, review_status, review_decision, class_code, promotion_status };
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
        const where = this.buildingListWhereClause(reviewBatchId, filters);
        const rows = await this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT count(*)::bigint AS count
            FROM import_review.building_candidates AS b
            WHERE ${where}
        `;
        const row = rows[0];
        return row?.count ?? 0n;
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
        const where = this.buildingListWhereClause(reviewBatchId, filters);
        const orderBy = BUILDING_ORDER_BY[filters.sort];
        const includeGeometry = filters.include_geometry;

        return this.prisma.$queryRaw<BuildingListRowDb[]>`
            SELECT
                b.id,
                b.public_id::text AS public_id,
                b.review_batch_id,
                b.source_snapshot_version,
                b.local_staging_id,
                b.source_snapshot_id_local,
                b.external_id,
                b.canonical_name,
                b.name,
                b.class_code,
                b.building_type,
                b.building_type_id,
                b.admin_area_id,
                b.levels,
                b.height_m,
                b.area_m2,
                b.confidence_score,
                b.match_status,
                b.auto_action,
                b.review_status,
                b.review_decision,
                b.reviewed_by::text AS reviewed_by,
                b.reviewed_at,
                b.review_note,
                b.normalized_data,
                b.source_refs,
                COALESCE(to_jsonb(b.review_overrides), '{}'::jsonb) AS review_overrides,
                b.matched_core_id,
                b.matched_core_table,
                b.matched_core_data,
                b.f2_comparison,
                b.validation_warnings,
                b.validation_errors,
                b.promotion_status,
                b.promoted_core_id,
                b.created_at,
                b.updated_at,
                CASE
                    WHEN ${includeGeometry} THEN ST_AsGeoJSON(b.geom)::json
                    ELSE NULL::json
                END AS geometry,
                CASE
                    WHEN ${includeGeometry} THEN ST_AsGeoJSON(b.centroid)::json
                    ELSE NULL::json
                END AS centroid
            FROM import_review.building_candidates AS b
            WHERE ${where}
            ORDER BY ${orderBy}
            LIMIT ${filters.limit} OFFSET ${filters.offset}
        `;
    }

    async getBuildingCandidateById(
        id: bigint,
        reviewBatchId: bigint,
        includeGeometry: boolean
    ): Promise<BuildingListRowDb | null> {
        const rows = await this.prisma.$queryRaw<BuildingListRowDb[]>`
            SELECT
                b.id,
                b.public_id::text AS public_id,
                b.review_batch_id,
                b.source_snapshot_version,
                b.local_staging_id,
                b.source_snapshot_id_local,
                b.external_id,
                b.canonical_name,
                b.name,
                b.class_code,
                b.building_type,
                b.building_type_id,
                b.admin_area_id,
                b.levels,
                b.height_m,
                b.area_m2,
                b.confidence_score,
                b.match_status,
                b.auto_action,
                b.review_status,
                b.review_decision,
                b.reviewed_by::text AS reviewed_by,
                b.reviewed_at,
                b.review_note,
                b.normalized_data,
                b.source_refs,
                COALESCE(to_jsonb(b.review_overrides), '{}'::jsonb) AS review_overrides,
                b.matched_core_id,
                b.matched_core_table,
                b.matched_core_data,
                b.f2_comparison,
                b.validation_warnings,
                b.validation_errors,
                b.promotion_status,
                b.promoted_core_id,
                b.created_at,
                b.updated_at,
                CASE
                    WHEN ${includeGeometry} THEN ST_AsGeoJSON(b.geom)::json
                    ELSE NULL::json
                END AS geometry,
                CASE
                    WHEN ${includeGeometry} THEN ST_AsGeoJSON(b.centroid)::json
                    ELSE NULL::json
                END AS centroid
            FROM import_review.building_candidates AS b
            WHERE b.id = ${id} AND (b.review_batch_id = ${reviewBatchId} AND b.entity_family = 'buildings')
            LIMIT 1
        `;
        const row = rows[0];
        return row === undefined ? null : row;
    }

    async findBuildingCandidateReviewContext(
        id: bigint,
        reviewBatchId: bigint
    ): Promise<{ match_status: string | null; auto_action: string | null; promotion_status: string | null } | null> {
        const rows = await this.prisma.$queryRaw<
            {
                match_status: string | null;
                auto_action: string | null;
                promotion_status: string | null;
            }[]
        >`
            SELECT b.match_status, b.auto_action, b.promotion_status
            FROM import_review.building_candidates AS b
            WHERE b.id = ${id} AND (b.review_batch_id = ${reviewBatchId} AND b.entity_family = 'buildings')
            LIMIT 1
        `;
        const row = rows[0];
        return row === undefined ? null : row;
    }

    /**
     * Updates review fields for one building row. `reviewNote === undefined` leaves review_note unchanged.
     */
    async updateBuildingReviewDecision(args: {
        id: bigint;
        reviewBatchId: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        const sets: Prisma.Sql[] = [
            Prisma.sql`review_decision = ${args.reviewDecision}`,
            Prisma.sql`review_status = ${args.reviewStatus}`,
            Prisma.sql`reviewed_at = now()`,
            Prisma.sql`updated_at = now()`,
        ];

        if (args.actor.reviewedByUserId !== null) {
            sets.push(Prisma.sql`reviewed_by = ${args.actor.reviewedByUserId}`);
        } else {
            sets.push(Prisma.sql`reviewed_by = NULL`);
        }

        if (args.reviewNote !== undefined) {
            sets.push(Prisma.sql`review_note = ${args.reviewNote}`);
        }

        const setClause = Prisma.join(sets, ", ");

        const rows = await this.prisma.$queryRaw<BuildingListRowDb[]>`
            UPDATE import_review.building_candidates AS b
            SET ${setClause}
            WHERE b.id = ${args.id} AND b.review_batch_id = ${args.reviewBatchId} AND b.entity_family = 'buildings'
            RETURNING
                b.id,
                b.public_id::text AS public_id,
                b.review_batch_id,
                b.source_snapshot_version,
                b.local_staging_id,
                b.source_snapshot_id_local,
                b.external_id,
                b.canonical_name,
                b.name,
                b.class_code,
                b.building_type,
                b.building_type_id,
                b.admin_area_id,
                b.levels,
                b.height_m,
                b.area_m2,
                b.confidence_score,
                b.match_status,
                b.auto_action,
                b.review_status,
                b.review_decision,
                b.reviewed_by::text AS reviewed_by,
                b.reviewed_at,
                b.review_note,
                b.normalized_data,
                b.source_refs,
                COALESCE(to_jsonb(b.review_overrides), '{}'::jsonb) AS review_overrides,
                b.matched_core_id,
                b.matched_core_table,
                b.matched_core_data,
                b.f2_comparison,
                b.validation_warnings,
                b.validation_errors,
                b.promotion_status,
                b.promoted_core_id,
                b.created_at,
                b.updated_at,
                ST_AsGeoJSON(b.geom)::json AS geometry,
                ST_AsGeoJSON(b.centroid)::json AS centroid
        `;

        const row = rows[0];
        return row === undefined ? null : row;
    }

    async countPlaceCandidates(
        reviewBatchId: bigint,
        filters: Pick<
            ImportReviewPlacesQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ): Promise<bigint> {
        const where = this.placeListWhereClause(reviewBatchId, filters);
        const rows = await this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT count(*)::bigint AS count
            FROM import_review.place_candidates AS p
            WHERE ${where}
        `;
        const row = rows[0];
        return row?.count ?? 0n;
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
        const where = this.placeListWhereClause(reviewBatchId, filters);
        const orderBy = PLACE_ORDER_BY[filters.sort];
        const includeGeometry = filters.include_geometry;

        return this.prisma.$queryRaw<BuildingListRowDb[]>`
            SELECT
                p.id,
                p.public_id::text AS public_id,
                p.review_batch_id,
                p.source_snapshot_version,
                p.local_staging_id,
                p.source_snapshot_id_local,
                p.external_id,
                p.canonical_name,
                NULL::text AS name,
                NULL::text AS class_code,
                NULL::text AS building_type,
                NULL::bigint AS building_type_id,
                p.admin_area_id,
                NULL::int AS levels,
                NULL::numeric AS height_m,
                NULL::numeric AS area_m2,
                p.confidence_score,
                p.match_status,
                p.auto_action,
                p.review_status,
                p.review_decision,
                p.reviewed_by::text AS reviewed_by,
                p.reviewed_at,
                p.review_note,
                p.normalized_data,
                p.source_refs,
                COALESCE(to_jsonb(p.review_overrides), '{}'::jsonb) AS review_overrides,
                p.matched_core_id,
                p.matched_core_table,
                p.matched_core_data,
                p.f2_comparison,
                p.validation_warnings,
                p.validation_errors,
                p.promotion_status,
                p.promoted_core_id,
                p.created_at,
                p.updated_at,
                CASE
                    WHEN ${includeGeometry} THEN ST_AsGeoJSON(p.point_geom)::json
                    ELSE NULL::json
                END AS geometry,
                CASE
                    WHEN ${includeGeometry} THEN ST_AsGeoJSON(p.point_geom)::json
                    ELSE NULL::json
                END AS centroid
            FROM import_review.place_candidates AS p
            WHERE ${where}
            ORDER BY ${orderBy}
            LIMIT ${filters.limit} OFFSET ${filters.offset}
        `;
    }

    async findPlaceCandidateReviewContext(
        id: bigint,
        reviewBatchId: bigint
    ): Promise<{ match_status: string | null; auto_action: string | null; promotion_status: string | null } | null> {
        const rows = await this.prisma.$queryRaw<
            {
                match_status: string | null;
                auto_action: string | null;
                promotion_status: string | null;
            }[]
        >`
            SELECT p.match_status, p.auto_action, p.promotion_status
            FROM import_review.place_candidates AS p
            WHERE p.id = ${id} AND (p.review_batch_id = ${reviewBatchId} AND p.entity_family = 'places')
            LIMIT 1
        `;
        const row = rows[0];
        return row === undefined ? null : row;
    }

    async updatePlaceReviewDecision(args: {
        id: bigint;
        reviewBatchId: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        const sets: Prisma.Sql[] = [
            Prisma.sql`review_decision = ${args.reviewDecision}`,
            Prisma.sql`review_status = ${args.reviewStatus}`,
            Prisma.sql`reviewed_at = now()`,
            Prisma.sql`updated_at = now()`,
        ];

        if (args.actor.reviewedByUserId !== null) {
            sets.push(Prisma.sql`reviewed_by = ${args.actor.reviewedByUserId}`);
        } else {
            sets.push(Prisma.sql`reviewed_by = NULL`);
        }

        if (args.reviewNote !== undefined) {
            sets.push(Prisma.sql`review_note = ${args.reviewNote}`);
        }

        const setClause = Prisma.join(sets, ", ");

        const rows = await this.prisma.$queryRaw<BuildingListRowDb[]>`
            UPDATE import_review.place_candidates AS p
            SET ${setClause}
            WHERE p.id = ${args.id} AND p.review_batch_id = ${args.reviewBatchId} AND p.entity_family = 'places'
            RETURNING
                p.id,
                p.public_id::text AS public_id,
                p.review_batch_id,
                p.source_snapshot_version,
                p.local_staging_id,
                p.source_snapshot_id_local,
                p.external_id,
                p.canonical_name,
                NULL::text AS name,
                NULL::text AS class_code,
                NULL::text AS building_type,
                NULL::bigint AS building_type_id,
                p.admin_area_id,
                NULL::int AS levels,
                NULL::numeric AS height_m,
                NULL::numeric AS area_m2,
                p.confidence_score,
                p.match_status,
                p.auto_action,
                p.review_status,
                p.review_decision,
                p.reviewed_by::text AS reviewed_by,
                p.reviewed_at,
                p.review_note,
                p.normalized_data,
                p.source_refs,
                COALESCE(to_jsonb(p.review_overrides), '{}'::jsonb) AS review_overrides,
                p.matched_core_id,
                p.matched_core_table,
                p.matched_core_data,
                p.f2_comparison,
                p.validation_warnings,
                p.validation_errors,
                p.promotion_status,
                p.promoted_core_id,
                p.created_at,
                p.updated_at,
                ST_AsGeoJSON(p.point_geom)::json AS geometry,
                ST_AsGeoJSON(p.point_geom)::json AS centroid
        `;

        const row = rows[0];
        return row === undefined ? null : row;
    }

    async countRoadCandidates(
        reviewBatchId: bigint,
        filters: Pick<
            ImportReviewRoadsQuery,
            "match_status" | "auto_action" | "review_status" | "review_decision" | "q"
        >
    ): Promise<bigint> {
        const where = this.roadListWhereClause(reviewBatchId, filters);
        const rows = await this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT count(*)::bigint AS count
            FROM import_review.road_candidates AS r
            WHERE ${where}
        `;
        const row = rows[0];
        return row?.count ?? 0n;
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
        const where = this.roadListWhereClause(reviewBatchId, filters);
        const orderBy = ROAD_ORDER_BY[filters.sort];
        const includeGeometry = filters.include_geometry;

        return this.prisma.$queryRaw<BuildingListRowDb[]>`
            SELECT
                r.id,
                r.public_id::text AS public_id,
                r.review_batch_id,
                r.source_snapshot_version,
                r.local_staging_id,
                r.source_snapshot_id_local,
                r.external_id,
                r.canonical_name,
                NULL::text AS name,
                r.class_code,
                NULL::text AS building_type,
                NULL::bigint AS building_type_id,
                NULL::bigint AS admin_area_id,
                NULL::int AS levels,
                NULL::numeric AS height_m,
                NULL::numeric AS area_m2,
                r.confidence_score,
                r.match_status,
                r.auto_action,
                r.review_status,
                r.review_decision,
                r.reviewed_by::text AS reviewed_by,
                r.reviewed_at,
                r.review_note,
                r.normalized_data,
                r.source_refs,
                COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb) AS review_overrides,
                r.matched_core_id,
                r.matched_core_table,
                r.matched_core_data,
                r.f2_comparison,
                r.validation_warnings,
                r.validation_errors,
                r.promotion_status,
                r.promoted_core_id,
                r.created_at,
                r.updated_at,
                CASE
                    WHEN ${includeGeometry} THEN ST_AsGeoJSON(r.geom)::json
                    ELSE NULL::json
                END AS geometry,
                CASE
                    WHEN ${includeGeometry} AND r.geom IS NOT NULL THEN
                        ST_AsGeoJSON(ST_SetSRID(ST_Centroid(r.geom), 4326))::json
                    ELSE NULL::json
                END AS centroid,
                r.road_class_id AS road_candidate_road_class_id,
                r.surface AS road_candidate_surface,
                r.is_oneway AS road_candidate_is_oneway,
                COALESCE(rc.code, r.road_class) AS road_candidate_class_label
            FROM import_review.road_candidates AS r
            LEFT JOIN ref.ref_road_classes AS rc ON rc.id = r.road_class_id
            WHERE ${where}
            ORDER BY ${orderBy}
            LIMIT ${filters.limit} OFFSET ${filters.offset}
        `;
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
    }): Promise<BuildingListRowDb | null> {
        const errorsJson = JSON.stringify(args.validation_errors_json);
        const warningsJson = JSON.stringify(args.validation_warnings_json);
        const summaryJson = JSON.stringify(args.validation_summary);

        const rows = await this.prisma.$queryRaw<BuildingListRowDb[]>`
            UPDATE import_review.road_candidates AS r
            SET
                validation_errors = ${errorsJson}::jsonb,
                validation_warnings = ${warningsJson}::jsonb,
                review_status = ${args.review_status},
                review_overrides = COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb)
                    || jsonb_build_object('validation_summary', ${summaryJson}::jsonb),
                updated_at = now()
            WHERE r.id = ${args.id}
              AND r.review_batch_id = ${args.reviewBatchId}
              AND r.entity_family = 'roads'
            RETURNING
                r.id,
                r.public_id::text AS public_id,
                r.review_batch_id,
                r.source_snapshot_version,
                r.local_staging_id,
                r.source_snapshot_id_local,
                r.external_id,
                r.canonical_name,
                NULL::text AS name,
                r.class_code,
                NULL::text AS building_type,
                NULL::bigint AS building_type_id,
                NULL::bigint AS admin_area_id,
                NULL::int AS levels,
                NULL::numeric AS height_m,
                NULL::numeric AS area_m2,
                r.confidence_score,
                r.match_status,
                r.auto_action,
                r.review_status,
                r.review_decision,
                r.reviewed_by::text AS reviewed_by,
                r.reviewed_at,
                r.review_note,
                r.normalized_data,
                r.source_refs,
                COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb) AS review_overrides,
                r.matched_core_id,
                r.matched_core_table,
                r.matched_core_data,
                r.f2_comparison,
                r.validation_warnings,
                r.validation_errors,
                r.promotion_status,
                r.promoted_core_id,
                r.created_at,
                r.updated_at,
                ST_AsGeoJSON(r.geom)::json AS geometry,
                CASE
                    WHEN r.geom IS NOT NULL THEN ST_AsGeoJSON(ST_SetSRID(ST_Centroid(r.geom), 4326))::json
                    ELSE NULL::json
                END AS centroid,
                r.road_class_id AS road_candidate_road_class_id,
                r.surface AS road_candidate_surface,
                r.is_oneway AS road_candidate_is_oneway,
                (
                    SELECT COALESCE(rc.code, r.road_class)
                      FROM ref.ref_road_classes AS rc
                     WHERE rc.id = r.road_class_id
                     LIMIT 1
                ) AS road_candidate_class_label
        `;
        const row = rows[0];
        return row === undefined ? null : row;
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
            }
            if (args.reviewNote !== undefined) {
                setPieces.push(Prisma.sql`review_note = ${args.reviewNote}`);
            }
            const updateSetClause = Prisma.join(setPieces, ", ");

            const rows = await tx.$queryRaw<BuildingListRowDb[]>`
                UPDATE import_review.road_candidates AS r
                   SET ${updateSetClause}
                 WHERE r.id = ${args.id}
                   AND r.review_batch_id = ${args.reviewBatchId}
                   AND r.entity_family = 'roads'
                RETURNING
                    r.id,
                    r.public_id::text AS public_id,
                    r.review_batch_id,
                    r.source_snapshot_version,
                    r.local_staging_id,
                    r.source_snapshot_id_local,
                    r.external_id,
                    r.canonical_name,
                    NULL::text AS name,
                    r.class_code,
                    NULL::text AS building_type,
                    NULL::bigint AS building_type_id,
                    NULL::bigint AS admin_area_id,
                    NULL::int AS levels,
                    NULL::numeric AS height_m,
                    NULL::numeric AS area_m2,
                    r.confidence_score,
                    r.match_status,
                    r.auto_action,
                    r.review_status,
                    r.review_decision,
                    r.reviewed_by::text AS reviewed_by,
                    r.reviewed_at,
                    r.review_note,
                    r.normalized_data,
                    r.source_refs,
                    COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb) AS review_overrides,
                    r.matched_core_id,
                    r.matched_core_table,
                    r.matched_core_data,
                    r.f2_comparison,
                    r.validation_warnings,
                    r.validation_errors,
                    r.promotion_status,
                    r.promoted_core_id,
                    r.created_at,
                    r.updated_at,
                    ST_AsGeoJSON(r.geom)::json AS geometry,
                    CASE
                        WHEN r.geom IS NOT NULL THEN ST_AsGeoJSON(ST_SetSRID(ST_Centroid(r.geom), 4326))::json
                        ELSE NULL::json
                    END AS centroid,
                    r.road_class_id AS road_candidate_road_class_id,
                    r.surface AS road_candidate_surface,
                    r.is_oneway AS road_candidate_is_oneway,
                    (
                        SELECT COALESCE(rc.code, r.road_class)
                          FROM ref.ref_road_classes AS rc
                         WHERE rc.id = r.road_class_id
                         LIMIT 1
                    ) AS road_candidate_class_label
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
        const sets: Prisma.Sql[] = [
            Prisma.sql`review_decision = ${args.reviewDecision}`,
            Prisma.sql`review_status = ${args.reviewStatus}`,
            Prisma.sql`reviewed_at = now()`,
            Prisma.sql`updated_at = now()`,
        ];

        if (args.actor.reviewedByUserId !== null) {
            sets.push(Prisma.sql`reviewed_by = ${args.actor.reviewedByUserId}`);
        } else {
            sets.push(Prisma.sql`reviewed_by = NULL`);
        }

        if (args.reviewNote !== undefined) {
            sets.push(Prisma.sql`review_note = ${args.reviewNote}`);
        }

        const setClause = Prisma.join(sets, ", ");

        const rows = await this.prisma.$queryRaw<BuildingListRowDb[]>`
            UPDATE import_review.road_candidates AS r
            SET ${setClause}
            WHERE r.id = ${args.id} AND r.review_batch_id = ${args.reviewBatchId} AND r.entity_family = 'roads'
            RETURNING
                r.id,
                r.public_id::text AS public_id,
                r.review_batch_id,
                r.source_snapshot_version,
                r.local_staging_id,
                r.source_snapshot_id_local,
                r.external_id,
                r.canonical_name,
                NULL::text AS name,
                r.class_code,
                NULL::text AS building_type,
                NULL::bigint AS building_type_id,
                NULL::bigint AS admin_area_id,
                NULL::int AS levels,
                NULL::numeric AS height_m,
                NULL::numeric AS area_m2,
                r.confidence_score,
                r.match_status,
                r.auto_action,
                r.review_status,
                r.review_decision,
                r.reviewed_by::text AS reviewed_by,
                r.reviewed_at,
                r.review_note,
                r.normalized_data,
                r.source_refs,
                COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb) AS review_overrides,
                r.matched_core_id,
                r.matched_core_table,
                r.matched_core_data,
                r.f2_comparison,
                r.validation_warnings,
                r.validation_errors,
                r.promotion_status,
                r.promoted_core_id,
                r.created_at,
                r.updated_at,
                ST_AsGeoJSON(r.geom)::json AS geometry,
                CASE
                    WHEN r.geom IS NOT NULL THEN ST_AsGeoJSON(ST_SetSRID(ST_Centroid(r.geom), 4326))::json
                    ELSE NULL::json
                END AS centroid,
                r.road_class_id AS road_candidate_road_class_id,
                r.surface AS road_candidate_surface,
                r.is_oneway AS road_candidate_is_oneway,
                (
                    SELECT COALESCE(rc.code, r.road_class)
                      FROM ref.ref_road_classes AS rc
                     WHERE rc.id = r.road_class_id
                     LIMIT 1
                ) AS road_candidate_class_label
        `;

        const row = rows[0];
        return row === undefined ? null : row;
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
        return this.prisma.$transaction(async (tx) => {
            const buckets =
                args.mode === "ids"
                    ? await this.bulkClassifyByIds(
                          tx,
                          args.reviewBatchId,
                          args.ids!,
                          args.reviewDecision,
                          args.force
                      )
                    : await this.bulkClassifyByFilters(
                          tx,
                          args.reviewBatchId,
                          args.filters!,
                          args.reviewDecision,
                          args.force
                      );

            const eligible = buckets.get("eligible") ?? 0n;
            const skippedReasons = this.bucketsToSkippedReasons(buckets);
            const skippedCount = skippedReasons.reduce((sum, r) => sum + r.count, 0);

            if (args.dryRun) {
                return {
                    updated_count: Number(eligible),
                    skipped_count: skippedCount,
                    skipped_reasons: skippedReasons,
                    dry_run: true,
                };
            }

            const updated =
                args.mode === "ids"
                    ? await this.bulkApplyByIds(
                          tx,
                          args.reviewBatchId,
                          args.ids!,
                          args.reviewDecision,
                          args.reviewStatus,
                          args.reviewedByUserId,
                          args.reviewNote,
                          args.force
                      )
                    : await this.bulkApplyByFilters(
                          tx,
                          args.reviewBatchId,
                          args.filters!,
                          args.reviewDecision,
                          args.reviewStatus,
                          args.reviewedByUserId,
                          args.reviewNote,
                          args.force
                      );

            return {
                updated_count: updated,
                skipped_count: skippedCount,
                skipped_reasons: skippedReasons,
                dry_run: false,
            };
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
        const merge = JSON.stringify(args.overridesPatch);
        const auditSupported = await this.pgRegclassExists("import_review.review_candidate_edits");

        const setParts: Prisma.Sql[] = [
            Prisma.sql`review_overrides = COALESCE(to_jsonb(b.review_overrides), '{}'::jsonb) || ${merge}::jsonb`,
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

            const rows = await tx.$queryRaw<BuildingListRowDb[]>`
                UPDATE import_review.building_candidates AS b
                   SET ${updateSetClause}
                 WHERE b.id = ${args.id}
                   AND b.review_batch_id = ${args.reviewBatchId}
                   AND b.entity_family = 'buildings'
                RETURNING
                    b.id,
                    b.public_id::text AS public_id,
                    b.review_batch_id,
                    b.source_snapshot_version,
                    b.local_staging_id,
                    b.source_snapshot_id_local,
                    b.external_id,
                    b.canonical_name,
                    b.name,
                    b.class_code,
                    b.building_type,
                    b.building_type_id,
                    b.admin_area_id,
                    b.levels,
                    b.height_m,
                    b.area_m2,
                    b.confidence_score,
                    b.match_status,
                    b.auto_action,
                    b.review_status,
                    b.review_decision,
                    b.reviewed_by::text AS reviewed_by,
                    b.reviewed_at,
                    b.review_note,
                    b.normalized_data,
                    b.source_refs,
                    COALESCE(to_jsonb(b.review_overrides), '{}'::jsonb) AS review_overrides,
                    b.matched_core_id,
                    b.matched_core_table,
                    b.matched_core_data,
                    b.f2_comparison,
                    b.validation_warnings,
                    b.validation_errors,
                    b.promotion_status,
                    b.promoted_core_id,
                    b.created_at,
                    b.updated_at,
                    ST_AsGeoJSON(b.geom)::json AS geometry,
                    ST_AsGeoJSON(b.centroid)::json AS centroid
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
        return this.prisma.$transaction(async (tx) => {
            const buckets =
                args.mode === "ids"
                    ? await this.bulkClassifyByIdsPlaces(
                          tx,
                          args.reviewBatchId,
                          args.ids!,
                          args.reviewDecision,
                          args.force
                      )
                    : await this.bulkClassifyByFiltersPlaces(
                          tx,
                          args.reviewBatchId,
                          args.filters!,
                          args.reviewDecision,
                          args.force
                      );

            const eligible = buckets.get("eligible") ?? 0n;
            const skippedReasons = this.bucketsToSkippedReasons(buckets);
            const skippedCount = skippedReasons.reduce((sum, r) => sum + r.count, 0);

            if (args.dryRun) {
                return {
                    updated_count: Number(eligible),
                    skipped_count: skippedCount,
                    skipped_reasons: skippedReasons,
                    dry_run: true,
                };
            }

            const updated =
                args.mode === "ids"
                    ? await this.bulkApplyByIdsPlaces(
                          tx,
                          args.reviewBatchId,
                          args.ids!,
                          args.reviewDecision,
                          args.reviewStatus,
                          args.reviewedByUserId,
                          args.reviewNote,
                          args.force
                      )
                    : await this.bulkApplyByFiltersPlaces(
                          tx,
                          args.reviewBatchId,
                          args.filters!,
                          args.reviewDecision,
                          args.reviewStatus,
                          args.reviewedByUserId,
                          args.reviewNote,
                          args.force
                      );

            return {
                updated_count: updated,
                skipped_count: skippedCount,
                skipped_reasons: skippedReasons,
                dry_run: false,
            };
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
        return this.prisma.$transaction(async (tx) => {
            const buckets =
                args.mode === "ids"
                    ? await this.bulkClassifyByIdsRoads(
                          tx,
                          args.reviewBatchId,
                          args.ids!,
                          args.reviewDecision,
                          args.force
                      )
                    : await this.bulkClassifyByFiltersRoads(
                          tx,
                          args.reviewBatchId,
                          args.filters!,
                          args.reviewDecision,
                          args.force
                      );

            const eligible = buckets.get("eligible") ?? 0n;
            const skippedReasons = this.bucketsToSkippedReasons(buckets);
            const skippedCount = skippedReasons.reduce((sum, r) => sum + r.count, 0);

            if (args.dryRun) {
                return {
                    updated_count: Number(eligible),
                    skipped_count: skippedCount,
                    skipped_reasons: skippedReasons,
                    dry_run: true,
                };
            }

            const updated =
                args.mode === "ids"
                    ? await this.bulkApplyByIdsRoads(
                          tx,
                          args.reviewBatchId,
                          args.ids!,
                          args.reviewDecision,
                          args.reviewStatus,
                          args.reviewedByUserId,
                          args.reviewNote,
                          args.force
                      )
                    : await this.bulkApplyByFiltersRoads(
                          tx,
                          args.reviewBatchId,
                          args.filters!,
                          args.reviewDecision,
                          args.reviewStatus,
                          args.reviewedByUserId,
                          args.reviewNote,
                          args.force
                      );

            return {
                updated_count: updated,
                skipped_count: skippedCount,
                skipped_reasons: skippedReasons,
                dry_run: false,
            };
        });
    }
}
