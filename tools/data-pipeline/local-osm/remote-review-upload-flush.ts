/**
 * Stage K flush handlers — upsert import_review.*_candidates from local package items.
 *
 * Idempotency: candidate uploads prefer (review_batch_id, entity_family, external_id)
 * and fall back to (source_snapshot_version, entity_family, local_staging_id).
 * INSERT skips existing rows; UPDATE refreshes pending rows and moves review_batch_id.
 * Preserved rows: UPDATE runs only when review_decision IS NULL AND review_status IN ('pending','needs_review');
 * reviewed fields (review_note, reviewed_by, reviewed_at, review_overrides) are never overwritten.
 */

import type pg from 'pg';

import {
  ENTITY_FAMILY_UPLOAD_CONFIG,
  parseConfidenceScore,
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
       WHERE (
           e.review_batch_id = $1::bigint
           AND e.entity_family = '${family}'
           AND gp.external_id IS NOT NULL
           AND e.external_id = gp.external_id
         )
         OR (
           e.source_snapshot_version = gp.source_snapshot_version
           AND e.entity_family = '${family}'
           AND e.local_staging_id = gp.local_staging_id
         )
    )`;
}

function updateMatchBySnapshotSql(family: EntityFamilySlug): string {
  return `((
        t.review_batch_id = $1::bigint
        AND t.entity_family = '${family}'
        AND gp.external_id IS NOT NULL
        AND t.external_id = gp.external_id
      )
      OR (
        t.source_snapshot_version = gp.source_snapshot_version
        AND t.entity_family = '${family}'
        AND t.local_staging_id = gp.local_staging_id
      ))`;
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

export function pickBoolean(j: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const raw = j[k];
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase();
      if (['true', 't', '1', 'yes'].includes(s)) return true;
      if (['false', 'f', '0', 'no'].includes(s)) return false;
    }
  }
  return null;
}

export { parseConfidenceScore as parseConfidence } from './remote-review-entity-config.js';

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
    confidence_score: parseConfidenceScore(it.confidence_score),
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

function landuseSpec(): UpsertSpec {
  const table = importReviewTableQualified('landuse');
  const base = buildSimpleMapLayerSpec('landuse', {
    withCentroid: true,
    nameFrom: 'payload_name',
    excludeClassCodeFromName: true,
  });
  const recordType = `${COMMON_RECORD}, name_hint text, centroid_json text, admin_area_id bigint`;
  return {
    ...base,
    recordTypeSql: recordType,
    mapRows: (items, pkg) =>
      items.map((it) => {
        const row = buildCommonRow(it, pkg);
        const p = it.payload;
        const nd = row.normalized_data;
        return {
          ...row,
          geom_json: resolveItemGeomJson(it, 'geometry'),
          name_hint: pickString(p, ['name']) ?? pickString(nd, ['name']),
          centroid_json: geomJsonParam(p.centroid_geojson ?? nd.centroid_geojson),
          admin_area_id: pickInteger(nd, ['admin_area_id', 'core_admin_area_id']),
        };
      }),
    insertSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${recordType})
    ),
    geom_prep AS (
      SELECT data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
          ELSE NULL::geometry
        END AS geom_b,
        CASE
          WHEN centroid_json IS NOT NULL AND btrim(centroid_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(centroid_json::text)::geometry, 4326)::geometry(Point,4326)
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326))::geometry(Point,4326)
          ELSE NULL::geometry
        END AS centroid_b
      FROM data
    )
    INSERT INTO ${table} (
      review_batch_id, source_snapshot_version, source_snapshot_id_local, local_staging_id,
      entity_family, external_id, canonical_name, class_code, confidence_score,
      match_status, auto_action, review_status, review_decision,
      normalized_data, source_refs, review_overrides,
      matched_core_id, matched_core_table, matched_core_data, f2_comparison,
      name, admin_area_id, geom, centroid, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint,
      gp.local_staging_id::bigint, 'landuse'::text, gp.external_id, gp.canonical_name,
      gp.class_code, gp.confidence_score, gp.match_status, gp.auto_action,
      gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'::jsonb), coalesce(gp.source_refs,'{}'::jsonb), '{}'::jsonb,
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      coalesce(gp.name_hint, gp.canonical_name), gp.admin_area_id::bigint, gp.geom_b, gp.centroid_b, now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, 'landuse')}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${recordType})
    ),
    geom_prep AS (
      SELECT data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
          ELSE NULL::geometry
        END AS geom_b,
        CASE
          WHEN centroid_json IS NOT NULL AND btrim(centroid_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(centroid_json::text)::geometry, 4326)::geometry(Point,4326)
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326))::geometry(Point,4326)
          ELSE NULL::geometry
        END AS centroid_b
      FROM data
    )
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
      name = coalesce(gp.name_hint, gp.canonical_name),
      admin_area_id = gp.admin_area_id::bigint,
      geom = gp.geom_b, centroid = gp.centroid_b, updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql('landuse')}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

const UPSERT_SPECS: Partial<Record<EntityFamilySlug, UpsertSpec>> = {
  landuse: landuseSpec(),
  water_lines: buildSimpleMapLayerSpec('water_lines', { nameFrom: 'payload_name' }),
  water_polygons: buildSimpleMapLayerSpec('water_polygons', { withCentroid: true, nameFrom: 'payload_name' }),
};

// buildings — specialized (import_review only; does not write Core)
// Legacy `name` column is dashboard-compat display only; authoritative names are
// normalized_data.names (language_code my|en|und, name_type imported).

const BUILDING_MYANMAR_SCRIPT_RE = /[\u1000-\u109F]/;

type BuildingFlushName = {
  name: string;
  language_code: 'my' | 'en' | 'und';
  script_code: string | null;
  name_type: 'imported';
  is_primary: boolean;
  search_weight: number;
};

function trimBuildingName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/** Prefer staging names[]; else derive from OSM tags (same rules as extract-building-osm-names). */
function resolveBuildingNormalizedNames(
  nd: Record<string, unknown>,
  payload: Record<string, unknown>
): BuildingFlushName[] {
  if (Array.isArray(nd.names) && nd.names.length > 0) {
    const out: BuildingFlushName[] = [];
    const seen = new Set<string>();
    for (const item of nd.names) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const name = trimBuildingName(row.name);
      const rawLang =
        typeof row.language_code === 'string'
          ? row.language_code
          : typeof row.languageCode === 'string'
            ? row.languageCode
            : null;
      let language_code: 'my' | 'en' | 'und' | null = null;
      if (rawLang) {
        const c = rawLang.trim().toLowerCase();
        if (c === 'my' || c === 'mm' || c === 'my-mm') language_code = 'my';
        else if (c === 'en') language_code = 'en';
        else if (c === 'und') language_code = 'und';
      }
      if (!name || !language_code) continue;
      const key = `${language_code}\0${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        language_code,
        script_code:
          typeof row.script_code === 'string'
            ? row.script_code
            : typeof row.scriptCode === 'string'
              ? row.scriptCode
              : language_code === 'my'
                ? 'Mymr'
                : language_code === 'en'
                  ? 'Latn'
                  : null,
        name_type: 'imported',
        is_primary: Boolean(row.is_primary ?? row.isPrimary ?? false),
        search_weight: Number(row.search_weight ?? row.searchWeight ?? 50) || 50,
      });
    }
    if (out.length > 0) return out;
  }

  const tagsRaw = nd.tags ?? payload.tags;
  const tags =
    tagsRaw !== null && typeof tagsRaw === 'object' && !Array.isArray(tagsRaw)
      ? (tagsRaw as Record<string, unknown>)
      : {};
  const nameMy =
    trimBuildingName(tags['name:my']) ??
    trimBuildingName(tags['name:mm']) ??
    trimBuildingName(tags['name:my-MM']);
  const nameEn = trimBuildingName(tags['name:en']);
  const namePlain = trimBuildingName(tags['name']);

  type Cand = {
    name: string;
    language_code: 'my' | 'en' | 'und';
    script_code: string | null;
    search_weight: number;
    sort_key: number;
  };
  const candidates: Cand[] = [];
  const seen = new Set<string>();
  const add = (
    name: string | null,
    language_code: 'my' | 'en' | 'und',
    script_code: string | null,
    search_weight: number,
    sort_key: number
  ) => {
    if (!name) return;
    const key = `${language_code}\0${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ name, language_code, script_code, search_weight, sort_key });
  };

  add(nameMy, 'my', 'Mymr', 100, 1);
  add(nameEn, 'en', 'Latn', nameMy ? 90 : 100, 2);
  if (namePlain) {
    if (nameEn && namePlain.toLowerCase() === nameEn.toLowerCase()) {
      add(namePlain, 'en', 'Latn', 80, 3);
    } else if (BUILDING_MYANMAR_SCRIPT_RE.test(namePlain)) {
      add(namePlain, 'my', 'Mymr', 80, 3);
    } else {
      add(namePlain, 'und', null, 70, 3);
    }
  }

  const primarySeen = new Set<'my' | 'en' | 'und'>();
  return candidates
    .sort((a, b) => a.sort_key - b.sort_key || b.search_weight - a.search_weight)
    .map((row) => {
      const is_primary = !primarySeen.has(row.language_code);
      if (is_primary) primarySeen.add(row.language_code);
      return {
        name: row.name,
        language_code: row.language_code,
        script_code: row.script_code,
        name_type: 'imported' as const,
        is_primary,
        search_weight: row.search_weight,
      };
    });
}

function pickBuildingLegacyDisplayName(
  names: BuildingFlushName[],
  nd: Record<string, unknown>,
  canonical: string | null
): string | null {
  const primary = names.find((n) => n.is_primary);
  if (primary) return primary.name;
  if (names[0]) return names[0].name;
  return pickString(nd, ['name', 'building_name']) ?? canonical;
}

function buildingsSpec(): UpsertSpec {
  const table = importReviewTableQualified('buildings');
  return {
    family: 'buildings',
    recordTypeSql: COMMON_RECORD,
    geomPrepSql: '',
    mapRows: (items, pkg) =>
      items.map((it) => {
        const c = buildCommonRow(it, pkg);
        const nd = { ...c.normalized_data };
        const names = resolveBuildingNormalizedNames(nd, it.payload ?? {});
        nd.names = names;
        return {
          ...c,
          normalized_data: nd,
          // Legacy import_review.name — dashboard display only, not authoritative.
          name_field: pickBuildingLegacyDisplayName(names, nd, c.canonical_name),
          building_type_id: pickInteger(nd, ['building_type_id']),
          building_type: pickString(nd, ['building_type', 'type']),
          admin_area_id: pickInteger(nd, ['admin_area_id', 'core_admin_area_id']),
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
          admin_area_id: pickInteger(nd, ['admin_area_id', 'core_admin_area_id']),
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
          admin_area_id: pickInteger(nd, ['admin_area_id', 'core_admin_area_id']),
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
        admin_area_id bigint, road_class_id bigint, road_class_txt text, surface text,
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
      admin_area_id, road_class_id, road_class, surface, is_oneway, bridge, tunnel, layer, length_m, geom, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint, gp.local_staging_id::bigint,
      'roads', gp.external_id, gp.canonical_name, gp.class_code, gp.confidence_score,
      gp.match_status, gp.auto_action, gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'), coalesce(gp.source_refs,'{}'),
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      gp.admin_area_id::bigint, gp.road_class_id::bigint, coalesce(gp.road_class_txt, gp.class_code), gp.surface,
      gp.is_oneway, gp.bridge, gp.tunnel, gp.layer, gp.length_m, gp.ggeom, now()
    FROM geom_prep gp
    ${insertSkipExistingBySnapshotSql(table, 'roads')}
    RETURNING id, local_staging_id`,
    updateSql: `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (
        ${COMMON_RECORD},
        admin_area_id bigint, road_class_id bigint, road_class_txt text, surface text,
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
      admin_area_id = gp.admin_area_id::bigint,
      road_class_id = gp.road_class_id::bigint, road_class = coalesce(gp.road_class_txt, gp.class_code),
      surface = gp.surface, is_oneway = gp.is_oneway, bridge = gp.bridge, tunnel = gp.tunnel,
      layer = gp.layer, length_m = gp.length_m, geom = gp.ggeom, updated_at = now()
    FROM geom_prep gp
    WHERE ${updateMatchBySnapshotSql('roads')}
      AND ${PRESERVED_REMOTE_WHERE_SQL}
    RETURNING t.id, t.local_staging_id`,
  };
}

