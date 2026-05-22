/**
 * Stage K flush handlers — upsert import_review.*_candidates from local package items.
 *
 * Idempotency: import_review unique keys are (source_snapshot_version, entity_family, local_staging_id).
 * INSERT skips when that snapshot identity exists; UPDATE refreshes pending rows and moves review_batch_id.
 * Preserved rows: UPDATE runs only when review_decision IS NULL AND review_status IN ('pending','needs_review');
 * reviewed fields (review_note, reviewed_by, reviewed_at, review_overrides) are never overwritten.
 */

import type pg from 'pg';

import {
  ENTITY_FAMILY_UPLOAD_CONFIG,
  type EntityFamilySlug,
  emptyPerFamilyUploadStats,
  importReviewTableQualified,
  isEntityFamilySlug,
} from './remote-review-entity-config.js';

export type LocalPackageRow = {
  id: string;
  package_name: string;
  source_snapshot_id: string;
  snapshot_version: string;
  region_code: string | null;
  entity_families: string[] | null;
  summary: Record<string, unknown> | null;
};

export type LocalPackageItemRow = {
  id: string;
  entity_family: string;
  local_staging_id: string;
  external_id: string | null;
  match_status: string | null;
  auto_action: string | null;
  review_status: string | null;
  review_decision: string | null;
  confidence_score: string | null;
  canonical_name: string | null;
  class_code: string | null;
  normalized_data: unknown;
  source_refs: unknown;
  matched_core_id: string | null;
  matched_core_table: string | null;
  matched_core_data: unknown;
  f2_comparison: unknown;
  geometry_geojson: unknown;
  payload: Record<string, unknown>;
};

export type FlushOutcome = {
  stats: {
    inserted_total: number;
    updated_pending_total: number;
    preserved_remote_total: number;
    errors: string[];
    per_family_uploaded: Record<
      EntityFamilySlug,
      {
        selected: number;
        inserted: number;
        updated_pending: number;
        preserved_remote: number;
        skipped: number;
        failed: number;
      }
    >;
  };
  remoteIdsByLsid: Map<string, bigint>;
};

const REVIEW_STATUSES = new Set([
  'pending',
  'approved',
  'rejected',
  'needs_review',
  'ignored',
  'merged',
  'promoted',
  'promotion_failed',
]);

export function coerceReviewStatus(localRaw: unknown): string {
  if (typeof localRaw === 'string' && REVIEW_STATUSES.has(localRaw)) return localRaw;
  return 'pending';
}

export function geomJsonParam(geometryGeojson: unknown): string | null {
  if (geometryGeojson === null || geometryGeojson === undefined) return null;
  try {
    return JSON.stringify(geometryGeojson);
  } catch {
    return null;
  }
}

/** Resolve GeoJSON text from package item column + payload fallbacks (Stage J/K contract). */
export function resolveItemGeomJson(
  it: LocalPackageItemRow,
  mode: 'point' | 'geometry' | 'any' = 'any'
): string | null {
  const p = it.payload;
  const nd = normJsonObj(it.normalized_data);
  const pick = (...vals: unknown[]): string | null => {
    for (const v of vals) {
      const j = geomJsonParam(v);
      if (j) return j;
    }
    return null;
  };
  if (mode === 'point') {
    return pick(
      p.point_geom_geojson,
      it.geometry_geojson,
      nd.point_geom_geojson,
      p.geometry_geojson,
      p.geom_geojson,
      nd.geom_geojson
    );
  }
  if (mode === 'geometry') {
    return pick(
      p.geom_geojson,
      it.geometry_geojson,
      nd.geom_geojson,
      p.geometry_geojson,
      p.point_geom_geojson,
      nd.point_geom_geojson
    );
  }
  return pick(
    p.geom_geojson,
    p.point_geom_geojson,
    it.geometry_geojson,
    p.geometry_geojson,
    nd.geom_geojson,
    nd.point_geom_geojson
  );
}

/** Rows eligible for source refresh on re-upload (reviewed rows are preserved). */
export const PRESERVED_REMOTE_WHERE_SQL =
  `t.review_decision IS NULL AND t.review_status IN ('pending'::text, 'needs_review'::text)`;

function insertSkipExistingBySnapshotSql(table: string, family: EntityFamilySlug): string {
  return `WHERE NOT EXISTS (
      SELECT 1 FROM ${table} e
       WHERE e.source_snapshot_version = gp.source_snapshot_version
         AND e.entity_family = '${family}'
         AND e.local_staging_id = gp.local_staging_id
    )`;
}

function updateMatchBySnapshotSql(family: EntityFamilySlug): string {
  return `t.source_snapshot_version = gp.source_snapshot_version
      AND t.entity_family = '${family}'
      AND t.local_staging_id = gp.local_staging_id`;
}

