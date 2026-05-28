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

/** Raw imported label → flat active ref.ref_building_types.code (061 simplification). */
export function simplifiedBuildingClassCodeExpr(alias: string): Prisma.Sql {
    const raw = buildingClassCodeExpr(alias);
    return Prisma.sql`
        coalesce(
            (
                SELECT m.target_code
                FROM ref.ref_building_type_merge_map AS m
                WHERE m.source_code = lower(btrim(${raw}::text))
                LIMIT 1
            ),
            CASE lower(btrim(${raw}::text))
                WHEN 'yes' THEN 'unknown'
                WHEN 'building' THEN 'unknown'
                WHEN 'house' THEN 'residential'
                WHEN 'apartment' THEN 'residential'
                WHEN 'apartments' THEN 'residential'
                WHEN 'dormitory' THEN 'residential'
                WHEN 'townhouse' THEN 'residential'
                WHEN 'villa' THEN 'residential'
                WHEN 'office' THEN 'commercial'
                WHEN 'retail' THEN 'commercial'
                WHEN 'shopping_mall' THEN 'commercial'
                WHEN 'supermarket' THEN 'commercial'
                WHEN 'market' THEN 'commercial'
                WHEN 'hotel' THEN 'commercial'
                WHEN 'restaurant_building' THEN 'commercial'
                WHEN 'restaurant' THEN 'commercial'
                WHEN 'cafe' THEN 'commercial'
                WHEN 'shop' THEN 'commercial'
                WHEN 'showroom' THEN 'commercial'
                WHEN 'school' THEN 'education'
                WHEN 'university' THEN 'education'
                WHEN 'library' THEN 'education'
                WHEN 'training_center' THEN 'education'
                WHEN 'hospital' THEN 'healthcare'
                WHEN 'clinic' THEN 'healthcare'
                WHEN 'pharmacy_building' THEN 'healthcare'
                WHEN 'laboratory' THEN 'healthcare'
                WHEN 'health_center' THEN 'healthcare'
                WHEN 'government_office' THEN 'government_civic'
                WHEN 'township_office' THEN 'government_civic'
                WHEN 'courthouse' THEN 'government_civic'
                WHEN 'police_station' THEN 'government_civic'
                WHEN 'fire_station' THEN 'government_civic'
                WHEN 'post_office' THEN 'government_civic'
                WHEN 'community_center' THEN 'government_civic'
                WHEN 'pagoda' THEN 'religious'
                WHEN 'monastery' THEN 'religious'
                WHEN 'church' THEN 'religious'
                WHEN 'mosque' THEN 'religious'
                WHEN 'temple' THEN 'religious'
                WHEN 'religious_complex' THEN 'religious'
                WHEN 'factory' THEN 'industrial'
                WHEN 'workshop' THEN 'industrial'
                WHEN 'processing_plant' THEN 'industrial'
                WHEN 'warehouse' THEN 'warehouse_storage'
                WHEN 'bus_terminal' THEN 'transport'
                WHEN 'train_station' THEN 'transport'
                WHEN 'ferry_terminal' THEN 'transport'
                WHEN 'airport_terminal' THEN 'transport'
                WHEN 'parking_structure' THEN 'transport'
                WHEN 'depot' THEN 'transport'
                WHEN 'farm_building' THEN 'agriculture'
                WHEN 'barn' THEN 'agriculture'
                WHEN 'greenhouse' THEN 'agriculture'
                WHEN 'livestock_structure' THEN 'agriculture'
                WHEN 'recreation_entertainment' THEN 'recreation'
                WHEN 'stadium' THEN 'recreation'
                WHEN 'cinema' THEN 'recreation'
                WHEN 'gym' THEN 'recreation'
                WHEN 'recreation_center' THEN 'recreation'
                WHEN 'telecom' THEN 'utility_infrastructure'
                WHEN 'water_facility' THEN 'utility_infrastructure'
                WHEN 'electrical_substation' THEN 'utility_infrastructure'
                WHEN 'sewage_facility' THEN 'utility_infrastructure'
                WHEN 'waste_management' THEN 'utility_infrastructure'
                WHEN 'military' THEN 'military_restricted'
                WHEN 'checkpoint' THEN 'military_restricted'
                WHEN 'restricted_facility' THEN 'military_restricted'
                WHEN 'mixed_use_lowrise' THEN 'mixed_use'
                WHEN 'mixed_use_highrise' THEN 'mixed_use'
                WHEN 'integrated_complex' THEN 'mixed_use'
                WHEN 'temporary_structure' THEN 'temporary_informal'
                WHEN 'kiosk' THEN 'temporary_informal'
                WHEN 'market_stall' THEN 'temporary_informal'
                WHEN 'informal_structure' THEN 'temporary_informal'
                WHEN 'generic_building' THEN 'unknown'
                WHEN 'unclassified' THEN 'unknown'
                WHEN 'residential' THEN 'residential'
                WHEN 'commercial' THEN 'commercial'
                WHEN 'mixed_use' THEN 'mixed_use'
                WHEN 'education' THEN 'education'
                WHEN 'healthcare' THEN 'healthcare'
                WHEN 'government_civic' THEN 'government_civic'
                WHEN 'religious' THEN 'religious'
                WHEN 'industrial' THEN 'industrial'
                WHEN 'warehouse_storage' THEN 'warehouse_storage'
                WHEN 'transport' THEN 'transport'
                WHEN 'utility_infrastructure' THEN 'utility_infrastructure'
                WHEN 'agriculture' THEN 'agriculture'
                WHEN 'recreation' THEN 'recreation'
                WHEN 'military_restricted' THEN 'military_restricted'
                WHEN 'temporary_informal' THEN 'temporary_informal'
                WHEN 'unknown' THEN 'unknown'
                ELSE NULL
            END,
            'unknown'
        )
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
            ${a}.review_overrides->>'name_en',
            ${a}.review_overrides->>'name_mm',
            ${a}.review_overrides->>'name',
            ${a}.review_overrides->>'canonical_name',
            ${a}.name,
            ${a}.canonical_name,
            ${a}.normalized_data->>'name:en',
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

/** Meters along effective road centerline (override geom when present, else candidate geom). */
export function effectiveRoadLengthMExpr(alias: string, geomColumn = "geom"): Prisma.Sql {
    const effectiveGeom = geomSourceExpr(alias, geomColumn);
    return Prisma.sql`
        CASE
            WHEN ${effectiveGeom} IS NOT NULL
                 AND ST_IsValid(${effectiveGeom})
                 AND NOT ST_IsEmpty(${effectiveGeom})
            THEN ROUND(ST_Length(${effectiveGeom}::geography)::numeric, 2)
            ELSE NULL::numeric
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