function addressesSpec(): UpsertSpec {
  const table = importReviewTableQualified('addresses');
  const addrFields =
    'full_address text, house_number text, unit_number text, street_id bigint, street_name text, quarter text, suburb text, township text, city text, district text, state_region text, postcode text, country text, postal_code text, plus_code text, entrance_geom_json text, source_classification text, has_place_evidence boolean, has_address_evidence boolean, address_strength text, place_candidate_status text, validation_status text, promotion_status text';
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
          source_classification:
            pickString(p, ['source_classification']) ?? pickString(nd, ['source_classification']),
          has_place_evidence:
            pickBoolean(p, ['has_place_evidence']) ?? pickBoolean(nd, ['has_place_evidence']),
          has_address_evidence:
            pickBoolean(p, ['has_address_evidence']) ?? pickBoolean(nd, ['has_address_evidence']),
          address_strength: pickString(p, ['address_strength']) ?? pickString(nd, ['address_strength']),
          place_candidate_status:
            pickString(p, ['place_candidate_status']) ?? pickString(nd, ['place_candidate_status']),
          validation_status: pickString(p, ['validation_status']) ?? pickString(nd, ['validation_status']),
          promotion_status: pickString(p, ['promotion_status']) ?? pickString(nd, ['promotion_status']),
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
      state_region, postcode, country, postal_code, plus_code, point_geom, entrance_geom,
      source_classification, has_place_evidence, has_address_evidence, address_strength,
      place_candidate_status, validation_status, promotion_status, updated_at
    )
    SELECT $1::bigint, gp.source_snapshot_version, gp.source_snapshot_id_local::bigint, gp.local_staging_id::bigint,
      'addresses', gp.external_id, gp.canonical_name, gp.class_code, gp.confidence_score,
      gp.match_status, gp.auto_action, gp.review_status, gp.review_decision,
      coalesce(gp.normalized_data,'{}'), coalesce(gp.source_refs,'{}'),
      gp.matched_core_id, gp.matched_core_table, gp.matched_core_data::jsonb, gp.f2_comparison::jsonb,
      gp.full_address, gp.house_number, gp.unit_number, gp.street_id::bigint, gp.street_name, gp.quarter, gp.suburb, gp.township,
      gp.city, gp.district, gp.state_region, gp.postcode, gp.country, gp.postal_code, gp.plus_code,
      gp.pt_geom, gp.entrance_geom_b,
      gp.source_classification, coalesce(gp.has_place_evidence, false), coalesce(gp.has_address_evidence, false),
      gp.address_strength,
      CASE
        WHEN gp.place_candidate_status IN ('not_applicable','needs_place_candidate','place_candidate_created','matched_core_place','ignored')
        THEN gp.place_candidate_status
        ELSE NULL
      END,
      coalesce(gp.validation_status, 'not_checked'), coalesce(gp.promotion_status, 'not_ready'), now()
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
      point_geom = gp.pt_geom, entrance_geom = gp.entrance_geom_b,
      source_classification = gp.source_classification,
      has_place_evidence = coalesce(gp.has_place_evidence, false),
      has_address_evidence = coalesce(gp.has_address_evidence, false),
      address_strength = gp.address_strength,
      place_candidate_status = CASE
        WHEN gp.place_candidate_status IN ('not_applicable','needs_place_candidate','place_candidate_created','matched_core_place','ignored')
        THEN gp.place_candidate_status
        ELSE t.place_candidate_status
      END,
      validation_status = coalesce(gp.validation_status, t.validation_status),
      promotion_status = coalesce(gp.promotion_status, t.promotion_status),
      updated_at = now()
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

