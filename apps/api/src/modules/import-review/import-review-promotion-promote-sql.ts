import { Prisma } from "@prisma/client";

export function buildingClassCodeExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'class_code',
            ${a}.review_overrides->>'building_type',
            ${a}.class_code,
            ${a}.building_type,
            ${a}.normalized_data->>'class_code',
            ${a}.normalized_data->>'building_type',
            'yes'
        )), '')
    `;
}

export function mapClassCodeExpr(alias: string, fallback?: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const tail = fallback != null ? Prisma.sql`${fallback}` : Prisma.sql`''`;
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'class_code',
            ${a}.class_code,
            ${a}.normalized_data->>'class_code',
            ${a}.normalized_data->>'water_type',
            ${tail}
        )), '')
    `;
}

export function nameExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'name',
            ${a}.review_overrides->>'canonical_name',
            ${a}.name,
            ${a}.canonical_name,
            ${a}.normalized_data->>'name',
            ${a}.normalized_data->>'canonical_name',
            ''
        )), '')
    `;
}

export function externalIdExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'external_id',
            ${a}.external_id,
            ${a}.normalized_data->>'external_id',
            CASE
                WHEN ${a}.local_staging_id IS NOT NULL
                    THEN 'staging:' || ${a}.local_staging_id::text
            END,
            ''
        )), '')
    `;
}

export function geomSourceExpr(alias: string, geomColumn = "geom"): Prisma.Sql {
    const a = Prisma.raw(alias);
    const geomCol = Prisma.raw(geomColumn);
    return Prisma.sql`
        CASE
            WHEN ${a}.review_overrides ? 'geom'
                 AND ${a}.review_overrides->'geom' IS NOT NULL
                 AND jsonb_typeof(${a}.review_overrides->'geom') = 'object'
            THEN ST_SetSRID(ST_GeomFromGeoJSON(${a}.review_overrides->'geom'), 4326)
            ELSE ${a}.${geomCol}
        END
    `;
}

export function polygonToMultiPolygonSql(rawAlias: string): Prisma.Sql {
    const r = Prisma.raw(rawAlias);
    return Prisma.sql`
        CASE
            WHEN ${r}.g_raw IS NULL THEN NULL::geometry(MultiPolygon, 4326)
            WHEN ST_GeometryType(${r}.g_raw) = 'ST_Polygon'
                THEN ST_Multi(${r}.g_raw)::geometry(MultiPolygon, 4326)
            WHEN ST_GeometryType(${r}.g_raw) = 'ST_MultiPolygon'
                THEN ${r}.g_raw::geometry(MultiPolygon, 4326)
            ELSE NULL::geometry(MultiPolygon, 4326)
        END
    `;
}

export function lineToMultiLineStringSql(rawAlias: string): Prisma.Sql {
    const r = Prisma.raw(rawAlias);
    return Prisma.sql`
        CASE
            WHEN ${r}.g_raw IS NULL THEN NULL::geometry(MultiLineString, 4326)
            WHEN ST_GeometryType(${r}.g_raw) = 'ST_LineString'
                THEN ST_Multi(${r}.g_raw)::geometry(MultiLineString, 4326)
            WHEN ST_GeometryType(${r}.g_raw) = 'ST_MultiLineString'
                THEN ${r}.g_raw::geometry(MultiLineString, 4326)
            ELSE NULL::geometry(MultiLineString, 4326)
        END
    `;
}

export function sourceRefsMergeExpr(
    alias: string,
    batchId: bigint,
    entityFamily: string
): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(${a}.source_refs, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
            'review_candidate_id', ${a}.id::text,
            'review_batch_id', ${a}.review_batch_id::text,
            'source_snapshot_version', ${a}.source_snapshot_version,
            'local_staging_id', ${a}.local_staging_id::text,
            'publish_batch_id', ${batchId}::text,
            'entity_family', ${entityFamily}
        ))
    `;
}

export function normalizedDataMergeExpr(alias: string, batchId: bigint): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(${a}.normalized_data, '{}'::jsonb)
        || coalesce(${a}.review_overrides, '{}'::jsonb)
        || jsonb_build_object(
            'promotion', jsonb_build_object(
                'publish_batch_id', ${batchId}::text,
                'promoted_at', to_jsonb(now())
            )
        )
    `;
}

/** Map candidate columns for core INSERT/UPDATE (excludes geom to avoid ambiguous aliases). */
export function mapCandidateSrcColumns(
    candidateAlias: string,
    candidateTable: string
): Prisma.Sql {
    const c = Prisma.raw(candidateAlias);
    return Prisma.sql`
        spi.id AS publish_item_id,
        ${c}.id,
        ${c}.review_batch_id,
        ${c}.source_snapshot_version,
        ${c}.local_staging_id,
        ${c}.external_id,
        ${c}.name,
        ${c}.canonical_name,
        ${c}.class_code,
        ${c}.normalized_data,
        ${c}.review_overrides,
        ${c}.source_refs,
        ${c}.matched_core_id,
        ${c}.geom AS candidate_geom
    `;
}

export function mapPrepRow(geomCaseSql: Prisma.Sql, alias = "r"): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        ${a}.publish_item_id,
        ${a}.id,
        ${a}.review_batch_id,
        ${a}.source_snapshot_version,
        ${a}.local_staging_id,
        ${a}.external_id,
        ${a}.name,
        ${a}.canonical_name,
        ${a}.class_code,
        ${a}.normalized_data,
        ${a}.review_overrides,
        ${a}.source_refs,
        ${a}.matched_core_id,
        ${geomCaseSql} AS geom
    `;
}

export function mapReadyRow(alias = "p"): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        ${a}.publish_item_id,
        ${a}.id,
        ${a}.review_batch_id,
        ${a}.source_snapshot_version,
        ${a}.local_staging_id,
        ${a}.external_id,
        ${a}.name,
        ${a}.canonical_name,
        ${a}.class_code,
        ${a}.normalized_data,
        ${a}.review_overrides,
        ${a}.source_refs,
        ${a}.matched_core_id,
        ${a}.geom
    `;
}
