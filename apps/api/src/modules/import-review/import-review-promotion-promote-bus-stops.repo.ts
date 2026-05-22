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
    busStopAdminAreaIdExpr,
    busStopDisplayNameExpr,
    busStopNameLocalExpr,
    busStopPointGeomExpr,
    busStopPrimaryRealNameExpr,
    busStopStopCodeExpr,
} from "./import-review-effective-values.js";
import {
    externalIdExpr,
    normalizedDataMergeExpr,
    sourceRefsMergeExpr,
} from "./import-review-promotion-promote-sql.js";

export const BUS_STOP_CANDIDATE_TABLE = "import_review.bus_stop_candidates";
export const CORE_BUS_STOPS_TABLE = "core.core_bus_stops";

const BUS_STOP_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("bus_stops");
const BUS_STOP_CANDIDATE_SQL_ALIAS = "bs";

const PROMOTE_BUS_STOP_SRC_COLUMNS = Prisma.sql`
    spi.id AS publish_item_id,
    bs.id,
    bs.review_batch_id,
    bs.source_snapshot_version,
    bs.local_staging_id,
    bs.external_id,
    bs.canonical_name,
    bs.stop_code,
    bs.admin_area_id,
    bs.geom,
    bs.normalized_data,
    bs.review_overrides,
    bs.source_refs,
    bs.matched_core_id,
    bs.matched_core_table,
    bs.promotion_status,
    bs.promoted_core_id
`;

