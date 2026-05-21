import { Prisma, type PrismaClient } from "@prisma/client";

import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    buildVerificationMetadataTracking,
    coreVerificationInsertColumnsSql,
    coreVerificationInsertValuesSql,
    coreVerificationUpdateSetClauseSql,
    getCoreVerificationColumnsForEntity,
} from "./import-review-promotion-core-verification.js";
import {
    assertPoiCategoriesTableExists,
    placeResolvedCategoryIdExprForPromotion,
} from "./import-review-promotion-place-category.js";
import {
    normalizedDataMergeExpr,
    sourceRefsMergeExpr,
} from "./import-review-promotion-promote-sql.js";

const PLACE_CANDIDATE_TABLE = "import_review.place_candidates";
const CORE_PLACES_TABLE = "core.core_places";
const PLACE_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("places");
/** Alias for import_review.place_candidates in promotion SQL (not the src publish-item projection). */
const PLACE_CANDIDATE_SQL_ALIAS = "pc";

const PROMOTE_PLACE_SRC_COLUMNS = Prisma.sql`
    spi.id AS publish_item_id,
    p.id,
    p.review_batch_id,
    p.source_snapshot_version,
    p.local_staging_id,
    p.external_id,
    p.canonical_name,
    p.primary_name,
    p.display_name,
    p.category_id,
    p.admin_area_id,
    p.point_geom,
    p.lat,
    p.lng,
    p.plus_code,
    p.importance_score,
    p.popularity_score,
    p.confidence_score,
    p.review_decision,
    p.normalized_data,
    p.review_overrides,
    p.source_refs,
    p.matched_core_id,
    p.matched_core_table,
    p.promotion_status,
    p.promoted_core_id
`;

function placePrimaryNameExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'primary_name',
            ${a}.review_overrides->>'display_name',
            ${a}.review_overrides->>'name',
            ${a}.review_overrides->>'canonical_name',
            ${a}.primary_name,
            ${a}.display_name,
            ${a}.canonical_name,
            ${a}.normalized_data->>'primary_name',
            ${a}.normalized_data->>'display_name',
            ${a}.normalized_data->>'name',
            ${a}.normalized_data->>'canonical_name',
            ''
        )), '')
    `;
}

function placeDisplayNameExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(
            nullif(trim(coalesce(
                ${a}.review_overrides->>'display_name',
                ${a}.review_overrides->>'primary_name',
                ${a}.review_overrides->>'name',
                ${a}.display_name,
                ${a}.primary_name,
                ${a}.canonical_name,
                ${a}.normalized_data->>'display_name',
                ${a}.normalized_data->>'primary_name',
                ${a}.normalized_data->>'name',
                ''
            )), ''),
            ${placePrimaryNameExpr(alias)}
        )
    `;
}

function placeCategoryIdExpr(alias: string): Prisma.Sql {
    return placeResolvedCategoryIdExprForPromotion(alias);
}

function placeAdminAreaIdExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN coalesce(
                CASE WHEN (${a}.review_overrides->>'admin_area_id') ~ '^[0-9]+$'
                    THEN (${a}.review_overrides->>'admin_area_id')::bigint END,
                ${a}.admin_area_id,
                CASE WHEN (${a}.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
                    THEN (${a}.normalized_data->>'admin_area_id')::bigint END
            ) IS NULL THEN NULL::bigint
            WHEN EXISTS (
                SELECT 1 FROM core.core_admin_areas AS aa
                WHERE aa.id = coalesce(
                    CASE WHEN (${a}.review_overrides->>'admin_area_id') ~ '^[0-9]+$'
                        THEN (${a}.review_overrides->>'admin_area_id')::bigint END,
                    ${a}.admin_area_id,
                    CASE WHEN (${a}.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
                        THEN (${a}.normalized_data->>'admin_area_id')::bigint END
                )
            ) THEN coalesce(
                CASE WHEN (${a}.review_overrides->>'admin_area_id') ~ '^[0-9]+$'
                    THEN (${a}.review_overrides->>'admin_area_id')::bigint END,
                ${a}.admin_area_id,
                CASE WHEN (${a}.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
                    THEN (${a}.normalized_data->>'admin_area_id')::bigint END
            )
            ELSE NULL::bigint
        END
    `;
}

function placePointGeomExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN ${a}.review_overrides ? 'point_geom'
                 AND ${a}.review_overrides->'point_geom' IS NOT NULL
                 AND jsonb_typeof(${a}.review_overrides->'point_geom') = 'object'
            THEN ST_SetSRID(ST_GeomFromGeoJSON(${a}.review_overrides->'point_geom'), 4326)
            WHEN ${a}.review_overrides ? 'geom'
                 AND ${a}.review_overrides->'geom' IS NOT NULL
                 AND jsonb_typeof(${a}.review_overrides->'geom') = 'object'
            THEN ST_SetSRID(ST_GeomFromGeoJSON(${a}.review_overrides->'geom'), 4326)
            WHEN ${a}.point_geom IS NOT NULL THEN ${a}.point_geom
            WHEN ${a}.lat IS NOT NULL AND ${a}.lng IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(${a}.lng, ${a}.lat), 4326)
            ELSE NULL::geometry(Point, 4326)
        END
    `;
}

function placeSourceTypeIdExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`(
        SELECT st.id
        FROM ref.ref_source_types AS st
        WHERE st.code = coalesce(
            nullif(trim(${a}.source_refs->>'source_type_code'), ''),
            nullif(trim(${a}.source_refs->>'source'), ''),
            nullif(trim(${a}.normalized_data->>'source_type_code'), ''),
            nullif(trim(${a}.normalized_data->>'source'), ''),
            'osm'
        )
        LIMIT 1
    )`;
}

function placeIsPublicExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN ${a}.review_overrides ? 'is_public' THEN
                CASE lower(trim(${a}.review_overrides->>'is_public'))
                    WHEN 'false' THEN false
                    WHEN '0' THEN false
                    ELSE true
                END
            ELSE true
        END
    `;
}

/** Candidate-field expressions for ready/valid CTEs — alias must be place_candidates (pc), not src (s). */
function placeCandidateReadyExprs(batchId: bigint): Prisma.Sql {
    const pc = PLACE_CANDIDATE_SQL_ALIAS;
    return Prisma.sql`
        ${placePointGeomExpr(pc)} AS point_geom_ready,
        ${placePrimaryNameExpr(pc)} AS primary_name_ready,
        ${placeDisplayNameExpr(pc)} AS display_name_ready,
        ${placeCategoryIdExpr(pc)} AS category_id_ready,
        ${placeAdminAreaIdExpr(pc)} AS admin_area_id_ready,
        ${placeSourceTypeIdExpr(pc)} AS source_type_id_ready,
        ${sourceRefsMergeExpr(pc, batchId, "places")} AS merged_source_refs,
        ${normalizedDataMergeExpr(pc, batchId)} AS merged_normalized_data
    `;
}

export class ImportReviewPromotionPromotePlacesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async tableExists(regclass: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ exists: boolean }[]>`
            SELECT to_regclass(${regclass}) IS NOT NULL AS exists
        `;
        return rows[0]?.exists === true;
    }

    async checkPlaceCoreExists(targetId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM core.core_places
            WHERE id = ${targetId} AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows.length > 0;
    }

    async insertPlace(
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        try {
            await assertPoiCategoriesTableExists(this.prisma);

            return await this.prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<
                    {
                        id: bigint;
                        external_id: string | null;
                        primary_name: string;
                        display_name: string;
                        candidate_id: bigint;
                        merged_source_refs: unknown;
                        source_type_id: bigint;
                    }[]
                >`
                    WITH src AS (
                        SELECT ${PROMOTE_PLACE_SRC_COLUMNS}
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.place_candidates AS p
                            ON p.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                    ),
                    -- Candidate fields must be read from the place candidate alias, not the selected publish item alias.
                    ready AS (
                        SELECT
                            s.*,
                            ${placeCandidateReadyExprs(batchId)}
                        FROM src AS s
                        INNER JOIN import_review.place_candidates AS pc ON pc.id = s.id
                    ),
                    guard AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE r.point_geom_ready IS NOT NULL
                          AND ST_IsValid(r.point_geom_ready)
                          AND NOT ST_IsEmpty(r.point_geom_ready)
                          AND ST_SRID(r.point_geom_ready) = 4326
                          AND r.primary_name_ready IS NOT NULL
                          AND r.category_id_ready IS NOT NULL
                          AND r.source_type_id_ready IS NOT NULL
                          AND NOT EXISTS (
                              SELECT 1 FROM core.core_places AS c
                              WHERE c.deleted_at IS NULL
                                AND r.external_id IS NOT NULL
                                AND trim(r.external_id) <> ''
                                AND c.external_id = r.external_id
                          )
                    )
                    INSERT INTO core.core_places (
                        primary_name, display_name, category_id, admin_area_id,
                        point_geom, lat, lng, plus_code,
                        importance_score, popularity_score, confidence_score,
                        is_public${coreVerificationInsertColumnsSql(PLACE_VERIFICATION_COLUMNS)},
                        source_type_id,
                        external_id, source_refs, normalized_data,
                        created_at, updated_at, deleted_at
                    )
                    SELECT
                        g.primary_name_ready,
                        g.display_name_ready,
                        g.category_id_ready,
                        g.admin_area_id_ready,
                        g.point_geom_ready,
                        ST_Y(g.point_geom_ready),
                        ST_X(g.point_geom_ready),
                        nullif(trim(coalesce(
                            g.review_overrides->>'plus_code',
                            g.plus_code,
                            g.normalized_data->>'plus_code',
                            ''
                        )), ''),
                        coalesce(g.importance_score, 0),
                        coalesce(g.popularity_score, 0),
                        least(100, greatest(0, coalesce(g.confidence_score, 80))),
                        ${placeIsPublicExpr("g")}${coreVerificationInsertValuesSql(PLACE_VERIFICATION_COLUMNS)},
                        g.source_type_id_ready,
                        nullif(trim(g.external_id), ''),
                        g.merged_source_refs,
                        g.merged_normalized_data,
                        now(),
                        now(),
                        NULL::timestamptz
                    FROM guard AS g
                    RETURNING id, external_id, primary_name, display_name, source_type_id, source_refs
                `;

                if (rows.length === 0) {
                    const reason = await this.explainPlaceInsertBlocked(tx, batchId, publishItemId);
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: reason,
                        before_data: null,
                        after_data: null,
                    };
                }

                const row = rows[0]!;
                await this.syncPlaceNames(tx, publishItemId, row.id, row.primary_name);
                await this.syncPlaceSources(tx, publishItemId, row.id, row.source_type_id, row.external_id);

                return {
                    publish_item_id: publishItemId,
                    outcome: "inserted",
                    target_id: row.id,
                    error_message: null,
                    before_data: null,
                    after_data: {
                        id: row.id.toString(),
                        external_id: row.external_id,
                        primary_name: row.primary_name,
                        display_name: row.display_name,
                        entity_family: "places",
                    },
                    ...buildVerificationMetadataTracking({
                        outcome: "inserted",
                        beforeData: null,
                        entityKey: "places",
                    }),
                };
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: `Place promotion failed: ${message}`,
                before_data: null,
                after_data: null,
            };
        }
    }

    async updatePlace(
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const beforeRows = await this.prisma.$queryRaw<{ row_json: unknown }[]>`
            SELECT to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.place_candidates AS p
                ON p.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
            INNER JOIN core.core_places AS c ON c.id = p.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND p.matched_core_id IS NOT NULL
              AND p.matched_core_table IN ('core_places', 'core.core_places')
              AND c.deleted_at IS NULL
              AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
            LIMIT 1
        `;
        const beforeData = beforeRows[0]?.row_json ?? null;
        if (!beforeData) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message:
                    "Update blocked: matched_core_id missing, wrong matched_core_table, core row inactive, or dashboard-protected target.",
                before_data: null,
                after_data: null,
            };
        }

        await assertPoiCategoriesTableExists(this.prisma);

        try {
            return await this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<
                {
                    id: bigint;
                    external_id: string | null;
                    primary_name: string;
                    display_name: string;
                    source_type_id: bigint;
                }[]
            >`
                WITH src AS (
                    SELECT ${PROMOTE_PLACE_SRC_COLUMNS}
                    FROM system.system_publish_items AS spi
                    INNER JOIN import_review.place_candidates AS p
                        ON p.id = spi.review_candidate_id
                       AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
                    WHERE spi.id = ${publishItemId}
                      AND spi.publish_batch_id = ${batchId}
                      AND p.matched_core_id IS NOT NULL
                      AND p.matched_core_table IN ('core_places', 'core.core_places')
                ),
                -- Candidate fields must be read from the place candidate alias, not the selected publish item alias.
                ready AS (
                    SELECT
                        s.*,
                        ${placeCandidateReadyExprs(batchId)}
                    FROM src AS s
                    INNER JOIN import_review.place_candidates AS pc ON pc.id = s.id
                ),
                valid AS (
                    SELECT r.*
                    FROM ready AS r
                    WHERE r.point_geom_ready IS NOT NULL
                      AND ST_IsValid(r.point_geom_ready)
                      AND NOT ST_IsEmpty(r.point_geom_ready)
                      AND r.primary_name_ready IS NOT NULL
                      AND r.category_id_ready IS NOT NULL
                      AND r.source_type_id_ready IS NOT NULL
                )
                UPDATE core.core_places AS c
                SET
                    primary_name = v.primary_name_ready,
                    display_name = v.display_name_ready,
                    category_id = v.category_id_ready,
                    admin_area_id = v.admin_area_id_ready,
                    point_geom = v.point_geom_ready,
                    lat = ST_Y(v.point_geom_ready),
                    lng = ST_X(v.point_geom_ready),
                    plus_code = nullif(trim(coalesce(
                        v.review_overrides->>'plus_code',
                        v.plus_code,
                        v.normalized_data->>'plus_code',
                        c.plus_code,
                        ''
                    )), ''),
                    importance_score = coalesce(v.importance_score, c.importance_score),
                    popularity_score = coalesce(v.popularity_score, c.popularity_score),
                    confidence_score = least(100, greatest(0, coalesce(v.confidence_score, c.confidence_score))),
                    is_public = ${placeIsPublicExpr("v")}${coreVerificationUpdateSetClauseSql("c", PLACE_VERIFICATION_COLUMNS)},
                    source_type_id = v.source_type_id_ready,
                    external_id = coalesce(nullif(trim(v.external_id), ''), c.external_id),
                    source_refs = v.merged_source_refs,
                    normalized_data = v.merged_normalized_data,
                    updated_at = now(),
                    deleted_at = NULL
                FROM valid AS v
                WHERE c.id = v.matched_core_id
                  AND c.deleted_at IS NULL
                  AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
                RETURNING c.id, c.external_id, c.primary_name, c.display_name, c.source_type_id
            `;

            if (rows.length === 0) {
                const reason = await this.explainPlaceUpdateBlocked(tx, batchId, publishItemId);
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: reason,
                    before_data: beforeData,
                    after_data: null,
                };
            }

            const row = rows[0]!;
            await this.syncPlaceNames(tx, publishItemId, row.id, row.primary_name);
            await this.syncPlaceSources(tx, publishItemId, row.id, row.source_type_id, row.external_id);

            return {
                publish_item_id: publishItemId,
                outcome: "updated",
                target_id: row.id,
                error_message: null,
                before_data: beforeData,
                after_data: {
                    id: row.id.toString(),
                    external_id: row.external_id,
                    primary_name: row.primary_name,
                    display_name: row.display_name,
                    entity_family: "places",
                },
                ...buildVerificationMetadataTracking({
                    outcome: "updated",
                    beforeData,
                    entityKey: "places",
                }),
            };
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: `Place promotion failed: ${message}`,
                before_data: beforeData,
                after_data: null,
            };
        }
    }

    private async explainPlaceInsertBlocked(
        tx: Prisma.TransactionClient,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<string> {
        const rows = await tx.$queryRaw<{ reason: string }[]>`
            WITH src AS (
                SELECT ${PROMOTE_PLACE_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
            ),
            ready AS (
                SELECT
                    s.*,
                    ${placeCandidateReadyExprs(batchId)}
                FROM src AS s
                INNER JOIN import_review.place_candidates AS pc ON pc.id = s.id
            )
            SELECT CASE
                WHEN NOT EXISTS (SELECT 1 FROM ready) THEN
                    'Place candidate not found for publish item.'
                WHEN (SELECT point_geom_ready IS NULL OR NOT ST_IsValid(point_geom_ready) OR ST_IsEmpty(point_geom_ready) FROM ready LIMIT 1) THEN
                    'Invalid or missing point geometry.'
                WHEN (SELECT primary_name_ready IS NULL FROM ready LIMIT 1) THEN
                    'Missing primary name.'
                WHEN (SELECT category_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'CATEGORY_REQUIRED: class_code or category_code does not map to ref.ref_poi_categories.code (category_id is required for core.core_places).'
                WHEN (SELECT source_type_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'Missing or unmapped source_type_id.'
                WHEN EXISTS (
                    SELECT 1 FROM ready AS r
                    INNER JOIN core.core_places AS c ON c.deleted_at IS NULL
                    WHERE r.external_id IS NOT NULL
                      AND trim(r.external_id) <> ''
                      AND c.external_id = r.external_id
                ) THEN
                    'Duplicate core.core_places row with same external_id.'
                ELSE
                    'Insert blocked by promotion guard.'
            END AS reason
        `;
        return rows[0]?.reason ?? "Insert blocked by promotion guard.";
    }

    private async explainPlaceUpdateBlocked(
        tx: Prisma.TransactionClient,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<string> {
        const rows = await tx.$queryRaw<{ reason: string }[]>`
            WITH src AS (
                SELECT ${PROMOTE_PLACE_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
                  AND p.matched_core_id IS NOT NULL
                  AND p.matched_core_table IN ('core_places', 'core.core_places')
            ),
            ready AS (
                SELECT
                    s.*,
                    ${placeCandidateReadyExprs(batchId)}
                FROM src AS s
                INNER JOIN import_review.place_candidates AS pc ON pc.id = s.id
            )
            SELECT CASE
                WHEN NOT EXISTS (SELECT 1 FROM ready) THEN
                    'Place candidate or matched core row not found.'
                WHEN (SELECT point_geom_ready IS NULL OR NOT ST_IsValid(point_geom_ready) FROM ready LIMIT 1) THEN
                    'Invalid or missing point geometry.'
                WHEN (SELECT primary_name_ready IS NULL FROM ready LIMIT 1) THEN
                    'Missing primary name.'
                WHEN (SELECT category_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'CATEGORY_REQUIRED: class_code or category_code does not map to ref.ref_poi_categories.code (category_id is required for core.core_places).'
                WHEN (SELECT source_type_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'Missing or unmapped source_type_id.'
                ELSE
                    'Update blocked: geometry invalid or target not updatable.'
            END AS reason
        `;
        return rows[0]?.reason ?? "Update blocked by promotion guard.";
    }

    private async syncPlaceNames(
        tx: Prisma.TransactionClient,
        publishItemId: bigint,
        placeId: bigint,
        primaryName: string
    ): Promise<void> {
        await tx.$executeRaw`
            WITH src AS (
                SELECT
                    p.normalized_data,
                    p.source_refs,
                    ${placePrimaryNameExpr("p")} AS primary_name_ready
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                WHERE spi.id = ${publishItemId}
            ),
            child_names AS (
                SELECT
                    nullif(trim(elem->>'name'), '') AS name,
                    nullif(trim(elem->>'language_code'), '') AS language_code,
                    nullif(trim(elem->>'script_code'), '') AS script_code,
                    coalesce(nullif(trim(elem->>'name_type'), ''), 'official') AS name_type,
                    coalesce((elem->>'is_primary')::boolean, false) AS is_primary,
                    coalesce((elem->>'search_weight')::integer, 0) AS search_weight
                FROM src AS s,
                LATERAL jsonb_array_elements(
                    coalesce(
                        s.normalized_data->'place_name_candidates',
                        s.source_refs->'place_name_candidates',
                        '[]'::jsonb
                    )
                ) AS elem
                WHERE nullif(trim(elem->>'name'), '') IS NOT NULL
                  AND coalesce(elem->>'name_type', '') <> 'generated'
                  AND coalesce(elem->'normalized_data'->>'is_generated', 'false') <> 'true'
                  AND coalesce(elem->>'source', '') <> 'generated'
            ),
            primary_row AS (
                SELECT
                    s.primary_name_ready AS name,
                    NULL::text AS language_code,
                    NULL::text AS script_code,
                    'primary'::text AS name_type,
                    true AS is_primary,
                    100 AS search_weight
                FROM src AS s
                WHERE s.primary_name_ready IS NOT NULL
            ),
            all_names AS (
                SELECT * FROM child_names
                UNION ALL
                SELECT pr.* FROM primary_row AS pr
                WHERE NOT EXISTS (
                    SELECT 1 FROM child_names AS cn
                    WHERE cn.name = pr.name
                      AND cn.name_type = pr.name_type
                      AND coalesce(cn.language_code, '') = coalesce(pr.language_code, '')
                )
            )
            INSERT INTO core.core_place_names (
                place_id, name, language_code, script_code, name_type, is_primary, search_weight
            )
            SELECT
                ${placeId},
                an.name,
                an.language_code,
                an.script_code,
                an.name_type,
                an.is_primary,
                an.search_weight
            FROM all_names AS an
            WHERE NOT EXISTS (
                SELECT 1 FROM core.core_place_names AS existing
                WHERE existing.place_id = ${placeId}
                  AND existing.name = an.name
                  AND coalesce(existing.language_code, '') = coalesce(an.language_code, '')
                  AND coalesce(existing.script_code, '') = coalesce(an.script_code, '')
                  AND existing.name_type = an.name_type
            )
        `;

        const nameCount = await tx.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM core.core_place_names
            WHERE place_id = ${placeId}
        `;
        if (Number(nameCount[0]?.count ?? 0n) === 0 && primaryName.trim()) {
            await tx.$executeRaw`
                INSERT INTO core.core_place_names (
                    place_id, name, language_code, script_code, name_type, is_primary, search_weight
                )
                VALUES (
                    ${placeId}, ${primaryName.trim()}, NULL, NULL, 'primary', true, 100
                )
            `;
        }
    }

    private async syncPlaceSources(
        tx: Prisma.TransactionClient,
        publishItemId: bigint,
        placeId: bigint,
        sourceTypeId: bigint,
        externalId: string | null
    ): Promise<void> {
        const exists = await this.tableExists("core.core_place_sources");
        if (!exists) {
            return;
        }

        await tx.$executeRaw`
            WITH src AS (
                SELECT
                    p.id AS candidate_id,
                    p.external_id,
                    p.source_refs,
                    p.normalized_data,
                    p.review_batch_id,
                    p.source_snapshot_version,
                    p.local_staging_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                WHERE spi.id = ${publishItemId}
            )
            INSERT INTO core.core_place_sources (
                place_id, source_type_id, external_id, source_name, source_priority, captured_at, raw_payload
            )
            SELECT
                ${placeId},
                ${sourceTypeId},
                nullif(trim(coalesce(s.external_id, ${externalId ?? ""})), ''),
                coalesce(
                    nullif(trim(s.source_refs->>'source_name'), ''),
                    nullif(trim(s.normalized_data->>'source_name'), ''),
                    'import_review'
                ),
                0,
                now(),
                jsonb_build_object(
                    'review_candidate_id', s.candidate_id,
                    'review_batch_id', s.review_batch_id,
                    'source_snapshot_version', s.source_snapshot_version,
                    'local_staging_id', s.local_staging_id,
                    'source_refs', s.source_refs
                )
            FROM src AS s
            WHERE nullif(trim(coalesce(s.external_id, ${externalId ?? ""})), '') IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM core.core_place_sources AS existing
                  WHERE existing.place_id = ${placeId}
                    AND existing.source_type_id = ${sourceTypeId}
                    AND coalesce(existing.external_id, '') = coalesce(
                        nullif(trim(coalesce(s.external_id, ${externalId ?? ""})), ''),
                        ''
                    )
              )
        `;
    }
}

export { CORE_PLACES_TABLE, PLACE_CANDIDATE_TABLE };