export function normJsonObj(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function pickNumeric(j: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const raw = j[k];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function pickInteger(
  j: Record<string, unknown>,
  keys: string[],
  rounding: 'trunc' | 'round' = 'trunc'
): number | null {
  const n = pickNumeric(j, keys);
  if (n === null) return null;
  return rounding === 'round' ? Math.round(n) : Math.trunc(n);
}

export function pickString(j: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const raw = j[k];
    if (typeof raw === 'string' && raw.trim() !== '') return raw;
  }
  return null;
}

export function parseConfidence(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function mergeRemoteCandidateIdRows(
  rows: Array<{ id?: string | number | null; local_staging_id?: string | number | null }>,
  acc: Map<string, bigint>
): void {
  for (const row of rows) {
    if (row.id == null || row.local_staging_id == null) continue;
    acc.set(String(row.local_staging_id), BigInt(String(row.id)));
  }
}

export async function fillRemoteCandidateIdsSameTxn(
  client: pg.PoolClient,
  tableSql: string,
  batchId: bigint,
  localStagingIds: string[],
  acc: Map<string, bigint>,
  lookup?: { sourceSnapshotVersion: string; entityFamily: EntityFamilySlug }
): Promise<void> {
  const uniq = [...new Set(localStagingIds.map((x) => String(x)))];
  const missing = uniq.filter((lsid) => !acc.has(lsid));
  if (missing.length === 0) return;
  const nums: number[] = [];
  for (const s of missing) {
    const n = Number(s);
    if (!Number.isSafeInteger(n)) {
      throw new Error(`local_staging_id is not a safe integer for remote lookup: ${s}`);
    }
    nums.push(n);
  }
  const r = await client.query<{ id: string; local_staging_id: string }>(
    lookup
      ? `
    select id::text, local_staging_id::text
      from ${tableSql}
     where source_snapshot_version = $1
       and entity_family = $2
       and local_staging_id = any ($3::bigint[])
    `
      : `
    select id::text, local_staging_id::text
      from ${tableSql}
     where review_batch_id = $1::bigint
       and local_staging_id = any ($2::bigint[])
    `,
    lookup
      ? [lookup.sourceSnapshotVersion, lookup.entityFamily, nums]
      : [batchId.toString(), nums]
  );
  mergeRemoteCandidateIdRows(r.rows, acc);
}

type CommonRow = {
  local_staging_id: number;
  source_snapshot_version: string;
  source_snapshot_id_local: number;
  external_id: string | null;
  canonical_name: string | null;
  class_code: string | null;
  confidence_score: number | null;
  match_status: string | null;
  auto_action: string | null;
  review_status: string;
  review_decision: string | null;
  normalized_data: Record<string, unknown>;
  source_refs: Record<string, unknown>;
  matched_core_id: number | null;
  matched_core_table: string | null;
  matched_core_data: Record<string, unknown> | null;
  f2_comparison: Record<string, unknown> | null;
  geom_json: string | null;
};

function buildCommonRow(it: LocalPackageItemRow, pkg: LocalPackageRow): CommonRow {
  const nd = normJsonObj(it.normalized_data);
  const sr =
    typeof it.source_refs === 'object' && it.source_refs !== null
      ? (it.source_refs as Record<string, unknown>)
      : {};
  let matchedPk: number | null = null;
  if (it.matched_core_id != null && /^-?\d+$/.test(it.matched_core_id)) {
    matchedPk = Number(it.matched_core_id);
  }
  return {
    local_staging_id: Number(it.local_staging_id),
    source_snapshot_version: pkg.snapshot_version,
    source_snapshot_id_local: Number(pkg.source_snapshot_id),
    external_id: it.external_id,
    canonical_name: it.canonical_name,
    class_code: it.class_code,
    confidence_score: parseConfidence(it.confidence_score),
    match_status: it.match_status,
    auto_action: it.auto_action,
    review_status: coerceReviewStatus(it.review_status),
    review_decision: it.review_decision,
    normalized_data:
      typeof it.normalized_data === 'object' && it.normalized_data !== null
        ? (it.normalized_data as Record<string, unknown>)
        : {},
    source_refs: sr,
    matched_core_id: matchedPk,
    matched_core_table: it.matched_core_table,
    matched_core_data:
      typeof it.matched_core_data === 'object' && it.matched_core_data !== null
        ? (it.matched_core_data as Record<string, unknown>)
        : null,
    f2_comparison:
      typeof it.f2_comparison === 'object' && it.f2_comparison !== null
        ? (it.f2_comparison as Record<string, unknown>)
        : null,
    geom_json: resolveItemGeomJson(it, 'any'),
  };
}

type UpsertSpec = {
  family: EntityFamilySlug;
  recordTypeSql: string;
  geomPrepSql: string;
  insertSql: string;
  updateSql: string;
  mapRows: (items: LocalPackageItemRow[], pkg: LocalPackageRow) => Record<string, unknown>[];
};

async function runUpsertChunk(
  remoteClient: pg.PoolClient,
  batchId: bigint,
  spec: UpsertSpec,
  items: LocalPackageItemRow[],
  pkg: LocalPackageRow
): Promise<{ inserted: number; updated: number; remoteIdsByLsid: Map<string, bigint> }> {
  const jsonRows = spec.mapRows(items, pkg);
  const chunkJson = JSON.stringify(jsonRows);
  const table = importReviewTableQualified(spec.family);

  const ins = await remoteClient.query<{ id: string; local_staging_id: string }>(
    spec.insertSql,
    [batchId.toString(), chunkJson]
  );
  const upd = await remoteClient.query<{ id: string; local_staging_id: string }>(
    spec.updateSql,
    [batchId.toString(), chunkJson]
  );

  const remoteIdsByLsid = new Map<string, bigint>();
  mergeRemoteCandidateIdRows(ins.rows, remoteIdsByLsid);
  mergeRemoteCandidateIdRows(upd.rows, remoteIdsByLsid);
  await fillRemoteCandidateIdsSameTxn(
    remoteClient,
    table,
    batchId,
    items.map((i) => String(i.local_staging_id)),
    remoteIdsByLsid,
    { sourceSnapshotVersion: pkg.snapshot_version, entityFamily: spec.family }
  );

  return {
    inserted: ins.rowCount ?? 0,
    updated: upd.rowCount ?? 0,
    remoteIdsByLsid,
  };
}

function outcomeForFamily(
  family: EntityFamilySlug,
  itemCount: number,
  inserted: number,
  updated: number
): FlushOutcome {
  const preserved = Math.max(0, itemCount - inserted - updated);
  const per = emptyPerFamilyUploadStats();
  per[family] = {
    selected: itemCount,
    inserted,
    updated_pending: updated,
    preserved_remote: preserved,
    skipped: preserved,
    failed: 0,
  };
  return {
    stats: {
      inserted_total: inserted,
      updated_pending_total: updated,
      preserved_remote_total: preserved,
      errors: [],
      per_family_uploaded: per,
    },
    remoteIdsByLsid: new Map(),
  };
}

function mergeOutcomes(base: FlushOutcome, part: FlushOutcome): FlushOutcome {
  for (const [k, v] of part.remoteIdsByLsid) base.remoteIdsByLsid.set(k, v);
  base.stats.inserted_total += part.stats.inserted_total;
  base.stats.updated_pending_total += part.stats.updated_pending_total;
  base.stats.preserved_remote_total += part.stats.preserved_remote_total;
  for (const f of Object.keys(part.stats.per_family_uploaded) as EntityFamilySlug[]) {
    const p = part.stats.per_family_uploaded[f];
    base.stats.per_family_uploaded[f].inserted += p.inserted;
    base.stats.per_family_uploaded[f].updated_pending += p.updated_pending;
    base.stats.per_family_uploaded[f].preserved_remote += p.preserved_remote;
    base.stats.per_family_uploaded[f].skipped += p.skipped;
    base.stats.per_family_uploaded[f].failed += p.failed;
  }
  return base;
}

const COMMON_RECORD = `
  local_staging_id bigint,
  source_snapshot_version text,
  source_snapshot_id_local bigint,
  external_id text,
  canonical_name text,
  class_code text,
  confidence_score numeric,
  match_status text,
  auto_action text,
  review_status text,
  review_decision text,
  normalized_data jsonb,
  source_refs jsonb,
  matched_core_id bigint,
  matched_core_table text,
  matched_core_data jsonb,
  f2_comparison jsonb,
  geom_json text
`;

function standardGeomPrep(cast: string, alias = 'geom_b'): string {
  return `
    geom_prep AS (
      SELECT data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)${cast}
          ELSE NULL::geometry
        END AS ${alias}
      FROM data
    )`;
}

function buildSimpleMapLayerSpec(
  family: EntityFamilySlug,
  opts: {
    withCentroid?: boolean;
    nameFrom?: 'canonical' | 'class_code' | 'payload_name';
    excludeClassCodeFromName?: boolean;
    geomMode?: 'point' | 'geometry' | 'any';
  } = {}
): UpsertSpec {
  const table = importReviewTableQualified(family);
  const nameExpr =
    opts.nameFrom === 'class_code'
      ? 'coalesce(gp.class_code, gp.canonical_name, gp.name_hint)'
      : opts.nameFrom === 'payload_name'
        ? opts.excludeClassCodeFromName
          ? 'coalesce(gp.name_hint, gp.canonical_name)'
          : 'coalesce(gp.name_hint, gp.canonical_name, gp.class_code)'
        : 'coalesce(gp.canonical_name, gp.class_code, gp.name_hint)';
  const recordType = opts.withCentroid
    ? `${COMMON_RECORD}, name_hint text, centroid_json text`
    : `${COMMON_RECORD}, name_hint text`;
  const centroidPrep = opts.withCentroid
    ? `,
        CASE
          WHEN centroid_json IS NOT NULL AND btrim(centroid_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(centroid_json::text)::geometry, 4326)::geometry(Point,4326)
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326))::geometry(Point,4326)
          ELSE NULL::geometry
        END AS centroid_b`
    : '';
  const centroidInsert = opts.withCentroid ? ', centroid' : '';
  const centroidSelect = opts.withCentroid ? ', gp.centroid_b' : '';
  const centroidCol = opts.withCentroid ? ', centroid = gp.centroid_b' : '';
  const geomPrepBlock = opts.withCentroid
    ? `
    geom_prep AS (
      SELECT data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
          ELSE NULL::geometry
        END AS geom_b${centroidPrep}
      FROM data
    )`
    : standardGeomPrep('::geometry(Geometry,4326)', 'geom_b');

  return {
    family,
    recordTypeSql: recordType,
    geomPrepSql: geomPrepBlock,
    mapRows: (items, pkg) =>
      items.map((it) => {
        const row = buildCommonRow(it, pkg);
        const p = it.payload;
        const nd = row.normalized_data;
        return {
          ...row,
          geom_json: resolveItemGeomJson(it, opts.geomMode ?? 'geometry'),
          name_hint: pickString(p, ['name']) ?? pickString(nd, ['name']),
          ...(opts.withCentroid
            ? {
                centroid_json: geomJsonParam(
                  p.centroid_geojson ?? nd.centroid_geojson
                ),
              }
            : {}),
        };
      }),
    insertSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${recordType})
    ),
    ${geomPrepBlock}
    INSERT INTO ${table} (
      review_batch_id, source_snapshot_version, source_snapshot_id_local, local_staging_id,
      entity_family, external_id, canonical_name, class_code, confidence_score,
      match_status, auto_action, review_status, review_decision,
      normalized_data, source_refs, review_overrides,
      matched_core_id, matched_core_table, matched_core_data, f2_comparison,
      name, geom${centroidInsert}, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint,
      gp.local_staging_id::bigint, '${family}'::text, gp.external_id, gp.canonical_name,
      gp.class_code, gp.confidence_score, gp.match_status, gp.auto_action,
      gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'::jsonb), coalesce(gp.source_refs,'{}'::jsonb), '{}'::jsonb,
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      ${nameExpr}, gp.geom_b${centroidSelect}, now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, family)}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${recordType})
    ),
    ${geomPrepBlock}
    UPDATE ${table} t SET
      review_batch_id = $1::bigint,
      source_snapshot_version = gp.source_snapshot_version,
      source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
      external_id = gp.external_id, canonical_name = gp.canonical_name, class_code = gp.class_code,
      confidence_score = gp.confidence_score, match_status = gp.match_status, auto_action = gp.auto_action,
      normalized_data = coalesce(gp.normalized_data,'{}'::jsonb),
      source_refs = coalesce(gp.source_refs,'{}'::jsonb),
      matched_core_id = gp.matched_core_id, matched_core_table = gp.matched_core_table,
      matched_core_data = gp.matched_core_data::jsonb, f2_comparison = gp.f2_comparison::jsonb,
      name = ${nameExpr}, geom = gp.geom_b${centroidCol}, updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql(family)}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

