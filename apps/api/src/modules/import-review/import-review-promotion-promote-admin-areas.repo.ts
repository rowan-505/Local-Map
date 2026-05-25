import { Prisma, type PrismaClient } from "@prisma/client";

import {
    deriveImportReviewNames,
    isMyanmarScript,
    trimString,
    type ImportReviewNameCandidate,
} from "./import-review-name-fields.js";
import {
    buildVerificationMetadataTracking,
    coreVerificationInsertColumnsSql,
    coreVerificationInsertValuesSql,
    coreVerificationUpdateSetClauseSql,
    getCoreVerificationColumnsForEntity,
} from "./import-review-promotion-core-verification.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    ImportReviewSchemaCapabilityRegistry,
    type ImportReviewEntityColumnCapabilities,
    type ImportReviewTargetColumnCapabilities,
} from "./import-review-schema-capabilities.js";

export const ADMIN_AREA_CANDIDATE_TABLE = "import_review.admin_area_candidates";
export const CORE_ADMIN_AREAS_TABLE = "core.core_admin_areas";
export const CORE_ADMIN_AREA_NAMES_TABLE = "core.core_admin_area_names";

const ADMIN_AREA_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("admin_areas");

type AdminAreaCandidateNameRow = ImportReviewNameCandidate & {
    id: bigint;
};

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function optionalColumnExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: string,
    typeSql: string
): Prisma.Sql {
    if (!caps.hasColumn(column)) {
        return Prisma.raw(`NULL::${typeSql}`);
    }
    return col(alias, column);
}

function optionalJsonTextExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    jsonColumn: "review_overrides" | "normalized_data" | "source_refs",
    key: string
): Prisma.Sql {
    if (!caps.hasColumn(jsonColumn)) {
        return Prisma.sql`NULL::text`;
    }
    return Prisma.sql`${col(alias, jsonColumn)}->>${key}`;
}

function effectiveTextExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "canonical_name" | "slug" | "external_id" | "class_code"
): Prisma.Sql {
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", column)},
            ${optionalColumnExpr(alias, caps, column, "text")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", column)},
            ''
        )), '')
    `;
}

function canonicalNameExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "canonical_name")},
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "name")},
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "name_mm")},
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "name_en")},
            ${optionalColumnExpr(alias, caps, "canonical_name", "text")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "canonical_name")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name:my")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name:en")},
            ''
        )), '')
    `;
}

function numericIdExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "admin_level_id" | "parent_id"
): Prisma.Sql {
    const direct = Prisma.sql`
        coalesce(
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "review_overrides", column)} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "review_overrides", column)}::bigint END,
            ${optionalColumnExpr(alias, caps, column, "bigint")},
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)}::bigint END
        )
    `;
    if (column !== "admin_level_id") {
        return direct;
    }
    return Prisma.sql`
        coalesce(
            ${direct},
            (
                SELECT al.id
                FROM ref.ref_admin_levels AS al
                WHERE al.code = lower(trim(coalesce(
                    ${optionalJsonTextExpr(alias, caps, "review_overrides", "admin_level_code")},
                    ${optionalJsonTextExpr(alias, caps, "normalized_data", "admin_level_code")},
                    ${optionalJsonTextExpr(alias, caps, "normalized_data", "admin_level")},
                    ${optionalJsonTextExpr(alias, caps, "review_overrides", "class_code")},
                    ${optionalColumnExpr(alias, caps, "class_code", "text")},
                    ${optionalJsonTextExpr(alias, caps, "normalized_data", "class_code")}
                )))
                LIMIT 1
            )
        )
    `;
}

function sourceTypeIdExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`(
        SELECT st.id
        FROM ref.ref_source_types AS st
        WHERE st.code = coalesce(
            nullif(trim(${optionalJsonTextExpr(alias, caps, "review_overrides", "source_type_code")}), ''),
            nullif(trim(${optionalJsonTextExpr(alias, caps, "source_refs", "source_type_code")}), ''),
            nullif(trim(${optionalJsonTextExpr(alias, caps, "source_refs", "source")}), ''),
            nullif(trim(${optionalJsonTextExpr(alias, caps, "normalized_data", "source_type_code")}), ''),
            nullif(trim(${optionalJsonTextExpr(alias, caps, "normalized_data", "source")}), ''),
            'osm'
        )
        LIMIT 1
    )`;
}

function geomExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    const geomColumn = optionalColumnExpr(alias, caps, "geom", "geometry");
    if (!caps.hasReviewOverrides) {
        return geomColumn;
    }
    return Prisma.sql`
        CASE
            WHEN ${col(alias, "review_overrides")} ? 'geom'
                 AND ${col(alias, "review_overrides")}->'geom' IS NOT NULL
                 AND jsonb_typeof(${col(alias, "review_overrides")}->'geom') = 'object'
            THEN ST_SetSRID(ST_GeomFromGeoJSON(${col(alias, "review_overrides")}->'geom'), 4326)
            ELSE ${geomColumn}
        END
    `;
}

function multiPolygonExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    const geom = geomExpr(alias, caps);
    return Prisma.sql`
        CASE
            WHEN ${geom} IS NULL THEN NULL::geometry(MultiPolygon, 4326)
            WHEN ST_GeometryType(${geom}) = 'ST_Polygon' THEN ST_Multi(${geom})::geometry(MultiPolygon, 4326)
            WHEN ST_GeometryType(${geom}) = 'ST_MultiPolygon' THEN ${geom}::geometry(MultiPolygon, 4326)
            ELSE NULL::geometry(MultiPolygon, 4326)
        END
    `;
}

function centroidExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    const centroid = optionalColumnExpr(alias, caps, "centroid", "geometry(Point,4326)");
    const geom = multiPolygonExpr(alias, caps);
    return Prisma.sql`
        coalesce(
            CASE WHEN ${centroid} IS NOT NULL
                      AND ST_GeometryType(${centroid}) = 'ST_Point'
                 THEN ${centroid}::geometry(Point, 4326)
            END,
            CASE WHEN ${geom} IS NOT NULL THEN ST_PointOnSurface(${geom})::geometry(Point, 4326) END
        )
    `;
}

function sourceRefsExpr(alias: string, caps: ImportReviewEntityColumnCapabilities, batchId: bigint): Prisma.Sql {
    return Prisma.sql`
        coalesce(${optionalColumnExpr(alias, caps, "source_refs", "jsonb")}, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
            'review_candidate_id', ${optionalColumnExpr(alias, caps, "id", "bigint")}::text,
            'review_batch_id', ${optionalColumnExpr(alias, caps, "review_batch_id", "bigint")}::text,
            'publish_batch_id', ${batchId}::text,
            'source_snapshot_version', ${optionalColumnExpr(alias, caps, "source_snapshot_version", "text")},
            'local_staging_id', ${optionalColumnExpr(alias, caps, "local_staging_id", "bigint")}::text,
            'entity_family', 'admin_areas'
        ))
    `;
}

function normalizedDataExpr(alias: string, caps: ImportReviewEntityColumnCapabilities, batchId: bigint): Prisma.Sql {
    return Prisma.sql`
        coalesce(${optionalColumnExpr(alias, caps, "normalized_data", "jsonb")}, '{}'::jsonb)
        || coalesce(${optionalColumnExpr(alias, caps, "review_overrides", "jsonb")}, '{}'::jsonb)
        || jsonb_build_object(
            'promotion', jsonb_build_object(
                'publish_batch_id', ${batchId}::text,
                'promoted_at', to_jsonb(now()),
                'entity_family', 'admin_areas',
                'source_table', ${ADMIN_AREA_CANDIDATE_TABLE}
            )
        )
    `;
}

