import { Prisma } from "@prisma/client";

import type { PromotionDb } from "./import-review-promotion-db.js";

import { buildPromoteItemFailureResult } from "./import-review-promotion-failure.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    buildVerificationMetadataTracking,
    coreVerificationInsertColumnsSql,
    coreVerificationInsertValuesSql,
    coreVerificationUpdateSetClauseSql,
    getCoreVerificationColumnsForEntity,
} from "./import-review-promotion-core-verification.js";
import { assertPoiCategoriesTableExists } from "./import-review-promotion-place-category.js";
import {
    promotionTypedPlaceAdminAreaIdExpr,
    promotionTypedPlaceCategoryIdExpr,
    promotionTypedPlaceDisplayNameExpr,
    promotionTypedPlacePrimaryNameExpr,
} from "./import-review-promotion-typed-promote-sql.js";
import {
    normalizedDataMergeExpr,
    sourceRefsMergeExpr,
} from "./import-review-promotion-promote-sql.js";
import {
    fieldChoicesFromOverridesArchive,
    parseFieldChoicesFromReviewNote,
} from "./import-review-decision-publish-action.js";
import { resolvePlaceMergeFieldValues } from "./import-review-place-merge-fields.js";

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
    p.name_mm,
    p.name_en,
    p.source_refs,
    p.matched_core_id,
    p.matched_core_table,
    p.promotion_status,
    p.promoted_core_id
`;

function placePrimaryNameExpr(alias: string): Prisma.Sql {
    return promotionTypedPlacePrimaryNameExpr(alias);
}

function placeDisplayNameExpr(alias: string): Prisma.Sql {
    return promotionTypedPlaceDisplayNameExpr(alias);
}

function placeCategoryIdExpr(alias: string): Prisma.Sql {
    return promotionTypedPlaceCategoryIdExpr(alias);
}

function placeAdminAreaIdExpr(alias: string): Prisma.Sql {
    return promotionTypedPlaceAdminAreaIdExpr(alias);
}

function placePointGeomExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
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
            'osm'
        )
        LIMIT 1
    )`;
}