async function flushAddressComponents(
  remoteClient: pg.PoolClient,
  batchId: bigint,
  pkg: LocalPackageRow,
  items: LocalPackageItemRow[]
): Promise<FlushOutcome> {
  const rows = items.map((it) => {
    const c = buildCommonRow(it, pkg);
    const p = it.payload;
    const nd = c.normalized_data;
    return {
      local_staging_id: c.local_staging_id,
      source_snapshot_version: c.source_snapshot_version,
      source_snapshot_id_local: c.source_snapshot_id_local,
      external_id: c.external_id,
      confidence_score: c.confidence_score,
      normalized_data: c.normalized_data,
      source_refs: c.source_refs,
      address_local_staging_id: pickInteger(p, ['address_local_staging_id']) ?? pickInteger(nd, ['address_local_staging_id']),
      address_external_id: pickString(p, ['address_external_id']) ?? pickString(nd, ['address_external_id']),
      component_type_code: pickString(p, ['component_type_code']) ?? pickString(nd, ['component_type_code']) ?? c.class_code,
      component_value: pickString(p, ['component_value']) ?? pickString(nd, ['component_value']) ?? c.canonical_name,
      language_code: pickString(p, ['language_code']) ?? pickString(nd, ['language_code']) ?? 'und',
      source_tag: pickString(p, ['source_tag']) ?? pickString(nd, ['source_tag']),
      sort_order: pickInteger(p, ['sort_order']) ?? pickInteger(nd, ['sort_order']),
    };
  });

  const recordType = `
    local_staging_id bigint,
    source_snapshot_version text,
    source_snapshot_id_local bigint,
    external_id text,
    confidence_score numeric,
    normalized_data jsonb,
    source_refs jsonb,
    address_local_staging_id bigint,
    address_external_id text,
    component_type_code text,
    component_value text,
    language_code text,
    source_tag text,
    sort_order integer
  `;
  const dataCte = `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${recordType})
      WHERE nullif(trim(component_type_code), '') IS NOT NULL
        AND nullif(trim(component_value), '') IS NOT NULL
    ),
    resolved AS (
      SELECT data.*, a.id AS remote_address_candidate_id
      FROM data
      INNER JOIN import_review.address_candidates AS a
        ON a.review_batch_id = $1::bigint
       AND (
            (data.address_external_id IS NOT NULL AND a.external_id = data.address_external_id)
            OR (
              data.address_local_staging_id IS NOT NULL
              AND a.source_snapshot_version = data.source_snapshot_version
              AND a.entity_family = 'addresses'
              AND a.local_staging_id = data.address_local_staging_id
            )
       )
    )`;

  const ins = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    ${dataCte},
    inserted AS (
      INSERT INTO import_review.address_components (
        address_candidate_id, component_type_code, component_value, language_code,
        source_tag, sort_order, confidence_score, source_refs, normalized_data, updated_at
      )
      SELECT
        r.remote_address_candidate_id,
        r.component_type_code,
        r.component_value,
        coalesce(nullif(trim(r.language_code), ''), 'und'),
        r.source_tag,
        r.sort_order,
        r.confidence_score,
        coalesce(r.source_refs, '{}'::jsonb) || jsonb_build_object(
          'local_staging_id', r.local_staging_id,
          'source_snapshot_version', r.source_snapshot_version,
          'source_snapshot_id_local', r.source_snapshot_id_local,
          'external_id', r.external_id
        ),
        coalesce(r.normalized_data, '{}'::jsonb),
        now()
      FROM resolved AS r
      WHERE NOT EXISTS (
        SELECT 1 FROM import_review.address_components AS existing
        WHERE existing.address_candidate_id = r.remote_address_candidate_id
          AND existing.component_type_code = r.component_type_code
          AND existing.language_code = coalesce(nullif(trim(r.language_code), ''), 'und')
          AND existing.component_value = r.component_value
      )
      RETURNING id, source_refs->>'local_staging_id' AS local_staging_id
    )
    SELECT id::text, local_staging_id::text FROM inserted
    `,
    [batchId.toString(), JSON.stringify(rows)]
  );

  const upd = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    ${dataCte},
    updated AS (
      UPDATE import_review.address_components AS t
      SET
        source_tag = r.source_tag,
        sort_order = r.sort_order,
        confidence_score = r.confidence_score,
        source_refs = coalesce(r.source_refs, '{}'::jsonb) || jsonb_build_object(
          'local_staging_id', r.local_staging_id,
          'source_snapshot_version', r.source_snapshot_version,
          'source_snapshot_id_local', r.source_snapshot_id_local,
          'external_id', r.external_id
        ),
        normalized_data = coalesce(r.normalized_data, '{}'::jsonb),
        updated_at = now()
      FROM resolved AS r
      WHERE t.address_candidate_id = r.remote_address_candidate_id
        AND t.component_type_code = r.component_type_code
        AND t.language_code = coalesce(nullif(trim(r.language_code), ''), 'und')
        AND t.component_value = r.component_value
        AND coalesce(t.is_reviewed, false) IS NOT TRUE
      RETURNING t.id, r.local_staging_id
    )
    SELECT id::text, local_staging_id::text FROM updated
    `,
    [batchId.toString(), JSON.stringify(rows)]
  );

  const remoteIdsByLsid = new Map<string, bigint>();
  mergeRemoteCandidateIdRows(ins.rows, remoteIdsByLsid);
  mergeRemoteCandidateIdRows(upd.rows, remoteIdsByLsid);

  const found = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    ${dataCte}
    SELECT t.id::text, r.local_staging_id::text
    FROM resolved AS r
    INNER JOIN import_review.address_components AS t
      ON t.address_candidate_id = r.remote_address_candidate_id
     AND t.component_type_code = r.component_type_code
     AND t.language_code = coalesce(nullif(trim(r.language_code), ''), 'und')
     AND t.component_value = r.component_value
    `,
    [batchId.toString(), JSON.stringify(rows)]
  );
  mergeRemoteCandidateIdRows(found.rows, remoteIdsByLsid);

  const out = outcomeForFamily('address_components', items.length, ins.rowCount ?? 0, upd.rowCount ?? 0);
  out.remoteIdsByLsid = remoteIdsByLsid;
  return out;
}

async function flushPlaceAddressLinks(
  remoteClient: pg.PoolClient,
  batchId: bigint,
  pkg: LocalPackageRow,
  items: LocalPackageItemRow[]
): Promise<FlushOutcome> {
  const rows = items.map((it) => {
    const c = buildCommonRow(it, pkg);
    const p = it.payload;
    const nd = c.normalized_data;
    return {
      local_staging_id: c.local_staging_id,
      source_snapshot_id_local: c.source_snapshot_id_local,
      external_id: c.external_id,
      confidence_score: c.confidence_score,
      match_status: c.match_status,
      auto_action: c.auto_action,
      review_status: c.review_status,
      normalized_data: c.normalized_data,
      source_refs: c.source_refs,
      place_local_staging_id: pickInteger(p, ['place_local_staging_id']) ?? pickInteger(nd, ['place_local_staging_id']),
      place_external_id: pickString(p, ['place_external_id']) ?? pickString(nd, ['place_external_id']),
      address_local_staging_id: pickInteger(p, ['address_local_staging_id']) ?? pickInteger(nd, ['address_local_staging_id']),
      address_external_id: pickString(p, ['address_external_id']) ?? pickString(nd, ['address_external_id']),
      relation_type: pickString(p, ['relation_type']) ?? pickString(nd, ['relation_type']) ?? 'located_at',
      is_primary: pickBoolean(p, ['is_primary']) ?? pickBoolean(nd, ['is_primary']) ?? true,
      source_classification: pickString(p, ['source_classification']) ?? pickString(nd, ['source_classification']),
      address_strength: pickString(p, ['address_strength']) ?? pickString(nd, ['address_strength']),
      validation_status: pickString(p, ['validation_status']) ?? pickString(nd, ['validation_status']) ?? 'not_checked',
      promotion_status: pickString(p, ['promotion_status']) ?? pickString(nd, ['promotion_status']) ?? 'not_ready',
    };
  });

  const recordType = `
    local_staging_id bigint,
    source_snapshot_id_local bigint,
    external_id text,
    confidence_score numeric,
    match_status text,
    auto_action text,
    review_status text,
    normalized_data jsonb,
    source_refs jsonb,
    place_local_staging_id bigint,
    place_external_id text,
    address_local_staging_id bigint,
    address_external_id text,
    relation_type text,
    is_primary boolean,
    source_classification text,
    address_strength text,
    validation_status text,
    promotion_status text
  `;
  const dataCte = `
    WITH data AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS d (${recordType})
    ),
    resolved AS (
      SELECT data.*, p.id AS remote_place_candidate_id, a.id AS remote_address_candidate_id
      FROM data
      INNER JOIN import_review.place_candidates AS p
        ON p.review_batch_id = $1::bigint
       AND (
            (data.place_external_id IS NOT NULL AND p.external_id = data.place_external_id)
            OR (
              data.place_local_staging_id IS NOT NULL
              AND p.source_snapshot_version = $3::text
              AND p.entity_family = 'places'
              AND p.local_staging_id = data.place_local_staging_id
            )
       )
      INNER JOIN import_review.address_candidates AS a
        ON a.review_batch_id = $1::bigint
       AND (
            (data.address_external_id IS NOT NULL AND a.external_id = data.address_external_id)
            OR (
              data.address_local_staging_id IS NOT NULL
              AND a.source_snapshot_version = $3::text
              AND a.entity_family = 'addresses'
              AND a.local_staging_id = data.address_local_staging_id
            )
       )
    )`;

  const params = [batchId.toString(), JSON.stringify(rows), pkg.snapshot_version];
  const ins = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    ${dataCte},
    inserted AS (
      INSERT INTO import_review.place_address_links (
        review_batch_id, source_snapshot_id, external_id, place_candidate_id, address_candidate_id,
        relation_type, is_primary, confidence_score, match_status, auto_action, review_status,
        validation_status, promotion_status, source_refs, normalized_data, updated_at
      )
      SELECT
        $1::bigint,
        r.source_snapshot_id_local,
        r.external_id,
        r.remote_place_candidate_id,
        r.remote_address_candidate_id,
        CASE WHEN r.relation_type IN ('primary','located_at','entrance','delivery','mailing','nearby')
          THEN r.relation_type ELSE 'located_at' END,
        coalesce(r.is_primary, true),
        r.confidence_score,
        coalesce(r.match_status, 'new_candidate'),
        coalesce(r.auto_action, 'needs_review'),
        coalesce(r.review_status, 'pending'),
        coalesce(r.validation_status, 'not_checked'),
        coalesce(r.promotion_status, 'not_ready'),
        coalesce(r.source_refs, '{}'::jsonb) || jsonb_build_object(
          'local_staging_id', r.local_staging_id,
          'source_snapshot_id_local', r.source_snapshot_id_local,
          'place_local_staging_id', r.place_local_staging_id,
          'place_external_id', r.place_external_id,
          'address_local_staging_id', r.address_local_staging_id,
          'address_external_id', r.address_external_id
        ),
        coalesce(r.normalized_data, '{}'::jsonb),
        now()
      FROM resolved AS r
      WHERE NOT EXISTS (
        SELECT 1 FROM import_review.place_address_links AS existing
        WHERE existing.review_batch_id = $1::bigint
          AND (
            (r.external_id IS NOT NULL AND existing.external_id = r.external_id)
            OR (
              existing.place_candidate_id = r.remote_place_candidate_id
              AND existing.address_candidate_id = r.remote_address_candidate_id
              AND existing.relation_type = CASE WHEN r.relation_type IN ('primary','located_at','entrance','delivery','mailing','nearby')
                THEN r.relation_type ELSE 'located_at' END
            )
          )
      )
      RETURNING id, source_refs->>'local_staging_id' AS local_staging_id
    )
    SELECT id::text, local_staging_id::text FROM inserted
    `,
    params
  );

  const upd = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    ${dataCte},
    updated AS (
      UPDATE import_review.place_address_links AS t
      SET
        source_snapshot_id = r.source_snapshot_id_local,
        external_id = r.external_id,
        is_primary = coalesce(r.is_primary, true),
        confidence_score = r.confidence_score,
        match_status = coalesce(r.match_status, t.match_status),
        auto_action = coalesce(r.auto_action, t.auto_action),
        validation_status = coalesce(r.validation_status, t.validation_status),
        promotion_status = coalesce(r.promotion_status, t.promotion_status),
        source_refs = coalesce(r.source_refs, '{}'::jsonb) || jsonb_build_object(
          'local_staging_id', r.local_staging_id,
          'source_snapshot_id_local', r.source_snapshot_id_local,
          'place_local_staging_id', r.place_local_staging_id,
          'place_external_id', r.place_external_id,
          'address_local_staging_id', r.address_local_staging_id,
          'address_external_id', r.address_external_id
        ),
        normalized_data = coalesce(r.normalized_data, '{}'::jsonb),
        updated_at = now()
      FROM resolved AS r
      WHERE t.review_batch_id = $1::bigint
        AND (
          (r.external_id IS NOT NULL AND t.external_id = r.external_id)
          OR (
            t.place_candidate_id = r.remote_place_candidate_id
            AND t.address_candidate_id = r.remote_address_candidate_id
            AND t.relation_type = CASE WHEN r.relation_type IN ('primary','located_at','entrance','delivery','mailing','nearby')
              THEN r.relation_type ELSE 'located_at' END
          )
        )
        AND t.review_decision IS NULL
        AND t.review_status IN ('pending', 'needs_review')
      RETURNING t.id, r.local_staging_id
    )
    SELECT id::text, local_staging_id::text FROM updated
    `,
    params
  );

  await remoteClient.query(
    `
    ${dataCte}
    UPDATE import_review.address_candidates AS a
    SET
      linked_place_candidate_id = r.remote_place_candidate_id,
      place_candidate_status = CASE
        WHEN a.place_candidate_status IN ('not_applicable', 'needs_place_candidate') THEN 'place_candidate_created'
        ELSE a.place_candidate_status
      END,
      updated_at = now()
    FROM resolved AS r
    WHERE a.id = r.remote_address_candidate_id
      AND a.linked_place_candidate_id IS NULL
      AND a.source_classification = 'place_with_address'
    `,
    params
  );

  const remoteIdsByLsid = new Map<string, bigint>();
  mergeRemoteCandidateIdRows(ins.rows, remoteIdsByLsid);
  mergeRemoteCandidateIdRows(upd.rows, remoteIdsByLsid);
  const found = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    ${dataCte}
    SELECT t.id::text, r.local_staging_id::text
    FROM resolved AS r
    INNER JOIN import_review.place_address_links AS t
      ON t.review_batch_id = $1::bigint
     AND (
       (r.external_id IS NOT NULL AND t.external_id = r.external_id)
       OR (
         t.place_candidate_id = r.remote_place_candidate_id
         AND t.address_candidate_id = r.remote_address_candidate_id
         AND t.relation_type = CASE WHEN r.relation_type IN ('primary','located_at','entrance','delivery','mailing','nearby')
           THEN r.relation_type ELSE 'located_at' END
       )
     )
    `,
    params
  );
  mergeRemoteCandidateIdRows(found.rows, remoteIdsByLsid);

  const out = outcomeForFamily('place_address_links', items.length, ins.rowCount ?? 0, upd.rowCount ?? 0);
  out.remoteIdsByLsid = remoteIdsByLsid;
  return out;
}