const UPSERT_SPECS: Partial<Record<EntityFamilySlug, UpsertSpec>> = {
  landuse: buildSimpleMapLayerSpec('landuse', {
    withCentroid: true,
    nameFrom: 'payload_name',
    excludeClassCodeFromName: true,
  }),
  water_lines: buildSimpleMapLayerSpec('water_lines', { nameFrom: 'payload_name' }),
  water_polygons: buildSimpleMapLayerSpec('water_polygons', { withCentroid: true, nameFrom: 'payload_name' }),
};

// buildings — specialized (existing logic)
function buildingsSpec(): UpsertSpec {
  const table = importReviewTableQualified('buildings');
  return {
    family: 'buildings',
    recordTypeSql: COMMON_RECORD,
    geomPrepSql: '',
    mapRows: (items, pkg) =>
      items.map((it) => {
        const c = buildCommonRow(it, pkg);
        const nd = c.normalized_data;
        return {
          ...c,
          name_field: pickString(nd, ['name', 'building_name']) ?? c.canonical_name,
          building_type_id: pickInteger(nd, ['building_type_id']),
          building_type: pickString(nd, ['building_type', 'type']),
          admin_area_id: pickInteger(nd, ['admin_area_id']),
          levels: pickInteger(nd, ['levels', 'building:levels']),
          height_m: pickNumeric(nd, ['height_m', 'height', 'building:height']),
          area_m2: pickNumeric(nd, ['area_m2', 'area']),
        };
      }),
    insertSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD},
        name_field text, building_type_id bigint, building_type text,
        admin_area_id bigint, levels integer, height_m numeric, area_m2 numeric
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
        END AS geom_b FROM data
    )
    INSERT INTO ${table} (
      review_batch_id, source_snapshot_version, source_snapshot_id_local, local_staging_id,
      entity_family, external_id, canonical_name, class_code, confidence_score,
      match_status, auto_action, review_status, review_decision,
      normalized_data, source_refs, matched_core_id, matched_core_table, matched_core_data, f2_comparison,
      name, building_type_id, building_type, admin_area_id, levels, height_m, area_m2, geom, centroid, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint, gp.local_staging_id::bigint,
      'buildings', gp.external_id, gp.canonical_name, gp.class_code, gp.confidence_score,
      gp.match_status, gp.auto_action, gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'), coalesce(gp.source_refs,'{}'),
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      gp.name_field, gp.building_type_id, gp.building_type, gp.admin_area_id::bigint, gp.levels, gp.height_m, gp.area_m2,
      gp.geom_b, CASE WHEN gp.geom_b IS NOT NULL THEN ST_Centroid(gp.geom_b)::geometry(Point,4326) END, now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, 'buildings')}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD},
        name_field text, building_type_id bigint, building_type text,
        admin_area_id bigint, levels integer, height_m numeric, area_m2 numeric
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
        END AS geom_b FROM data
    )
    UPDATE ${table} t SET
      review_batch_id = $1::bigint,
      source_snapshot_version = gp.source_snapshot_version, source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
      external_id = gp.external_id, canonical_name = gp.canonical_name, class_code = gp.class_code,
      confidence_score = gp.confidence_score, match_status = gp.match_status, auto_action = gp.auto_action,
      normalized_data = coalesce(gp.normalized_data,'{}'), source_refs = coalesce(gp.source_refs,'{}'),
      matched_core_id = gp.matched_core_id, matched_core_table = gp.matched_core_table,
      matched_core_data = gp.matched_core_data::jsonb, f2_comparison = gp.f2_comparison::jsonb,
      name = gp.name_field, building_type_id = gp.building_type_id, building_type = gp.building_type,
      admin_area_id = gp.admin_area_id::bigint, levels = gp.levels, height_m = gp.height_m, area_m2 = gp.area_m2,
      geom = gp.geom_b, centroid = CASE WHEN gp.geom_b IS NOT NULL THEN ST_Centroid(gp.geom_b)::geometry(Point,4326) END,
      updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql('buildings')}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