function busStopSourceTypeIdExpr(alias: string): Prisma.Sql {
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

function busStopCandidateReadyExprs(batchId: bigint): Prisma.Sql {
    const bs = BUS_STOP_CANDIDATE_SQL_ALIAS;
    return Prisma.sql`
        ${busStopPointGeomExpr(bs)} AS geom_ready,
        ${busStopPrimaryRealNameExpr(bs)} AS primary_name_ready,
        ${busStopDisplayNameExpr(bs)} AS display_name_ready,
        ${busStopNameLocalExpr(bs)} AS name_local_ready,
        ${busStopStopCodeExpr(bs)} AS stop_code_ready,
        ${busStopAdminAreaIdExpr(bs)} AS admin_area_id_ready,
        ${busStopSourceTypeIdExpr(bs)} AS source_type_id_ready,
        ${externalIdExpr(bs)} AS external_id_ready,
        ${sourceRefsMergeExpr(bs, batchId, "bus_stops")} AS merged_source_refs,
        ${normalizedDataMergeExpr(bs, batchId)} AS merged_normalized_data
    `;
}

export class ImportReviewPromotionPromoteBusStopsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async checkBusStopCoreExists(targetId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM core.core_bus_stops
            WHERE id = ${targetId}
              AND coalesce(is_active, true)
            LIMIT 1
        `;
        return rows.length > 0;
    }

    async insertBusStop(batchId: bigint, publishItemId: bigint): Promise<PromoteItemResult> {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<
                    {
                        id: bigint;
                        external_id: string | null;
                        name: string;
                        name_local: string | null;
                        stop_code: string | null;
                        candidate_id: bigint;
                        primary_name_ready: string | null;
                    }[]
                >`
                    WITH src AS (
                        SELECT ${PROMOTE_BUS_STOP_SRC_COLUMNS}
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.bus_stop_candidates AS bs
                            ON bs.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${BUS_STOP_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                    ),
                    ready AS (
                        SELECT
                            s.*,
                            ${busStopCandidateReadyExprs(batchId)}
                        FROM src AS s
                        INNER JOIN import_review.bus_stop_candidates AS bs ON bs.id = s.id
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE r.geom_ready IS NOT NULL
                          AND ST_IsValid(r.geom_ready)
                          AND NOT ST_IsEmpty(r.geom_ready)
                          AND ST_SRID(r.geom_ready) = 4326
                          AND upper(ST_GeometryType(r.geom_ready)) = 'ST_POINT'
                          AND r.display_name_ready IS NOT NULL
                          AND trim(r.display_name_ready) <> ''
                          AND r.source_type_id_ready IS NOT NULL
                          AND r.external_id_ready IS NOT NULL
                    ),
                    guard AS (
                        SELECT v.*
                        FROM valid AS v
                        WHERE NOT EXISTS (
                            SELECT 1 FROM core.core_bus_stops AS c
                            WHERE coalesce(c.is_active, true)
                              AND c.external_id = v.external_id_ready
                        )
                    )
                    INSERT INTO core.core_bus_stops (
                        external_id, name, name_local, stop_code, geom, admin_area_id,
                        source_type_id, normalized_data, source_refs,
                        is_active${coreVerificationInsertColumnsSql(BUS_STOP_VERIFICATION_COLUMNS)},
                        created_at, updated_at
                    )
                    SELECT
                        g.external_id_ready,
                        g.display_name_ready,
                        g.name_local_ready,
                        g.stop_code_ready,
                        g.geom_ready,
                        g.admin_area_id_ready,
                        g.source_type_id_ready,
                        g.merged_normalized_data,
                        g.merged_source_refs,
                        true${coreVerificationInsertValuesSql(BUS_STOP_VERIFICATION_COLUMNS)},
                        now(),
                        now()
                    FROM guard AS g
                    RETURNING id, external_id, name, name_local, stop_code
                `;

                if (rows.length === 0) {
                    const reason = await this.explainBusStopInsertBlocked(tx, batchId, publishItemId);
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
                const namesSynced = await this.syncBusStopNames(
                    tx,
                    publishItemId,
                    row.id,
                    row.name
                );

                const verificationMeta = buildVerificationMetadataTracking({
                    outcome: "inserted",
                    beforeData: null,
                    entityKey: "bus_stops",
                });
                return {
                    publish_item_id: publishItemId,
                    outcome: "inserted",
                    target_id: row.id,
                    error_message: null,
                    before_data: null,
                    after_data: {
                        id: row.id.toString(),
                        external_id: row.external_id,
                        name: row.name,
                        name_local: row.name_local,
                        stop_code: row.stop_code,
                        names_synced: namesSynced,
                    },
                    ...verificationMeta,
                };
            });
        } catch (err) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: err instanceof Error ? err.message : "Bus stop insert failed.",
                before_data: null,
                after_data: null,
            };
        }
    }

    async updateBusStop(batchId: bigint, publishItemId: bigint): Promise<PromoteItemResult> {
        const beforeRows = await this.prisma.$queryRaw<{ row_json: unknown }[]>`
            SELECT to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.bus_stop_candidates AS bs
                ON bs.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${BUS_STOP_CANDIDATE_TABLE}
            INNER JOIN core.core_bus_stops AS c ON c.id = bs.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND bs.matched_core_id IS NOT NULL
              AND coalesce(c.is_active, true)
              AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
              AND NOT (
                  coalesce(c.is_verified, false) = true
                  OR c.verification_status = 'verified'
              )
            LIMIT 1
        `;
        const beforeData = beforeRows[0]?.row_json ?? null;
        if (!beforeData) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message:
                    "Update blocked: matched_core_id missing, core row inactive, dashboard-protected, or already verified.",
                before_data: null,
                after_data: null,
            };
        }

        try {
            return await this.prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<
                    {
                        id: bigint;
                        external_id: string | null;
                        name: string;
                        name_local: string | null;
                        stop_code: string | null;
                    }[]
                >`
                    WITH src AS (
                        SELECT ${PROMOTE_BUS_STOP_SRC_COLUMNS}
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.bus_stop_candidates AS bs
                            ON bs.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${BUS_STOP_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                          AND bs.matched_core_id IS NOT NULL
                    ),
                    ready AS (
                        SELECT
                            s.*,
                            ${busStopCandidateReadyExprs(batchId)}
                        FROM src AS s
                        INNER JOIN import_review.bus_stop_candidates AS bs ON bs.id = s.id
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE r.geom_ready IS NOT NULL
                          AND ST_IsValid(r.geom_ready)
                          AND NOT ST_IsEmpty(r.geom_ready)
                          AND r.display_name_ready IS NOT NULL
                          AND r.source_type_id_ready IS NOT NULL
                          AND r.external_id_ready IS NOT NULL
                    )
                    UPDATE core.core_bus_stops AS c
                    SET
                        external_id = v.external_id_ready,
                        name = v.display_name_ready,
                        name_local = v.name_local_ready,
                        stop_code = v.stop_code_ready,
                        geom = v.geom_ready,
                        admin_area_id = v.admin_area_id_ready,
                        source_type_id = v.source_type_id_ready,
                        normalized_data = v.merged_normalized_data,
                        source_refs = v.merged_source_refs,
                        is_active = true${coreVerificationUpdateSetClauseSql("c", BUS_STOP_VERIFICATION_COLUMNS)},
                        updated_at = now()
                    FROM valid AS v
                    WHERE c.id = v.matched_core_id
                      AND coalesce(c.is_active, true)
                      AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
                      AND NOT (
                          coalesce(c.is_verified, false) = true
                          OR c.verification_status = 'verified'
                      )
                    RETURNING c.id, c.external_id, c.name, c.name_local, c.stop_code
                `;

                if (rows.length === 0) {
                    const reason = await this.explainBusStopUpdateBlocked(tx, batchId, publishItemId);
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
                const namesSynced = await this.syncBusStopNames(
                    tx,
                    publishItemId,
                    row.id,
                    row.name
                );

                const verificationMeta = buildVerificationMetadataTracking({
                    outcome: "updated",
                    beforeData,
                    entityKey: "bus_stops",
                });
                return {
                    publish_item_id: publishItemId,
                    outcome: "updated",
                    target_id: row.id,
                    error_message: null,
                    before_data: beforeData,
                    after_data: {
                        id: row.id.toString(),
                        external_id: row.external_id,
                        name: row.name,
                        name_local: row.name_local,
                        stop_code: row.stop_code,
                        names_synced: namesSynced,
                    },
                    ...verificationMeta,
                };
            });
        } catch (err) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: err instanceof Error ? err.message : "Bus stop update failed.",
                before_data: beforeData,
                after_data: null,
            };
        }
    }

    private async explainBusStopInsertBlocked(
        tx: Prisma.TransactionClient,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<string> {
        const rows = await tx.$queryRaw<{ reason: string }[]>`
            WITH src AS (
                SELECT ${PROMOTE_BUS_STOP_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.bus_stop_candidates AS bs
                    ON bs.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUS_STOP_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
            ),
            ready AS (
                SELECT s.*, ${busStopCandidateReadyExprs(batchId)}
                FROM src AS s
                INNER JOIN import_review.bus_stop_candidates AS bs ON bs.id = s.id
            )
            SELECT CASE
                WHEN NOT EXISTS (SELECT 1 FROM ready) THEN 'Bus stop candidate not found.'
                WHEN (SELECT geom_ready IS NULL OR NOT ST_IsValid(geom_ready) FROM ready LIMIT 1) THEN
                    'Invalid or missing point geometry.'
                WHEN (SELECT display_name_ready IS NULL OR trim(display_name_ready) = '' FROM ready LIMIT 1) THEN
                    'Missing display name.'
                WHEN (SELECT source_type_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'Missing or unmapped source_type_id.'
                WHEN (SELECT external_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'Missing external_id.'
                WHEN EXISTS (
                    SELECT 1 FROM ready AS r
                    INNER JOIN core.core_bus_stops AS c
                        ON coalesce(c.is_active, true) AND c.external_id = r.external_id_ready
                ) THEN 'Duplicate active core bus stop with same external_id.'
                ELSE 'Insert blocked by promotion guard.'
            END AS reason
        `;
        return rows[0]?.reason ?? "Insert blocked by promotion guard.";
    }

    private async explainBusStopUpdateBlocked(
        tx: Prisma.TransactionClient,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<string> {
        const rows = await tx.$queryRaw<{ reason: string }[]>`
            WITH src AS (
                SELECT ${PROMOTE_BUS_STOP_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.bus_stop_candidates AS bs
                    ON bs.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUS_STOP_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
                  AND bs.matched_core_id IS NOT NULL
            ),
            ready AS (
                SELECT s.*, ${busStopCandidateReadyExprs(batchId)}
                FROM src AS s
                INNER JOIN import_review.bus_stop_candidates AS bs ON bs.id = s.id
            )
            SELECT CASE
                WHEN NOT EXISTS (SELECT 1 FROM ready) THEN
                    'Bus stop candidate or matched core row not found.'
                WHEN (SELECT geom_ready IS NULL OR NOT ST_IsValid(geom_ready) FROM ready LIMIT 1) THEN
                    'Invalid or missing point geometry.'
                WHEN (SELECT display_name_ready IS NULL FROM ready LIMIT 1) THEN
                    'Missing display name.'
                WHEN (SELECT source_type_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'Missing or unmapped source_type_id.'
                ELSE 'Update blocked: geometry invalid or target not updatable.'
            END AS reason
        `;
        return rows[0]?.reason ?? "Update blocked by promotion guard.";
    }

    private async syncBusStopNames(
        tx: Prisma.TransactionClient,
        publishItemId: bigint,
        stopId: bigint,
        displayName: string
    ): Promise<number> {
        await tx.$executeRaw`
            WITH src AS (
                SELECT
                    bs.normalized_data,
                    bs.review_overrides,
                    bs.source_refs,
                    ${busStopPrimaryRealNameExpr("bs")} AS primary_name_ready,
                    ${busStopNameLocalExpr("bs")} AS name_local_ready,
                    ${busStopStopCodeExpr("bs")} AS stop_code_ready
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.bus_stop_candidates AS bs
                    ON bs.id = spi.review_candidate_id
                WHERE spi.id = ${publishItemId}
            ),
            child_names AS (
                SELECT
                    nullif(trim(elem->>'name'), '') AS name,
                    coalesce(nullif(trim(elem->>'language_code'), ''), 'und') AS language_code,
                    coalesce(nullif(trim(elem->>'name_type'), ''), 'alternate') AS name_type,
                    coalesce((elem->>'is_primary')::boolean, false) AS is_primary
                FROM src AS s,
                LATERAL jsonb_array_elements(
                    coalesce(s.normalized_data->'names', '[]'::jsonb)
                ) AS elem
                WHERE nullif(trim(elem->>'name'), '') IS NOT NULL
                  AND coalesce(elem->>'name_type', '') <> 'generated'
                  AND coalesce(elem->>'source', '') <> 'generated'
            ),
            primary_row AS (
                SELECT
                    s.primary_name_ready AS name,
                    'und'::text AS language_code,
                    'primary'::text AS name_type,
                    true AS is_primary
                FROM src AS s
                WHERE s.primary_name_ready IS NOT NULL
                  AND (
                      s.stop_code_ready IS NULL
                      OR trim(s.primary_name_ready) <> trim(s.stop_code_ready)
                  )
            ),
            local_row AS (
                SELECT
                    s.name_local_ready AS name,
                    'und'::text AS language_code,
                    'local'::text AS name_type,
                    false AS is_primary
                FROM src AS s
                WHERE s.name_local_ready IS NOT NULL
                  AND (
                      s.primary_name_ready IS NULL
                      OR trim(s.name_local_ready) <> trim(s.primary_name_ready)
                  )
                  AND (
                      s.stop_code_ready IS NULL
                      OR trim(s.name_local_ready) <> trim(s.stop_code_ready)
                  )
            ),
            all_names AS (
                SELECT * FROM child_names
                UNION ALL
                SELECT pr.* FROM primary_row AS pr
                UNION ALL
                SELECT lr.* FROM local_row AS lr
            )
            INSERT INTO core.core_bus_stop_names (
                stop_id, name, language_code, name_type, is_primary
            )
            SELECT
                ${stopId},
                an.name,
                an.language_code,
                an.name_type,
                an.is_primary
            FROM all_names AS an
            WHERE NOT EXISTS (
                SELECT 1 FROM core.core_bus_stop_names AS existing
                WHERE existing.stop_id = ${stopId}
                  AND existing.name = an.name
                  AND coalesce(existing.language_code, '') = coalesce(an.language_code, '')
                  AND existing.name_type = an.name_type
            )
        `;

        const countRows = await tx.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM core.core_bus_stop_names
            WHERE stop_id = ${stopId}
        `;
        const total = Number(countRows[0]?.count ?? 0n);

        if (total === 0 && displayName.trim() && !displayName.startsWith("Bus stop ")) {
            await tx.$executeRaw`
                INSERT INTO core.core_bus_stop_names (
                    stop_id, name, language_code, name_type, is_primary
                )
                SELECT ${stopId}, ${displayName.trim()}, 'und', 'primary', true
                WHERE NOT EXISTS (
                    SELECT 1 FROM core.core_bus_stop_names AS existing
                    WHERE existing.stop_id = ${stopId}
                      AND existing.name_type = 'primary'
                      AND existing.is_primary = true
                )
            `;
            return 1;
        }

        return total;
    }
}