function placeIsPublicExpr(_alias: string): Prisma.Sql {
    return Prisma.sql`true`;
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
    constructor(private readonly prisma: PromotionDb) {}

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
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        return this.insertPlaceTx(this.prisma, batchId, publishItemId, promotedBy);
    }

    async promotePlaceTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        publishAction: "insert" | "update" | "merge" | "skip",
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        if (publishAction === "skip") {
            return this.skipPlaceTx(tx, batchId, publishItemId);
        }
        if (publishAction === "insert") {
            return this.insertPlaceTx(tx, batchId, publishItemId, promotedBy);
        }
        if (publishAction === "merge") {
            return this.mergePlaceTx(tx, batchId, publishItemId, promotedBy);
        }
        return this.updatePlaceTx(tx, batchId, publishItemId, promotedBy);
    }

    async skipPlaceTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
        const rows = await tx.$queryRaw<
            {
                matched_core_id: bigint | null;
                review_decision: string | null;
                external_id: string | null;
            }[]
        >`
            SELECT p.matched_core_id, p.review_decision, p.external_id
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.place_candidates AS p
                ON p.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return buildPromoteItemFailureResult({
                publishItemId,
                message: "Place candidate not found for skip publish item.",
            });
        }
        return {
            publish_item_id: publishItemId,
            outcome: "skipped",
            target_id: row.matched_core_id,
            error_message: null,
            before_data: null,
            after_data: {
                skipped: true,
                publish_action: "skip",
                review_decision: row.review_decision,
                external_id: row.external_id,
                matched_core_id: row.matched_core_id?.toString() ?? null,
                entity_family: "places",
            },
        };
    }

    async insertPlaceTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        try {
            await assertPoiCategoriesTableExists(tx);

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
                            CASE
                                WHEN lower(btrim(coalesce(s.review_decision, ''))) = 'insert_separate'
                                     AND nullif(trim(s.external_id), '') IS NOT NULL
                                    THEN trim(s.external_id) || ':ir-sep:' || s.id::text
                                ELSE s.external_id
                            END AS insert_external_id,
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
                                AND r.insert_external_id IS NOT NULL
                                AND trim(r.insert_external_id) <> ''
                                AND c.external_id = r.insert_external_id
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
                        nullif(trim(g.plus_code), ''),
                        coalesce(g.importance_score, 0),
                        coalesce(g.popularity_score, 0),
                        least(100, greatest(0, coalesce(g.confidence_score, 80))),
                        ${placeIsPublicExpr("g")}${coreVerificationInsertValuesSql(PLACE_VERIFICATION_COLUMNS)},
                        g.source_type_id_ready,
                        nullif(trim(g.insert_external_id), ''),
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
                return buildPromoteItemFailureResult({
                    publishItemId,
                    message: reason,
                });
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
        } catch (err) {
            const cause = err instanceof Error ? err : new Error(String(err));
            return buildPromoteItemFailureResult({
                publishItemId,
                message: `Place promotion failed: ${cause.message}`,
                err: cause,
            });
        }
    }

    async updatePlace(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        return this.updatePlaceTx(this.prisma, batchId, publishItemId, promotedBy);
    }

    async updatePlaceTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const beforeRows = await tx.$queryRaw<{ row_json: unknown }[]>`
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
            return buildPromoteItemFailureResult({
                publishItemId,
                message:
                    "Update blocked: matched_core_id missing, wrong matched_core_table, core row inactive, or dashboard-protected target.",
            });
        }

        await assertPoiCategoriesTableExists(tx);

        try {
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
                    plus_code = coalesce(nullif(trim(v.plus_code), ''), c.plus_code),
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
                return buildPromoteItemFailureResult({
                    publishItemId,
                    message: reason,
                    beforeData,
                });
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
        } catch (err) {
            const cause = err instanceof Error ? err : new Error(String(err));
            return buildPromoteItemFailureResult({
                publishItemId,
                message: `Place promotion failed: ${cause.message}`,
                err: cause,
                beforeData,
            });
        }
    }

    async mergePlaceTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const metaRows = await tx.$queryRaw<
            {
                candidate_id: bigint;
                matched_core_id: bigint | null;
                review_note: string | null;
                review_overrides_archive: unknown;
                review_decision: string | null;
                primary_name: string | null;
                display_name: string | null;
                category_id: bigint | null;
                admin_area_id: bigint | null;
                name_mm: string | null;
                name_en: string | null;
                plus_code: string | null;
                lat: number | null;
                lng: number | null;
                importance_score: number | null;
                popularity_score: number | null;
                confidence_score: number | null;
                core_primary_name: string | null;
                core_display_name: string | null;
                core_category_id: bigint | null;
                core_admin_area_id: bigint | null;
                core_name_mm: string | null;
                core_name_en: string | null;
                core_plus_code: string | null;
                core_lat: number | null;
                core_lng: number | null;
                core_importance: number | null;
                core_popularity: number | null;
                core_confidence: number | null;
                core_json: unknown;
            }[]
        >`
            SELECT
                p.id AS candidate_id,
                p.matched_core_id,
                p.review_note,
                p.review_overrides_archive,
                p.review_decision,
                p.primary_name,
                p.display_name,
                p.category_id,
                p.admin_area_id,
                p.name_mm,
                p.name_en,
                p.plus_code,
                p.lat,
                p.lng,
                p.importance_score::float8 AS importance_score,
                p.popularity_score::float8 AS popularity_score,
                p.confidence_score::float8 AS confidence_score,
                c.primary_name AS core_primary_name,
                c.display_name AS core_display_name,
                c.category_id AS core_category_id,
                c.admin_area_id AS core_admin_area_id,
                NULL::text AS core_name_mm,
                NULL::text AS core_name_en,
                c.plus_code AS core_plus_code,
                c.lat::float8 AS core_lat,
                c.lng::float8 AS core_lng,
                c.importance_score::float8 AS core_importance,
                c.popularity_score::float8 AS core_popularity,
                c.confidence_score::float8 AS core_confidence,
                to_jsonb(c) AS core_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.place_candidates AS p
                ON p.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
            INNER JOIN core.core_places AS c ON c.id = p.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
              AND p.matched_core_id IS NOT NULL
              AND p.matched_core_table IN ('core_places', 'core.core_places')
              AND c.deleted_at IS NULL
              AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
            LIMIT 1
        `;

        const meta = metaRows[0];
        if (!meta?.matched_core_id) {
            return buildPromoteItemFailureResult({
                publishItemId,
                message:
                    "Merge blocked: matched_core_id missing, inactive core, or dashboard-protected target.",
            });
        }

        const fromNote = parseFieldChoicesFromReviewNote(meta.review_note);
        const fromArchive = fieldChoicesFromOverridesArchive(meta.review_overrides_archive);
        const choices = { ...fromArchive, ...fromNote };
        if (Object.keys(choices).length === 0) {
            return buildPromoteItemFailureResult({
                publishItemId,
                message: "Merge blocked: merge_fields requires an explicit field_choices map.",
            });
        }

        const resolved = resolvePlaceMergeFieldValues({
            choices,
            existing: {
                primary_name: meta.core_primary_name,
                display_name: meta.core_display_name,
                category_id: meta.core_category_id,
                admin_area_id: meta.core_admin_area_id,
                name_mm: meta.core_name_mm,
                name_en: meta.core_name_en,
                plus_code: meta.core_plus_code,
                lat: meta.core_lat,
                lng: meta.core_lng,
                importance_score: meta.core_importance,
                popularity_score: meta.core_popularity,
                confidence_score: meta.core_confidence,
            },
            imported: {
                primary_name: meta.primary_name,
                display_name: meta.display_name,
                category_id: meta.category_id,
                admin_area_id: meta.admin_area_id,
                name_mm: meta.name_mm,
                name_en: meta.name_en,
                plus_code: meta.plus_code,
                lat: meta.lat,
                lng: meta.lng,
                importance_score: meta.importance_score,
                popularity_score: meta.popularity_score,
                confidence_score: meta.confidence_score,
            },
        });

        if (!resolved.primary_name) {
            return buildPromoteItemFailureResult({
                publishItemId,
                message: "Merge blocked: resolved primary_name is empty.",
                beforeData: meta.core_json,
            });
        }

        try {
            const pointGeom =
                resolved.lat != null && resolved.lng != null
                    ? Prisma.sql`ST_SetSRID(ST_MakePoint(${resolved.lng}, ${resolved.lat}), 4326)`
                    : Prisma.sql`point_geom`;

            const rows = await tx.$queryRaw<{ id: bigint; external_id: string | null; primary_name: string; display_name: string | null }[]>`
                UPDATE core.core_places
                SET
                    primary_name = ${resolved.primary_name},
                    display_name = coalesce(${resolved.display_name}, primary_name),
                    category_id = coalesce(${resolved.category_id}, category_id),
                    admin_area_id = coalesce(${resolved.admin_area_id}, admin_area_id),
                    plus_code = coalesce(${resolved.plus_code}, plus_code),
                    lat = coalesce(${resolved.lat}, lat),
                    lng = coalesce(${resolved.lng}, lng),
                    point_geom = ${pointGeom},
                    importance_score = coalesce(${resolved.importance_score}, importance_score),
                    popularity_score = coalesce(${resolved.popularity_score}, popularity_score),
                    confidence_score = coalesce(${resolved.confidence_score}, confidence_score),
                    updated_at = now()
                WHERE id = ${meta.matched_core_id}
                  AND deleted_at IS NULL
                RETURNING id, external_id, primary_name, display_name
            `;

            const row = rows[0];
            if (!row) {
                return buildPromoteItemFailureResult({
                    publishItemId,
                    message: "Merge blocked: core place update returned no row.",
                    beforeData: meta.core_json,
                });
            }

            return {
                publish_item_id: publishItemId,
                outcome: "updated",
                target_id: row.id,
                error_message: null,
                before_data: meta.core_json,
                after_data: {
                    id: row.id.toString(),
                    external_id: row.external_id,
                    primary_name: row.primary_name,
                    display_name: row.display_name,
                    entity_family: "places",
                    publish_action: "merge",
                    selected_fields: resolved.selected_fields,
                    review_decision: meta.review_decision,
                },
                ...buildVerificationMetadataTracking({
                    outcome: "updated",
                    beforeData: meta.core_json,
                    entityKey: "places",
                }),
            };
        } catch (err) {
            const cause = err instanceof Error ? err : new Error(String(err));
            return buildPromoteItemFailureResult({
                publishItemId,
                message: `Place merge failed: ${cause.message}`,
                err: cause,
                beforeData: meta.core_json,
            });
        }
    }

    private async explainPlaceInsertBlocked(
        db: PromotionDb,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<string> {
        const rows = await db.$queryRaw<{ reason: string }[]>`
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
                WHEN (SELECT category_id IS NOT NULL AND category_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'INVALID_CATEGORY_ID: typed category_id is not an active ref.ref_poi_categories row.'
                WHEN (SELECT category_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'CATEGORY_REQUIRED: typed category_id or class_code must map to ref.ref_poi_categories.'
                WHEN (SELECT admin_area_id IS NOT NULL AND admin_area_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'INVALID_ADMIN_AREA_ID: typed admin_area_id is not an active core.core_admin_areas row.'
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
        db: PromotionDb,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<string> {
        const rows = await db.$queryRaw<{ reason: string }[]>`
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
                WHEN (SELECT category_id IS NOT NULL AND category_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'INVALID_CATEGORY_ID: typed category_id is not an active ref.ref_poi_categories row.'
                WHEN (SELECT category_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'CATEGORY_REQUIRED: typed category_id or class_code must map to ref.ref_poi_categories.'
                WHEN (SELECT admin_area_id IS NOT NULL AND admin_area_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'INVALID_ADMIN_AREA_ID: typed admin_area_id is not an active core.core_admin_areas row.'
                WHEN (SELECT source_type_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'Missing or unmapped source_type_id.'
                ELSE
                    'Update blocked: geometry invalid or target not updatable.'
            END AS reason
        `;
        return rows[0]?.reason ?? "Update blocked by promotion guard.";
    }

    private async syncPlaceNames(
        db: PromotionDb,
        publishItemId: bigint,
        placeId: bigint,
        primaryName: string
    ): Promise<void> {
        await db.$executeRaw`
            WITH src AS (
                SELECT
                    nullif(trim(p.name_mm), '') AS name_mm,
                    nullif(trim(p.name_en), '') AS name_en,
                    ${placePrimaryNameExpr("p")} AS primary_name_ready
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                WHERE spi.id = ${publishItemId}
            ),
            typed_names AS (
                SELECT
                    s.name_mm AS name,
                    'my'::text AS language_code,
                    'MYMR'::text AS script_code,
                    'official'::text AS name_type,
                    true AS is_primary,
                    100 AS search_weight
                FROM src AS s
                WHERE s.name_mm IS NOT NULL
                UNION ALL
                SELECT
                    s.name_en,
                    'en',
                    'Latn',
                    'english',
                    CASE WHEN s.name_mm IS NULL THEN true ELSE false END,
                    90
                FROM src AS s
                WHERE s.name_en IS NOT NULL
            ),
            fallback_primary AS (
                SELECT
                    s.primary_name_ready AS name,
                    NULL::text AS language_code,
                    NULL::text AS script_code,
                    'primary'::text AS name_type,
                    true AS is_primary,
                    100 AS search_weight
                FROM src AS s
                WHERE s.primary_name_ready IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM typed_names)
            ),
            all_names AS (
                SELECT * FROM typed_names
                UNION ALL
                SELECT * FROM fallback_primary
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

        const nameCount = await db.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM core.core_place_names
            WHERE place_id = ${placeId}
        `;
        if (Number(nameCount[0]?.count ?? 0n) === 0 && primaryName.trim()) {
            await db.$executeRaw`
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
        db: PromotionDb,
        publishItemId: bigint,
        placeId: bigint,
        sourceTypeId: bigint,
        externalId: string | null
    ): Promise<void> {
        const exists = await this.tableExists("core.core_place_sources");
        if (!exists) {
            return;
        }

        await db.$executeRaw`
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
                coalesce(nullif(trim(s.source_refs->>'source_name'), ''), 'import_review'),
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