function placesSpec(): UpsertSpec {
  const table = importReviewTableQualified('places');
  return {
    family: 'places',
    recordTypeSql: COMMON_RECORD,
    geomPrepSql: '',
    mapRows: (items, pkg) =>
      items.map((it) => {
        const c = buildCommonRow(it, pkg);
        const nd = c.normalized_data;
        const primary =
          pickString(nd, ['primary_name', 'name']) ?? pickString(nd, ['label']) ?? c.canonical_name;
        return {
          ...c,
          geom_json: resolveItemGeomJson(it, 'point'),
          primary_name: primary,
          display_name: pickString(nd, ['display_name']) ?? primary,
          category_id:
            pickInteger(it.payload, ['poi_category_id']) ??
            pickInteger(nd, ['poi_category_id', 'category_id']),
          place_class_id: pickInteger(it.payload, ['place_class_id']),
          admin_area_id: pickInteger(nd, ['admin_area_id']),
        };
      }),
    insertSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD},
        primary_name text, display_name text, category_id bigint, place_class_id bigint, admin_area_id bigint
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Point,4326)
        END AS pt_geom FROM data
    )
    INSERT INTO ${table} (
      review_batch_id, source_snapshot_version, source_snapshot_id_local, local_staging_id,
      entity_family, external_id, canonical_name, class_code, confidence_score,
      match_status, auto_action, review_status, review_decision,
      normalized_data, source_refs, matched_core_id, matched_core_table, matched_core_data, f2_comparison,
      primary_name, display_name, category_id, place_class_id, admin_area_id, point_geom, lat, lng, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint, gp.local_staging_id::bigint,
      'places', gp.external_id, gp.canonical_name, gp.class_code, gp.confidence_score,
      gp.match_status, gp.auto_action, gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'), coalesce(gp.source_refs,'{}'),
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      gp.primary_name, gp.display_name, gp.category_id::bigint, gp.place_class_id::bigint, gp.admin_area_id::bigint,
      gp.pt_geom,
      CASE WHEN gp.pt_geom IS NOT NULL THEN ST_Y(gp.pt_geom)::double precision END,
      CASE WHEN gp.pt_geom IS NOT NULL THEN ST_X(gp.pt_geom)::double precision END,
      now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, 'places')}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD},
        primary_name text, display_name text, category_id bigint, place_class_id bigint, admin_area_id bigint
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Point,4326)
        END AS pt_geom FROM data
    )
    UPDATE ${table} t SET
      review_batch_id = $1::bigint,
      source_snapshot_version = gp.source_snapshot_version, source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
      external_id = gp.external_id, canonical_name = gp.canonical_name, class_code = gp.class_code,
      confidence_score = gp.confidence_score, match_status = gp.match_status, auto_action = gp.auto_action,
      normalized_data = coalesce(gp.normalized_data,'{}'), source_refs = coalesce(gp.source_refs,'{}'),
      matched_core_id = gp.matched_core_id, matched_core_table = gp.matched_core_table,
      matched_core_data = gp.matched_core_data::jsonb, f2_comparison = gp.f2_comparison::jsonb,
      primary_name = gp.primary_name, display_name = gp.display_name,
      category_id = gp.category_id::bigint, place_class_id = gp.place_class_id::bigint, admin_area_id = gp.admin_area_id::bigint,
      point_geom = gp.pt_geom,
      lat = CASE WHEN gp.pt_geom IS NOT NULL THEN ST_Y(gp.pt_geom)::double precision END,
      lng = CASE WHEN gp.pt_geom IS NOT NULL THEN ST_X(gp.pt_geom)::double precision END,
      updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql('places')}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