function requiredReadyChecks(targetCaps: ImportReviewTargetColumnCapabilities): Prisma.Sql {
    const checks: Prisma.Sql[] = [];
    if (targetCaps.isRequired("admin_level_id")) checks.push(Prisma.sql`r.admin_level_id_ready IS NOT NULL`);
    if (targetCaps.isRequired("canonical_name")) checks.push(Prisma.sql`r.canonical_name_ready IS NOT NULL`);
    if (targetCaps.isRequired("slug")) checks.push(Prisma.sql`r.slug_ready IS NOT NULL`);
    if (targetCaps.isRequired("geom")) checks.push(Prisma.sql`r.geom_ready IS NOT NULL`);
    if (targetCaps.isRequired("centroid")) checks.push(Prisma.sql`r.centroid_ready IS NOT NULL`);
    if (targetCaps.isRequired("source_type_id")) checks.push(Prisma.sql`r.source_type_id_ready IS NOT NULL`);
    if (checks.length === 0) {
        return Prisma.sql`true`;
    }
    return Prisma.join(checks, " AND ");
}

function insertColumnsAndValues(
    targetCaps: ImportReviewTargetColumnCapabilities
): { columns: Prisma.Sql[]; values: Prisma.Sql[] } {
    const columns: Prisma.Sql[] = [];
    const values: Prisma.Sql[] = [];
    const add = (column: string, value: Prisma.Sql) => {
        if (targetCaps.hasColumn(column)) {
            columns.push(Prisma.raw(column));
            values.push(value);
        }
    };

    add("parent_id", Prisma.sql`g.parent_id_ready`);
    add("admin_level_id", Prisma.sql`g.admin_level_id_ready`);
    add("canonical_name", Prisma.sql`g.canonical_name_ready`);
    add("slug", Prisma.sql`g.slug_ready`);
    add("geom", Prisma.sql`g.geom_ready`);
    add("centroid", Prisma.sql`g.centroid_ready`);
    add("external_id", Prisma.sql`g.external_id_ready`);
    add("source_type_id", Prisma.sql`g.source_type_id_ready`);
    add("source_refs", Prisma.sql`g.merged_source_refs`);
    add("normalized_data", Prisma.sql`g.merged_normalized_data`);
    add("is_active", Prisma.sql`true`);
    add("created_at", Prisma.sql`now()`);
    add("updated_at", Prisma.sql`now()`);
    return { columns, values };
}

function updateSetSql(targetCaps: ImportReviewTargetColumnCapabilities): Prisma.Sql {
    const sets: Prisma.Sql[] = [];
    const add = (column: string, value: Prisma.Sql) => {
        if (targetCaps.hasColumn(column)) {
            sets.push(Prisma.sql`${Prisma.raw(column)} = ${value}`);
        }
    };
    add("parent_id", Prisma.sql`v.parent_id_ready`);
    add("admin_level_id", Prisma.sql`v.admin_level_id_ready`);
    add("canonical_name", Prisma.sql`v.canonical_name_ready`);
    add("slug", Prisma.sql`v.slug_ready`);
    add("geom", Prisma.sql`v.geom_ready`);
    add("centroid", Prisma.sql`v.centroid_ready`);
    add("external_id", Prisma.sql`v.external_id_ready`);
    add("source_type_id", Prisma.sql`v.source_type_id_ready`);
    add("source_refs", Prisma.sql`v.merged_source_refs`);
    add("normalized_data", Prisma.sql`v.merged_normalized_data`);
    add("is_active", Prisma.sql`true`);
    add("updated_at", Prisma.sql`now()`);
    if (sets.length === 0) {
        return Prisma.sql`id = c.id`;
    }
    return Prisma.join(sets, ", ");
}

function activeCoreWhereSql(alias: string, targetCaps: ImportReviewTargetColumnCapabilities): Prisma.Sql {
    const checks: Prisma.Sql[] = [];
    if (targetCaps.hasIsActive) {
        checks.push(Prisma.sql`coalesce(${Prisma.raw(alias)}.is_active, true)`);
    }
    if (targetCaps.hasDeletedAt) {
        checks.push(Prisma.sql`${Prisma.raw(alias)}.deleted_at IS NULL`);
    }
    if (checks.length === 0) {
        return Prisma.sql`true`;
    }
    return Prisma.join(checks, " AND ");
}