function getUpsertSpec(family: EntityFamilySlug): UpsertSpec {
  if (family === 'buildings') return buildingsSpec();
  if (family === 'places') return placesSpec();
  if (family === 'roads') return roadsSpec();
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
  if (family !== 'address_components' && family !== 'place_address_links') {
    getUpsertSpec(family);
  }
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
  if (family === 'address_components') {
    const out = await flushAddressComponents(remoteClient, batchId, pkg, items);
    prog.done += items.length;
    return out;
  }
  if (family === 'place_address_links') {
    const out = await flushPlaceAddressLinks(remoteClient, batchId, pkg, items);
    prog.done += items.length;
    return out;
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

export function buildBatchCountUnionSql(families?: EntityFamilySlug[]): string {
  const configs =
    families && families.length > 0
      ? families.map((f) => ENTITY_FAMILY_UPLOAD_CONFIG[f])
      : Object.values(ENTITY_FAMILY_UPLOAD_CONFIG);
  const parts = configs.map((c) => {
    if (c.uploadMode === 'address_components') {
      return `select count(*)::int as c
        from import_review.address_components ac
        join import_review.address_candidates a on a.id = ac.address_candidate_id
       where a.review_batch_id = $1::bigint`;
    }
    return `select count(*)::int as c from import_review.${c.importReviewTable} where review_batch_id = $1::bigint`;
  });
  return parts.join('\n      union all\n      ');
}

export function buildBatchPreservedUnionSql(families?: EntityFamilySlug[]): string {
  const configs =
    families && families.length > 0
      ? families.map((f) => ENTITY_FAMILY_UPLOAD_CONFIG[f])
      : Object.values(ENTITY_FAMILY_UPLOAD_CONFIG);
  const parts = configs.map((c) => {
    if (c.uploadMode === 'address_components') {
      return `select count(*)::int as p
        from import_review.address_components t
        join import_review.address_candidates a on a.id = t.address_candidate_id
       where a.review_batch_id = $1::bigint
         and coalesce(t.is_reviewed, false) IS TRUE`;
    }
    return `select count(*)::int as p from import_review.${c.importReviewTable} t
       where t.review_batch_id = $1::bigint
         and not (${PRESERVED_REMOTE_WHERE_SQL})`;
  });
  return parts.join('\n      union all\n      ');
}