function roadsSpec(): UpsertSpec {
  const table = importReviewTableQualified('roads');
  return {
    family: 'roads',
    recordTypeSql: COMMON_RECORD,
    geomPrepSql: '',
    mapRows: (items, pkg) =>
      items.map((it) => {
        const c = buildCommonRow(it, pkg);
        const nd = c.normalized_data;
        return {
          ...c,
          road_class_id: pickInteger(it.payload, ['road_class_id']),
          road_class_txt: pickString(nd, ['road_class', 'highway']),
          surface: pickString(nd, ['surface']),
          is_oneway: nd.oneway === true ? true : nd.oneway === false ? false : null,
          bridge: nd.bridge === true ? true : nd.bridge === false ? false : null,
          tunnel: nd.tunnel === true ? true : nd.tunnel === false ? false : null,
          layer: pickInteger(nd, ['layer']),
          length_m: pickNumeric(nd, ['length_m', 'length']),
        };
      }),
    insertSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD},
        road_class_id bigint, road_class_txt text, surface text,
        is_oneway boolean, bridge boolean, tunnel boolean, layer integer, length_m numeric
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
        END AS ggeom FROM data
    )
    INSERT INTO ${table} (
      review_batch_id, source_snapshot_version, source_snapshot_id_local, local_staging_id,
      entity_family, external_id, canonical_name, class_code, confidence_score,
      match_status, auto_action, review_status, review_decision,
      normalized_data, source_refs, matched_core_id, matched_core_table, matched_core_data, f2_comparison,
      road_class_id, road_class, surface, is_oneway, bridge, tunnel, layer, length_m, geom, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint, gp.local_staging_id::bigint,
      'roads', gp.external_id, gp.canonical_name, gp.class_code, gp.confidence_score,
      gp.match_status, gp.auto_action, gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'), coalesce(gp.source_refs,'{}'),
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      gp.road_class_id::bigint, coalesce(gp.road_class_txt, gp.class_code), gp.surface,
      gp.is_oneway, gp.bridge, gp.tunnel, gp.layer, gp.length_m, gp.ggeom, now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, 'roads')}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD},
        road_class_id bigint, road_class_txt text, surface text,
        is_oneway boolean, bridge boolean, tunnel boolean, layer integer, length_m numeric
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
        END AS ggeom FROM data
    )
    UPDATE ${table} t SET
      review_batch_id = $1::bigint,
      source_snapshot_version = gp.source_snapshot_version, source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
      external_id = gp.external_id, canonical_name = gp.canonical_name, class_code = gp.class_code,
      confidence_score = gp.confidence_score, match_status = gp.match_status, auto_action = gp.auto_action,
      normalized_data = coalesce(gp.normalized_data,'{}'), source_refs = coalesce(gp.source_refs,'{}'),
      matched_core_id = gp.matched_core_id, matched_core_table = gp.matched_core_table,
      matched_core_data = gp.matched_core_data::jsonb, f2_comparison = gp.f2_comparison::jsonb,
      road_class_id = gp.road_class_id::bigint, road_class = coalesce(gp.road_class_txt, gp.class_code),
      surface = gp.surface, is_oneway = gp.is_oneway, bridge = gp.bridge, tunnel = gp.tunnel,
      layer = gp.layer, length_m = gp.length_m, geom = gp.ggeom, updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql('roads')}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