function unprotectedCoreWhereSql(alias: string, targetCaps: ImportReviewTargetColumnCapabilities): Prisma.Sql {
    const checks: Prisma.Sql[] = [];
    if (targetCaps.hasSourceRefs) {
        checks.push(Prisma.sql`NOT (${Prisma.raw(alias)}.source_refs @> '{"source":"dashboard"}'::jsonb)`);
        checks.push(Prisma.sql`NOT (${Prisma.raw(alias)}.source_refs @> '{"source":"manual"}'::jsonb)`);
    }
    if (targetCaps.hasIsVerified) {
        checks.push(Prisma.sql`coalesce(${Prisma.raw(alias)}.is_verified, false) = false`);
    }
    if (targetCaps.hasVerificationStatus) {
        checks.push(Prisma.sql`${Prisma.raw(alias)}.verification_status IS DISTINCT FROM 'verified'`);
    }
    if (checks.length === 0) {
        return Prisma.sql`true`;
    }
    return Prisma.join(checks, " AND ");
}

function insertDuplicateWhereSql(targetCaps: ImportReviewTargetColumnCapabilities): Prisma.Sql {
    const checks: Prisma.Sql[] = [];
    if (targetCaps.hasSlug) {
        checks.push(Prisma.sql`(v.slug_ready IS NOT NULL AND c.slug = v.slug_ready)`);
    }
    if (targetCaps.hasExternalId) {
        checks.push(Prisma.sql`(v.external_id_ready IS NOT NULL AND c.external_id = v.external_id_ready)`);
    }
    if (targetCaps.hasSourceRefs) {
        checks.push(Prisma.sql`c.source_refs->>'review_candidate_id' = v.candidate_id::text`);
    }
    if (checks.length === 0) {
        return Prisma.sql`false`;
    }
    return Prisma.join(checks, " OR ");
}