function busStopsSpec(): UpsertSpec {
  const table = importReviewTableQualified('bus_stops');
  return {
    family: 'bus_stops',
    recordTypeSql: COMMON_RECORD,
    geomPrepSql: '',
    mapRows: (items, pkg) =>
      items.map((it) => {
        const c = buildCommonRow(it, pkg);
        const nd = c.normalized_data;
        return {
          ...c,
          geom_json: resolveItemGeomJson(it, 'point'),
          name: c.canonical_name ?? pickString(nd, ['name']),
          name_local: pickString(nd, ['name_local', 'name:my']),
          stop_code: pickString(nd, ['stop_code', 'ref', 'public_transport:ref']),
          admin_area_id:
            pickInteger(it.payload, ['admin_area_candidate_id']) ??
            pickInteger(nd, ['admin_area_id']),
        };
      }),
    insertSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD}, name text, name_local text, stop_code text, admin_area_id bigint
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Point,4326)
        END AS pt_geom FROM data
    )
    INSERT INTO ${table} (
      review_batch_id, source_snapshot_version, source_snapshot_id_local, local_staging_id,
      entity_family, external_id, canonical_name, class_code, confidence_score,
      match_status, auto_action, review_status, review_decision,
      normalized_data, source_refs, matched_core_id, matched_core_table, matched_core_data, f2_comparison,
      name, name_local, stop_code, admin_area_id, geom, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint, gp.local_staging_id::bigint,
      'bus_stops', gp.external_id, gp.canonical_name, gp.class_code, gp.confidence_score,
      gp.match_status, gp.auto_action, gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'), coalesce(gp.source_refs,'{}'),
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      gp.name, gp.name_local, gp.stop_code, gp.admin_area_id::bigint, gp.pt_geom, now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, 'bus_stops')}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD}, name text, name_local text, stop_code text, admin_area_id bigint
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Point,4326)
        END AS pt_geom FROM data
    )
    UPDATE ${table} t SET
      review_batch_id = $1::bigint,
      source_snapshot_version = gp.source_snapshot_version, source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
      external_id = gp.external_id, canonical_name = gp.canonical_name, class_code = gp.class_code,
      confidence_score = gp.confidence_score, match_status = gp.match_status, auto_action = gp.auto_action,
      normalized_data = coalesce(gp.normalized_data,'{}'), source_refs = coalesce(gp.source_refs,'{}'),
      matched_core_id = gp.matched_core_id, matched_core_table = gp.matched_core_table,
      matched_core_data = gp.matched_core_data::jsonb, f2_comparison = gp.f2_comparison::jsonb,
      name = gp.name, name_local = gp.name_local, stop_code = gp.stop_code,
      admin_area_id = gp.admin_area_id::bigint, geom = gp.pt_geom, updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql('bus_stops')}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

function addressesSpec(): UpsertSpec {
  const table = importReviewTableQualified('addresses');
  const addrFields =
    'full_address text, house_number text, unit_number text, street_id bigint, street_name text, quarter text, suburb text, township text, city text, district text, state_region text, postcode text, country text, postal_code text, plus_code text, entrance_geom_json text';
  return {
    family: 'addresses',
    recordTypeSql: `${COMMON_RECORD}, ${addrFields}`,
    geomPrepSql: '',
    mapRows: (items, pkg) =>
      items.map((it) => {
        const c = buildCommonRow(it, pkg);
        const nd = c.normalized_data;
        const p = it.payload;
        return {
          ...c,
          geom_json: resolveItemGeomJson(it, 'point'),
          canonical_name: c.canonical_name ?? pickString(nd, ['full_address']),
          full_address: pickString(p, ['full_address']) ?? pickString(nd, ['full_address']),
          house_number: pickString(p, ['house_number']) ?? pickString(nd, ['house_number']),
          unit_number: pickString(p, ['unit_number']) ?? pickString(nd, ['unit_number']),
          street_id:
            pickInteger(p, ['street_id']) ??
            pickInteger(nd, ['street_id']),
          street_name: pickString(p, ['street_name']) ?? pickString(nd, ['street_name']),
          quarter: pickString(nd, ['quarter']),
          suburb: pickString(nd, ['suburb']),
          township: pickString(nd, ['township']),
          city: pickString(nd, ['city']),
          district: pickString(nd, ['district']),
          state_region: pickString(nd, ['state_region']),
          postcode: pickString(nd, ['postcode']),
          country: pickString(nd, ['country']),
          postal_code: pickString(p, ['postal_code']) ?? pickString(nd, ['postal_code']),
          plus_code: pickString(p, ['plus_code']) ?? pickString(nd, ['plus_code']),
          entrance_geom_json: geomJsonParam(
            p.entrance_geom_geojson ?? nd.entrance_geom_geojson
          ),
        };
      }),
    insertSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${COMMON_RECORD}, ${addrFields})
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Point,4326)
        END AS pt_geom,
        CASE WHEN entrance_geom_json IS NOT NULL AND btrim(entrance_geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(entrance_geom_json::text)::geometry, 4326)::geometry(Point,4326)
        END AS entrance_geom_b
      FROM data
    )
    INSERT INTO ${table} (
      review_batch_id, source_snapshot_version, source_snapshot_id_local, local_staging_id,
      entity_family, external_id, canonical_name, class_code, confidence_score,
      match_status, auto_action, review_status, review_decision,
      normalized_data, source_refs, matched_core_id, matched_core_table, matched_core_data, f2_comparison,
      full_address, house_number, unit_number, street_id, street_name, quarter, suburb, township, city, district,
      state_region, postcode, country, postal_code, plus_code, point_geom, entrance_geom, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint, gp.local_staging_id::bigint,
      'addresses', gp.external_id, gp.canonical_name, gp.class_code, gp.confidence_score,
      gp.match_status, gp.auto_action, gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'), coalesce(gp.source_refs,'{}'),
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      gp.full_address, gp.house_number, gp.unit_number, gp.street_id::bigint, gp.street_name, gp.quarter, gp.suburb, gp.township,
      gp.city, gp.district, gp.state_region, gp.postcode, gp.country, gp.postal_code, gp.plus_code,
      gp.pt_geom, gp.entrance_geom_b, now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, 'addresses')}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${COMMON_RECORD}, ${addrFields})
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Point,4326)
        END AS pt_geom,
        CASE WHEN entrance_geom_json IS NOT NULL AND btrim(entrance_geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(entrance_geom_json::text)::geometry, 4326)::geometry(Point,4326)
        END AS entrance_geom_b
      FROM data
    )
    UPDATE ${table} t SET
      review_batch_id = $1::bigint,
      source_snapshot_version = gp.source_snapshot_version, source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
      external_id = gp.external_id, canonical_name = gp.canonical_name, class_code = gp.class_code,
      confidence_score = gp.confidence_score, match_status = gp.match_status, auto_action = gp.auto_action,
      normalized_data = coalesce(gp.normalized_data,'{}'), source_refs = coalesce(gp.source_refs,'{}'),
      matched_core_id = gp.matched_core_id, matched_core_table = gp.matched_core_table,
      matched_core_data = gp.matched_core_data::jsonb, f2_comparison = gp.f2_comparison::jsonb,
      full_address = gp.full_address, house_number = gp.house_number, unit_number = gp.unit_number,
      street_id = gp.street_id::bigint, street_name = gp.street_name, quarter = gp.quarter, suburb = gp.suburb, township = gp.township,
      city = gp.city, district = gp.district, state_region = gp.state_region, postcode = gp.postcode,
      country = gp.country, postal_code = gp.postal_code, plus_code = gp.plus_code,
      point_geom = gp.pt_geom, entrance_geom = gp.entrance_geom_b, updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql('addresses')}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

function adminAreasSpec(): UpsertSpec {
  const table = importReviewTableQualified('admin_areas');
  return {
    family: 'admin_areas',
    recordTypeSql: COMMON_RECORD,
    geomPrepSql: '',
    mapRows: (items, pkg) =>
      items.map((it) => {
        const c = buildCommonRow(it, pkg);
        const nd = c.normalized_data;
        return {
          ...c,
          geom_json: resolveItemGeomJson(it, 'geometry'),
          admin_level_id:
            pickInteger(it.payload, ['admin_level_id']) ?? pickInteger(nd, ['admin_level_id']),
          parent_id:
            pickInteger(it.payload, ['parent_candidate_id']) ?? pickInteger(nd, ['parent_id']),
          slug: pickString(nd, ['slug']),
          centroid_json: geomJsonParam(it.payload.centroid_geojson ?? nd.centroid_geojson),
        };
      }),
    insertSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD}, admin_level_id bigint, parent_id bigint, slug text, centroid_json text
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
        END AS geom_b,
        CASE WHEN centroid_json IS NOT NULL AND btrim(centroid_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(centroid_json::text)::geometry, 4326)::geometry(Point,4326)
        WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326))::geometry(Point,4326)
        END AS centroid_b
      FROM data
    )
    INSERT INTO ${table} (
      review_batch_id, source_snapshot_version, source_snapshot_id_local, local_staging_id,
      entity_family, external_id, canonical_name, class_code, confidence_score,
      match_status, auto_action, review_status, review_decision,
      normalized_data, source_refs, matched_core_id, matched_core_table, matched_core_data, f2_comparison,
      admin_level_id, parent_id, slug, geom, centroid, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint, gp.local_staging_id::bigint,
      'admin_areas', gp.external_id, gp.canonical_name, gp.class_code, gp.confidence_score,
      gp.match_status, gp.auto_action, gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'), coalesce(gp.source_refs,'{}'),
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      gp.admin_level_id::bigint, gp.parent_id::bigint, gp.slug, gp.geom_b, gp.centroid_b, now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, 'admin_areas')}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD}, admin_level_id bigint, parent_id bigint, slug text, centroid_json text
      )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
        END AS geom_b,
        CASE WHEN centroid_json IS NOT NULL AND btrim(centroid_json) <> '' THEN
          ST_SetSRID(ST_GeomFromGeoJSON(centroid_json::text)::geometry, 4326)::geometry(Point,4326)
        WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326))::geometry(Point,4326)
        END AS centroid_b
      FROM data
    )
    UPDATE ${table} t SET
      review_batch_id = $1::bigint,
      source_snapshot_version = gp.source_snapshot_version, source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
      external_id = gp.external_id, canonical_name = gp.canonical_name, class_code = gp.class_code,
      confidence_score = gp.confidence_score, match_status = gp.match_status, auto_action = gp.auto_action,
      normalized_data = coalesce(gp.normalized_data,'{}'), source_refs = coalesce(gp.source_refs,'{}'),
      matched_core_id = gp.matched_core_id, matched_core_table = gp.matched_core_table,
      matched_core_data = gp.matched_core_data::jsonb, f2_comparison = gp.f2_comparison::jsonb,
      admin_level_id = gp.admin_level_id::bigint, parent_id = gp.parent_id::bigint, slug = gp.slug,
      geom = gp.geom_b, centroid = gp.centroid_b, updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql('admin_areas')}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