function readyFields(
    batchId: bigint,
    alias: string,
    caps: ImportReviewEntityColumnCapabilities
): Prisma.Sql {
    return Prisma.sql`
        ${optionalColumnExpr(alias, caps, "id", "bigint")} AS candidate_id,
        ${numericIdExpr(alias, caps, "parent_id")} AS parent_id_ready,
        ${numericIdExpr(alias, caps, "admin_level_id")} AS admin_level_id_ready,
        ${canonicalNameExpr(alias, caps)} AS canonical_name_ready,
        ${effectiveTextExpr(alias, caps, "slug")} AS slug_ready,
        ${multiPolygonExpr(alias, caps)} AS geom_ready,
        ${centroidExpr(alias, caps)} AS centroid_ready,
        ${effectiveTextExpr(alias, caps, "external_id")} AS external_id_ready,
        ${sourceTypeIdExpr(alias, caps)} AS source_type_id_ready,
        ${sourceRefsExpr(alias, caps, batchId)} AS merged_source_refs,
        ${normalizedDataExpr(alias, caps, batchId)} AS merged_normalized_data,
        ${optionalColumnExpr(alias, caps, "matched_core_id", "bigint")} AS matched_core_id_ready
    `;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function pushName(
    rows: Array<{ name: string; languageCode: string; scriptCode: string | null }>,
    name: string | null,
    languageCode: string
): void {
    const trimmed = trimString(name);
    if (!trimmed) {
        return;
    }
    const lowered = trimmed.toLowerCase();
    if (/^(osm|node|way|relation)[:/_-]?\d+$/i.test(lowered) || /^(node|way|relation)\/\d+$/i.test(lowered)) {
        return;
    }
    if (rows.some((row) => row.name.toLowerCase() === lowered && row.languageCode === languageCode)) {
        return;
    }
    rows.push({
        name: trimmed,
        languageCode,
        scriptCode: isMyanmarScript(trimmed) ? "Mymr" : null,
    });
}

export class ImportReviewPromotionPromoteAdminAreasRepository {
    private readonly schemaRegistry: ImportReviewSchemaCapabilityRegistry;

    constructor(private readonly prisma: PrismaClient) {
        this.schemaRegistry = new ImportReviewSchemaCapabilityRegistry(prisma);
    }

    async checkAdminAreaCoreExists(targetId: bigint): Promise<boolean> {
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_ADMIN_AREAS_TABLE);
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id FROM core.core_admin_areas
            WHERE id = ${targetId}
              AND ${activeCoreWhereSql("core_admin_areas", targetCaps)}
            LIMIT 1
        `);
        return rows.length > 0;
    }

    async insertAdminArea(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("admin_areas");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_ADMIN_AREAS_TABLE);
        const { columns, values } = insertColumnsAndValues(targetCaps);

        try {
            return await this.prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<
                    { id: bigint; canonical_name: string | null; slug: string | null; external_id: string | null }[]
                >(Prisma.sql`
                    WITH src AS (
                        SELECT aa.*
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.admin_area_candidates AS aa
                            ON aa.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${ADMIN_AREA_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                    ),
                    ready AS (
                        SELECT ${readyFields(batchId, "aa", caps)}
                        FROM src AS aa
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE ${requiredReadyChecks(targetCaps)}
                          AND r.geom_ready IS NOT NULL
                          AND ST_IsValid(r.geom_ready)
                          AND NOT ST_IsEmpty(r.geom_ready)
                          AND ST_SRID(r.geom_ready) = 4326
                    ),
                    guard AS (
                        SELECT v.*
                        FROM valid AS v
                        WHERE NOT EXISTS (
                            SELECT 1 FROM core.core_admin_areas AS c
                            WHERE ${activeCoreWhereSql("c", targetCaps)}
                              AND (${insertDuplicateWhereSql(targetCaps)})
                        )
                    )
                    INSERT INTO core.core_admin_areas (${Prisma.join(columns, ", ")}${coreVerificationInsertColumnsSql(ADMIN_AREA_VERIFICATION_COLUMNS)})
                    SELECT ${Prisma.join(values, ", ")}${coreVerificationInsertValuesSql(ADMIN_AREA_VERIFICATION_COLUMNS)}
                    FROM guard AS g
                    RETURNING id, canonical_name, slug, external_id
                `);

                if (rows.length === 0) {
                    const existing = await this.findExistingPromotedCore(tx, batchId, publishItemId);
                    if (existing) {
                        const namesSynced = await this.syncNames(tx, existing.id, publishItemId);
                        return {
                            publish_item_id: publishItemId,
                            outcome: "updated",
                            target_id: existing.id,
                            error_message: null,
                            before_data: existing.row_json,
                            after_data: {
                                id: existing.id.toString(),
                                skipped: "existing_lineage",
                                names_synced: namesSynced,
                                promoted_by: promotedBy?.toString() ?? null,
                            },
                            ...buildVerificationMetadataTracking({
                                outcome: "updated",
                                beforeData: existing.row_json,
                                entityKey: "admin_areas",
                            }),
                        };
                    }
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: "Admin area insert blocked: duplicate core row, invalid geometry, or missing required fields.",
                        before_data: null,
                        after_data: null,
                    };
                }

                const row = rows[0]!;
                const namesSynced = await this.syncNames(tx, row.id, publishItemId);
                return {
                    publish_item_id: publishItemId,
                    outcome: "inserted",
                    target_id: row.id,
                    error_message: null,
                    before_data: null,
                    after_data: {
                        id: row.id.toString(),
                        canonical_name: row.canonical_name,
                        slug: row.slug,
                        external_id: row.external_id,
                        names_synced: namesSynced,
                        promoted_by: promotedBy?.toString() ?? null,
                    },
                    ...buildVerificationMetadataTracking({
                        outcome: "inserted",
                        beforeData: null,
                        entityKey: "admin_areas",
                    }),
                };
            });
        } catch (err) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: err instanceof Error ? err.message : "Admin area insert failed.",
                before_data: null,
                after_data: null,
            };
        }
    }

    async updateAdminArea(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("admin_areas");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_ADMIN_AREAS_TABLE);

        const beforeRows = await this.prisma.$queryRaw<{ id: bigint; row_json: unknown }[]>`
            SELECT c.id, to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.admin_area_candidates AS aa
                ON aa.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${ADMIN_AREA_CANDIDATE_TABLE}
            INNER JOIN core.core_admin_areas AS c ON c.id = aa.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
              AND aa.matched_core_id IS NOT NULL
              AND ${activeCoreWhereSql("c", targetCaps)}
              AND ${unprotectedCoreWhereSql("c", targetCaps)}
            LIMIT 1
        `;
        const before = beforeRows[0];
        if (!before) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Admin area update blocked: matched_core_id missing, inactive, dashboard-protected, or verified.",
                before_data: null,
                after_data: null,
            };
        }

        try {
            return await this.prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<
                    { id: bigint; canonical_name: string | null; slug: string | null; external_id: string | null }[]
                >(Prisma.sql`
                    WITH src AS (
                        SELECT aa.*
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.admin_area_candidates AS aa
                            ON aa.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${ADMIN_AREA_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                          AND aa.matched_core_id IS NOT NULL
                    ),
                    ready AS (
                        SELECT ${readyFields(batchId, "aa", caps)}
                        FROM src AS aa
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE ${requiredReadyChecks(targetCaps)}
                          AND r.geom_ready IS NOT NULL
                          AND ST_IsValid(r.geom_ready)
                          AND NOT ST_IsEmpty(r.geom_ready)
                          AND ST_SRID(r.geom_ready) = 4326
                    )
                    UPDATE core.core_admin_areas AS c
                    SET ${updateSetSql(targetCaps)}${coreVerificationUpdateSetClauseSql("c", ADMIN_AREA_VERIFICATION_COLUMNS)}
                    FROM valid AS v
                    WHERE c.id = v.matched_core_id_ready
                      AND ${activeCoreWhereSql("c", targetCaps)}
                      AND ${unprotectedCoreWhereSql("c", targetCaps)}
                    RETURNING c.id, c.canonical_name, c.slug, c.external_id
                `);
                const row = rows[0];
                if (!row) {
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: "Admin area update blocked: invalid fields, references, geometry, or protected core row.",
                        before_data: before.row_json,
                        after_data: null,
                    };
                }
                const namesSynced = await this.syncNames(tx, row.id, publishItemId);
                return {
                    publish_item_id: publishItemId,
                    outcome: "updated",
                    target_id: row.id,
                    error_message: null,
                    before_data: before.row_json,
                    after_data: {
                        id: row.id.toString(),
                        canonical_name: row.canonical_name,
                        slug: row.slug,
                        external_id: row.external_id,
                        names_synced: namesSynced,
                        promoted_by: promotedBy?.toString() ?? null,
                    },
                    ...buildVerificationMetadataTracking({
                        outcome: "updated",
                        beforeData: before.row_json,
                        entityKey: "admin_areas",
                    }),
                };
            });
        } catch (err) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: err instanceof Error ? err.message : "Admin area update failed.",
                before_data: before.row_json,
                after_data: null,
            };
        }
    }

    private async findExistingPromotedCore(
        tx: Prisma.TransactionClient,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<{ id: bigint; row_json: unknown } | null> {
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_ADMIN_AREAS_TABLE);
        if (!targetCaps.hasSourceRefs) {
            return null;
        }
        const rows = await tx.$queryRaw<{ id: bigint; row_json: unknown }[]>(Prisma.sql`
            SELECT c.id, to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.admin_area_candidates AS aa
                ON aa.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${ADMIN_AREA_CANDIDATE_TABLE}
            INNER JOIN core.core_admin_areas AS c
                ON c.source_refs->>'review_candidate_id' = aa.id::text
               AND c.source_refs->>'publish_batch_id' = ${batchId}::text
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
              AND ${activeCoreWhereSql("c", targetCaps)}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async syncNames(
        tx: Prisma.TransactionClient,
        adminAreaId: bigint,
        publishItemId: bigint
    ): Promise<number> {
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_ADMIN_AREA_NAMES_TABLE);
        if (!targetCaps.hasColumn("admin_area_id") || !targetCaps.hasName) {
            return 0;
        }
        const candidateRows = await tx.$queryRaw<AdminAreaCandidateNameRow[]>`
            SELECT
                aa.id,
                aa.review_overrides,
                aa.canonical_name,
                aa.normalized_data,
                aa.external_id,
                aa.class_code
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.admin_area_candidates AS aa
                ON aa.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${ADMIN_AREA_CANDIDATE_TABLE}
            WHERE spi.id = ${publishItemId}
            LIMIT 1
        `;
        const candidate = candidateRows[0];
        if (!candidate) {
            return 0;
        }

        const names = deriveImportReviewNames(candidate);
        const rows: Array<{ name: string; languageCode: string; scriptCode: string | null }> = [];
        const overrides = asRecord(candidate.review_overrides);
        pushName(rows, trimString(overrides.name_mm), "my");
        pushName(rows, trimString(overrides.name_en), "en");
        pushName(rows, trimString(overrides.name), isMyanmarScript(trimString(overrides.name) ?? "") ? "my" : "und");
        pushName(rows, names.name_mm, "my");
        pushName(rows, names.name_en, "en");
        pushName(rows, names.name_und, "und");
        pushName(rows, candidate.canonical_name ?? null, isMyanmarScript(candidate.canonical_name ?? "") ? "my" : "und");

        let inserted = 0;
        for (const row of rows) {
            const columns: Prisma.Sql[] = [Prisma.sql`admin_area_id`, Prisma.sql`name`];
            const values: Prisma.Sql[] = [Prisma.sql`${adminAreaId}`, Prisma.sql`${row.name}`];
            if (targetCaps.hasLanguageCode) {
                columns.push(Prisma.sql`language_code`);
                values.push(Prisma.sql`${row.languageCode}`);
            }
            if (targetCaps.hasScriptCode) {
                columns.push(Prisma.sql`script_code`);
                values.push(Prisma.sql`${row.scriptCode}`);
            }
            if (targetCaps.hasNameType) {
                columns.push(Prisma.sql`name_type`);
                values.push(Prisma.sql`'primary'`);
            }
            if (targetCaps.hasIsPrimary) {
                columns.push(Prisma.sql`is_primary`);
                values.push(Prisma.sql`true`);
            }
            if (targetCaps.hasSearchWeight) {
                columns.push(Prisma.sql`search_weight`);
                values.push(Prisma.sql`100`);
            }
            const duplicateChecks: Prisma.Sql[] = [
                Prisma.sql`existing.admin_area_id = ${adminAreaId}`,
                Prisma.sql`lower(trim(existing.name)) = lower(trim(${row.name}))`,
            ];
            if (targetCaps.hasLanguageCode) {
                duplicateChecks.push(
                    Prisma.sql`coalesce(existing.language_code, '') = coalesce(${row.languageCode}, '')`
                );
            }
            if (targetCaps.hasScriptCode) {
                duplicateChecks.push(
                    Prisma.sql`coalesce(existing.script_code, '') = coalesce(${row.scriptCode}, '')`
                );
            }
            if (targetCaps.hasNameType) {
                duplicateChecks.push(Prisma.sql`coalesce(existing.name_type, '') = 'primary'`);
            }

            const result = await tx.$executeRaw(Prisma.sql`
                INSERT INTO core.core_admin_area_names (${Prisma.join(columns, ", ")})
                SELECT ${Prisma.join(values, ", ")}
                WHERE NOT EXISTS (
                    SELECT 1 FROM core.core_admin_area_names AS existing
                    WHERE ${Prisma.join(duplicateChecks, " AND ")}
                )
            `);
            inserted += Number(result);
        }
        return inserted;
    }
}