function routingBarriersSpec(): UpsertSpec {
  const table = importReviewTableQualified('routing_barriers');
  return {
    family: 'routing_barriers',
    recordTypeSql: COMMON_RECORD,
    geomPrepSql: '',
    mapRows: (items, pkg) =>
      items.map((it) => {
        const c = buildCommonRow(it, pkg);
        const nd = c.normalized_data;
        return {
          ...c,
          geom_json: resolveItemGeomJson(it, 'point'),
          class_code: c.class_code ?? pickString(nd, ['barrier_type', 'barrier']),
          barrier_type: pickString(it.payload, ['barrier_type']) ?? pickString(nd, ['barrier_type', 'barrier']),
        };
      }),
    insertSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${COMMON_RECORD}, barrier_type text)
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_PointOnSurface(
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)
          )::geometry(Point,4326)
        END AS pt_geom FROM data
    )
    INSERT INTO ${table} (
      review_batch_id, source_snapshot_version, source_snapshot_id_local, local_staging_id,
      entity_family, external_id, canonical_name, class_code, confidence_score,
      match_status, auto_action, review_status, review_decision,
      normalized_data, source_refs, matched_core_id, matched_core_table, matched_core_data, f2_comparison,
      barrier_type, point_geom, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint, gp.local_staging_id::bigint,
      'routing_barriers', gp.external_id, gp.canonical_name, gp.class_code, gp.confidence_score,
      gp.match_status, gp.auto_action, gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'), coalesce(gp.source_refs,'{}'),
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      gp.barrier_type, gp.pt_geom, now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, 'routing_barriers')}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${COMMON_RECORD}, barrier_type text)
    ),
    geom_prep AS (
      SELECT data.*,
        CASE WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
          ST_PointOnSurface(
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)
          )::geometry(Point,4326)
        END AS pt_geom FROM data
    )
    UPDATE ${table} t SET
      review_batch_id = $1::bigint,
      source_snapshot_version = gp.source_snapshot_version, source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
      external_id = gp.external_id, canonical_name = gp.canonical_name, class_code = gp.class_code,
      confidence_score = gp.confidence_score, match_status = gp.match_status, auto_action = gp.auto_action,
      normalized_data = coalesce(gp.normalized_data,'{}'), source_refs = coalesce(gp.source_refs,'{}'),
      matched_core_id = gp.matched_core_id, matched_core_table = gp.matched_core_table,
      matched_core_data = gp.matched_core_data::jsonb, f2_comparison = gp.f2_comparison::jsonb,
      barrier_type = gp.barrier_type, point_geom = gp.pt_geom, updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql('routing_barriers')}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

function getUpsertSpec(family: EntityFamilySlug): UpsertSpec {
  if (family === 'buildings') return buildingsSpec();
  if (family === 'places') return placesSpec();
  if (family === 'roads') return roadsSpec();
  if (family === 'bus_stops') return busStopsSpec();
  if (family === 'addresses') return addressesSpec();
  if (family === 'admin_areas') return adminAreasSpec();
  if (family === 'routing_barriers') return routingBarriersSpec();
  const simple = UPSERT_SPECS[family];
  if (simple) return simple;
  throw new Error(`Missing Stage 12 upload config for entity_family=${family}`);
}

export function assertUploadConfigForFamily(family: string): EntityFamilySlug {
  if (!isEntityFamilySlug(family)) {
    throw new Error(`Missing Stage 12 upload config for entity_family=${family}`);
  }
  getUpsertSpec(family);
  return family;
}

export async function flushEntityFamily(
  remoteClient: pg.PoolClient,
  family: EntityFamilySlug,
  batchId: bigint,
  pkg: LocalPackageRow,
  items: LocalPackageItemRow[],
  prog: { done: number; total: number }
): Promise<FlushOutcome> {
  if (items.length === 0) {
    return outcomeForFamily(family, 0, 0, 0);
  }
  const spec = getUpsertSpec(family);
  const { inserted, updated, remoteIdsByLsid } = await runUpsertChunk(
    remoteClient,
    batchId,
    spec,
    items,
    pkg
  );
  prog.done += items.length;
  const out = outcomeForFamily(family, items.length, inserted, updated);
  out.remoteIdsByLsid = remoteIdsByLsid;
  return out;
}

export function mergeFlushOutcomes(a: FlushOutcome, b: FlushOutcome): FlushOutcome {
  return mergeOutcomes(a, b);
}

export function buildBatchCountUnionSql(): string {
  const parts = Object.values(ENTITY_FAMILY_UPLOAD_CONFIG).map(
    (c) =>
      `select count(*)::int as c from import_review.${c.importReviewTable} where review_batch_id = $1::bigint`
  );
  return parts.join('\n      union all\n      ');
}

export function buildBatchPreservedUnionSql(): string {
  const parts = Object.values(ENTITY_FAMILY_UPLOAD_CONFIG).map(
    (c) => `select count(*)::int as p from import_review.${c.importReviewTable} t
       where t.review_batch_id = $1::bigint
         and not (${PRESERVED_REMOTE_WHERE_SQL})`
  );
  return parts.join('\n      union all\n      ');
}
