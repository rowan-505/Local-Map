/**
 * Stage K — upload_remote_review_package
 *
 * Reads local `system.system_remote_review_packages` +
 * `system.system_remote_review_package_items` then upserts into Supabase `import_review`
 * (`review_batches`, `*_candidates`) with lineage columns matching migration 024 —
 * e.g. `source_snapshot_version`, `source_snapshot_id_local`, `local_staging_id`,
 * `entity_family`, `external_id`, `source_refs`, `normalized_data`, `review_batch_id`,
 * `matched_core_*`, `f2_comparison`, `confidence_score` (0–100 when present).
 *
 * Idempotent on `(review_batch_id, local_staging_id)`:
 * - INSERT when no remote row
 * - UPDATE import fields only when remote `review_decision IS NULL` AND `review_status = 'pending'`
 *
 * ENV:
 *   LOCAL_DATABASE_URL (unchanged: plain connectionString, no extra SSL options here)
 *   SUPABASE_DATABASE_URL
 *   SUPABASE_DB_SSL_VERIFY_SERVER_CERT — optional; must be exactly "true" to set Pool ssl.rejectUnauthorized (strict chain verify). Default: off (local upload).
 *   SUPABASE_DB_SSL_REJECT_UNAUTHORIZED — ignored (deprecated name; was often mistaken for "enable SSL"). Use VERIFY_SERVER_CERT for strict mode.
 *   REMOTE_REVIEW_UPLOAD_ENABLED — "true"|"1"|"yes"
 *   REMOTE_REVIEW_PACKAGE_NAME (required when enabled)
 *   REMOTE_REVIEW_ENTITY_FAMILY — optional buildings|places|roads
 *   REMOTE_REVIEW_MAX_ROWS_PER_FAMILY — optional positive int cap (per family slice)
 *
 * SSL (Supabase only):
 *   This is a local admin upload tool. Supabase pooler/direct connections often present
 *   certificate chains that fail Node's default verification (e.g. SELF_SIGNED_CERT_IN_CHAIN).
 *   The Supabase Pool uses ssl: { rejectUnauthorized: <bool> } with rejectUnauthorized=false
 *   unless SUPABASE_DB_SSL_VERIFY_SERVER_CERT is exactly the string "true".
 *
 *   SUPABASE_DB_SSL_REJECT_UNAUTHORIZED is not read (deprecated); use VERIFY_SERVER_CERT for strict TLS.
 *
 *   Do not put sslmode=require (or verify-*) on SUPABASE_DATABASE_URL for this script: the
 *   pg driver maps those modes toward full verification. TLS is enabled via the Pool `ssl`
 *   option instead; connection strings should omit sslmode (we strip sslmode/sslrootcert queries).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

const DOTENV_PATH = path.join(REPO_ROOT, '.env');
if (fs.existsSync(DOTENV_PATH)) {
  dotenv.config({ path: DOTENV_PATH });
} else {
  dotenv.config();
}

type EntityFamily = 'buildings' | 'places' | 'roads';

const CHUNK_SIZE = 500;

const ENTITY_FAMILIES: EntityFamily[] = ['buildings', 'places', 'roads'];

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

function parseBoolEnv(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/** Remove libpq sslmode params so Node `pg` TLS is controlled only by Pool.ssl (avoids require→verify-full mapping). */
function sanitizeSupabaseDatabaseUrl(urlStr: string): string {
  try {
    const scheme = /^postgresql:/i.test(urlStr) ? 'postgresql:' : 'postgres:';
    const normalized = urlStr.trim().replace(/^postgres(ql)?:/i, 'http:');
    const u = new URL(normalized);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('sslrootcert');
    return u.toString().replace(/^http:/i, scheme);
  } catch {
    return urlStr.replace(/([?&])sslmode=[^&]*/gi, '$1').replace(/([?&])sslrootcert=[^&]*/gi, '$1').replace(/\?&/, '?').replace(/[?&]$/, '');
  }
}

function coerceReviewStatus(localRaw: unknown): string {
  if (typeof localRaw === 'string' && REVIEW_STATUSES.has(localRaw)) return localRaw;
  return 'pending';
}

function geomJsonParam(geometryGeojson: unknown): string | null {
  if (geometryGeojson === null || geometryGeojson === undefined) return null;
  try {
    return JSON.stringify(geometryGeojson);
  } catch {
    return null;
  }
}

function normJsonObj(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pickNumeric(j: Record<string, unknown>, keys: string[]): number | null {
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

function pickInteger(
  j: Record<string, unknown>,
  keys: string[],
  rounding: 'trunc' | 'round' = 'trunc'
): number | null {
  const n = pickNumeric(j, keys);
  if (n === null) return null;
  return rounding === 'round' ? Math.round(n) : Math.trunc(n);
}

function pickString(j: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const raw = j[k];
    if (typeof raw === 'string' && raw.trim() !== '') return raw;
  }
  return null;
}

function parseConfidence(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function mapFamily(f: string): EntityFamily | null {
  const n = String(f).toLowerCase().trim();
  if (n === 'buildings' || n === 'places' || n === 'roads') return n;
  return null;
}

type LocalPackageRow = {
  id: string;
  package_name: string;
  source_snapshot_id: string;
  snapshot_version: string;
  region_code: string | null;
  entity_families: string[] | null;
  summary: Record<string, unknown> | null;
};

type LocalPackageItemRow = {
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

async function fetchPackage(local: pg.Pool, packageName: string): Promise<LocalPackageRow | null> {
  const r = await local.query(
    `
    select id,
           package_name,
           source_snapshot_id,
           snapshot_version,
           region_code,
           entity_families,
           summary
      from system.system_remote_review_packages
     where package_name = $1
     limit 1
    `,
    [packageName]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0] as Record<string, unknown>;
  const ef = row.entity_families;
  return {
    id: String(row.id),
    package_name: String(row.package_name),
    source_snapshot_id: String(row.source_snapshot_id),
    snapshot_version: String(row.snapshot_version),
    region_code: row.region_code == null ? null : String(row.region_code),
    entity_families: Array.isArray(ef) ? ef.map((x) => String(x)) : null,
    summary:
      row.summary !== null && typeof row.summary === 'object'
        ? (row.summary as Record<string, unknown>)
        : null,
  };
}

async function fetchItems(local: pg.Pool, pkgId: string): Promise<LocalPackageItemRow[]> {
  const res = await local.query(
    `
    select id,
           entity_family,
           local_staging_id,
           external_id,
           match_status,
           auto_action,
           review_status,
           review_decision,
           confidence_score,
           canonical_name,
           class_code,
           normalized_data,
           source_refs,
           matched_core_id,
           matched_core_table,
           matched_core_data,
           f2_comparison,
           geometry_geojson,
           coalesce(payload, '{}'::jsonb) as payload
      from system.system_remote_review_package_items
     where package_id = $1
     order by entity_family asc, local_staging_id asc
    `,
    [pkgId]
  );

  const rows = res.rows as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    entity_family: String(row.entity_family),
    local_staging_id: String(row.local_staging_id),
    external_id:
      row.external_id == null ? null : String(row.external_id),
    match_status:
      row.match_status == null ? null : String(row.match_status),
    auto_action: row.auto_action == null ? null : String(row.auto_action),
    review_status:
      row.review_status == null ? null : String(row.review_status),
    review_decision:
      row.review_decision == null ? null : String(row.review_decision),
    confidence_score:
      row.confidence_score == null ? null : String(row.confidence_score),
    canonical_name:
      row.canonical_name == null ? null : String(row.canonical_name),
    class_code: row.class_code == null ? null : String(row.class_code),
    normalized_data: row.normalized_data,
    source_refs: row.source_refs,
    matched_core_id:
      row.matched_core_id == null ? null : String(row.matched_core_id),
    matched_core_table:
      row.matched_core_table == null ? null : String(row.matched_core_table),
    matched_core_data: row.matched_core_data,
    f2_comparison: row.f2_comparison,
    geometry_geojson: row.geometry_geojson,
    payload: normJsonObj(row.payload),
  }));
}

async function upsertReviewBatch(remote: pg.Pool, pkg: LocalPackageRow): Promise<bigint> {
  const entityFamiliesRaw = pkg.entity_families ?? [...ENTITY_FAMILIES];

  const existing = await remote.query<{ id: string }>(
    `select id from import_review.review_batches where batch_name = $1 limit 1`,
    [pkg.package_name]
  );

  let batchIdStr: string;
  if (existing.rows[0]?.id != null) {
    batchIdStr = String(existing.rows[0].id);
    console.log(`[review_batches] reuse id=${batchIdStr} batch_name=${pkg.package_name}`);
  } else {
    const ins = await remote.query<{ id: string }>(
      `
      insert into import_review.review_batches (
        batch_name,
        source_snapshot_version,
        source_snapshot_id_local,
        region_code,
        entity_families,
        total_candidate_count,
        uploaded_candidate_count,
        preserved_reviewed_count,
        skipped_count,
        summary,
        status,
        upload_mode
      ) values (
        $1,
        $2,
        $3::bigint,
        $4,
        $5::text[],
        $6::int,
        0,
        0,
        0,
        $7::jsonb,
        $8::text,
        $9::text
      )
      returning id
      `,
      [
        pkg.package_name,
        pkg.snapshot_version,
        pkg.source_snapshot_id,
        pkg.region_code,
        entityFamiliesRaw,
        0,
        JSON.stringify(
          pkg.summary != null ? { ...pkg.summary, pipeline_touch: 'stage_k_upload_created' } : { pipeline_touch: 'stage_k_upload_created' }
        ),
        'uploaded',
        'local_pipeline',
      ]
    );
    batchIdStr = String(ins.rows[0].id);
    console.log(`[review_batches] created id=${batchIdStr} batch_name=${pkg.package_name}`);
  }

  return BigInt(batchIdStr);
}

async function syncBatchTotals(
  remote: pg.Pool,
  batchId: bigint,
  summaryPatch: Record<string, unknown>,
  filteredPackageItems: number
): Promise<void> {
  const bid = batchId.toString();
  await remote.query(
    `
    with cand as (
      select count(*)::int as c
        from import_review.building_candidates
       where review_batch_id = $1::bigint
      union all
      select count(*)::int
        from import_review.place_candidates
       where review_batch_id = $1::bigint
      union all
      select count(*)::int
        from import_review.road_candidates
       where review_batch_id = $1::bigint
    ),
    prv as (
      select count(*)::int as p
        from import_review.building_candidates t
       where t.review_batch_id = $1::bigint
         and not (t.review_decision is null and t.review_status = 'pending'::text)
      union all
      select count(*)::int
        from import_review.place_candidates t
       where t.review_batch_id = $1::bigint
         and not (t.review_decision is null and t.review_status = 'pending'::text)
      union all
      select count(*)::int
        from import_review.road_candidates t
       where t.review_batch_id = $1::bigint
         and not (t.review_decision is null and t.review_status = 'pending'::text)
    )
    update import_review.review_batches b
       set total_candidate_count = $2::int,
           uploaded_candidate_count = (select coalesce(sum(c), 0) from cand),
           preserved_reviewed_count = (select coalesce(sum(p), 0) from prv),
           skipped_count = (select coalesce(sum(p), 0) from prv),
           summary = coalesce(summary, '{}'::jsonb) || $3::jsonb,
           status = 'reviewing'::text,
           updated_at = now()
     where b.id = $1::bigint
    `,
    [bid, filteredPackageItems, JSON.stringify(summaryPatch)]
  );
}

async function bumpLocalPackageSuccess(
  local: pg.Pool,
  pkg: LocalPackageRow,
  remoteBatchId: bigint,
  summaryJson: Record<string, unknown>
): Promise<void> {
  await local.query(
    `
    update system.system_remote_review_packages
       set uploaded_at = now(),
           remote_review_batch_id = $2::bigint,
           remote_upload_status = 'completed'::text,
           note = concat_ws(E'\n', nullif(trim(coalesce(note, '')), ''),
                 format(
                   'stage_k_upload %s remote_batch=%s snapshot=%s',
                   $3::text, $4::text, $5::text)),
           summary = coalesce(summary, '{}'::jsonb) || $6::jsonb
     where id = $1::bigint
    `,
    [
      pkg.id,
      remoteBatchId.toString(),
      new Date().toISOString(),
      remoteBatchId.toString(),
      pkg.snapshot_version,
      JSON.stringify(summaryJson),
    ]
  );
}

async function bumpLocalPackageFailure(local: pg.Pool, pkgId: string, err: unknown): Promise<void> {
  const msg =
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
      ? ((err as { message: string }).message).slice(0, 2048)
      : String(err).slice(0, 2048);
  await local.query(
    `
    update system.system_remote_review_packages
       set remote_upload_status = 'failed'::text,
           note = concat_ws(E'\n', nullif(trim(coalesce(note, '')), ''),
                 format(E'stage_k_upload failed %s: %s', $2::text, $3::text))
     where id = $1::bigint
    `,
    [pkgId, new Date().toISOString(), msg]
  );
}

async function stampLocalItemsRowwiseChunked(
  local: pg.Pool,
  entries: Array<{
    package_id: string;
    family: EntityFamily;
    lsid: string;
    remoteId: bigint;
  }>
): Promise<void> {
  const client = await local.connect();
  const STEP = 500;
  try {
    for (let i = 0; i < entries.length; i += STEP) {
      const slice = entries.slice(i, i + STEP);
      await client.query('BEGIN');
      for (const e of slice) {
        await client.query(
          `
          update system.system_remote_review_package_items
             set remote_candidate_id = $3::bigint,
                 upload_status = 'completed'::text
           where package_id = $1::bigint
             and entity_family = $4::text
             and local_staging_id = $2::bigint
          `,
          [e.package_id, e.lsid, e.remoteId.toString(), e.family]
        );
      }
      await client.query('COMMIT');
    }
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /** ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

function filterAndCapItems(params: {
  items: LocalPackageItemRow[];
  familyFilter?: string;
  maxPerFamily?: number;
}): { filtered: LocalPackageItemRow[]; perFamilyCounts: Record<EntityFamily, number> } {
  const famKeyRaw = params.familyFilter?.trim().toLowerCase();
  let list = params.items.filter((i) => mapFamily(i.entity_family) !== null);
  const famAllowed = famKeyRaw ? mapFamily(famKeyRaw) : null;
  if (famAllowed) {
    list = list.filter((i) => mapFamily(i.entity_family) === famAllowed);
  }

  const buckets = new Map<EntityFamily, LocalPackageItemRow[]>();
  for (const f of ENTITY_FAMILIES) buckets.set(f, []);
  for (const it of list) {
    const f = mapFamily(it.entity_family)!;
    buckets.get(f)!.push(it);
  }

  let capRaw = params.maxPerFamily;
  const cap =
    typeof capRaw === 'number' &&
    Number.isFinite(capRaw) &&
    Math.trunc(capRaw) > 0
      ? Math.trunc(capRaw)
      : null;

  for (const f of ENTITY_FAMILIES) {
    buckets.get(f)!.sort((a, b) => Number(a.local_staging_id) - Number(b.local_staging_id));
  }

  const result: LocalPackageItemRow[] = [];
  const perFamilyCounts: Record<EntityFamily, number> = {
    buildings: 0,
    places: 0,
    roads: 0,
  };

  if (cap == null) {
    for (const f of ENTITY_FAMILIES) {
      const arr = buckets.get(f)!;
      perFamilyCounts[f] = arr.length;
      result.push(...arr);
    }
    return { filtered: result, perFamilyCounts };
  }

  if (famAllowed) {
    const arr = buckets.get(famAllowed)!;
    const sl = arr.slice(0, cap);
    perFamilyCounts[famAllowed] = sl.length;
    result.push(...sl);
    return { filtered: result, perFamilyCounts };
  }

  for (const f of ENTITY_FAMILIES) {
    const sl = buckets.get(f)!.slice(0, cap);
    perFamilyCounts[f] = sl.length;
    result.push(...sl);
  }
  result.sort((a, b) => {
      const af = mapFamily(a.entity_family)!;
      const bf = mapFamily(b.entity_family)!;
      if (af !== bf) return ENTITY_FAMILIES.indexOf(af) - ENTITY_FAMILIES.indexOf(bf);
      return Number(a.local_staging_id) - Number(b.local_staging_id);
    });
  return { filtered: result, perFamilyCounts };
}

/* -------------------------------------------------------------------------- */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type RunStats = {
  inserted_total: number;
  updated_pending_total: number;
  preserved_remote_total: number;
  errors: string[];
  per_family_uploaded: Record<EntityFamily, { inserted: number; updated_pending: number; preserved_remote: number }>;
};

type FlushOutcome = {
  stats: RunStats;
  /** import_review candidate id keyed by local_staging_id string */
  remoteIdsByLsid: Map<string, bigint>;
};

function mergeRemoteCandidateIdRows(
  rows: Array<{ id?: string | number | null; local_staging_id?: string | number | null }>,
  acc: Map<string, bigint>
): void {
  for (const row of rows) {
    if (row.id == null || row.local_staging_id == null) continue;
    acc.set(String(row.local_staging_id), BigInt(String(row.id)));
  }
}

async function fillRemoteCandidateIdsSameTxn(
  client: pg.PoolClient,
  tableSql: string,
  batchId: bigint,
  localStagingIds: string[],
  acc: Map<string, bigint>
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
    `
    select id::text, local_staging_id::text
      from ${tableSql}
     where review_batch_id = $1::bigint
       and local_staging_id = any ($2::bigint[])
    `,
    [batchId.toString(), nums]
  );
  mergeRemoteCandidateIdRows(r.rows, acc);
}

async function mergePayloadUploadFailure(
  local: pg.Pool,
  pkgId: string,
  entityFamily: string,
  localStagingIds: string[],
  phase: string,
  err: unknown
): Promise<void> {
  if (localStagingIds.length === 0) return;
  const msg =
    err !== null &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
      ? ((err as { message: string }).message).slice(0, 4000)
      : String(err).slice(0, 4000);
  const nums = localStagingIds.map((s) => {
    const n = Number(s);
    if (!Number.isSafeInteger(n)) throw new Error(`invalid local_staging_id: ${s}`);
    return n;
  });
  await local.query(
    `
    update system.system_remote_review_package_items
       set payload = coalesce(payload, '{}'::jsonb)
           || jsonb_build_object(
                'upload_error',
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'phase', $4::text,
                    'message', left($5::text, 4000),
                    'at', to_char(timezone('UTC', clock_timestamp()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                  )
                )),
           upload_status = 'failed'::text
     where package_id = $1::bigint
       and entity_family = $2::text
       and local_staging_id = any ($3::bigint[])
    `,
    [pkgId, entityFamily, nums, phase, msg]
  );
}

async function mergePayloadUploadResolveFailure(
  local: pg.Pool,
  pkgId: string,
  entityFamily: string,
  localStagingIds: string[],
  hint: string
): Promise<void> {
  await mergePayloadUploadFailure(local, pkgId, entityFamily, localStagingIds, 'remote_id_resolve', hint);
}

async function flushBuildings(
  remoteClient: pg.PoolClient,
  batchId: bigint,
  pkg: LocalPackageRow,
  items: LocalPackageItemRow[],
  prog: { done: number; total: number }
): Promise<FlushOutcome> {
  const jsonRows = items.map((it) => {
    const nd = normJsonObj(it.normalized_data);
    const sr =
      typeof it.source_refs === 'object' && it.source_refs !== null
        ? (it.source_refs as Record<string, unknown>)
        : {};
    const conf = parseConfidence(it.confidence_score);

    let matchedPk: bigint | null = null;
    if (it.matched_core_id != null && /^-?\d+$/.test(it.matched_core_id)) {
      matchedPk = BigInt(it.matched_core_id);
    }

    return {
      local_staging_id: Number(it.local_staging_id),
      source_snapshot_version: pkg.snapshot_version,
      source_snapshot_id_local: Number(pkg.source_snapshot_id),
      external_id: it.external_id,
      canonical_name: it.canonical_name,
      class_code: it.class_code,
      confidence_score: conf,
      match_status: it.match_status,
      auto_action: it.auto_action,
      review_status: coerceReviewStatus(it.review_status),
      review_decision: it.review_decision,
      normalized_data:
        typeof it.normalized_data === 'object'
          ? (it.normalized_data as Record<string, unknown>)
          : {},
      source_refs: sr as Record<string, unknown>,
      matched_core_id: matchedPk !== null ? Number(matchedPk) : null,
      matched_core_table: it.matched_core_table,
      matched_core_data:
        typeof it.matched_core_data === 'object' &&
        it.matched_core_data !== null
          ? (it.matched_core_data as Record<string, unknown>)
          : null,
      f2_comparison:
        typeof it.f2_comparison === 'object' && it.f2_comparison !== null
          ? (it.f2_comparison as Record<string, unknown>)
          : null,
      name_field: it.canonical_name ?? pickString(nd, ['name', 'display_name']),
      building_type_id: pickInteger(nd, ['building_type_id', 'building_type_id_local']),
      building_type: pickString(nd, ['building_type', 'building_type_text']),
      admin_area_id: pickInteger(nd, ['admin_area_id', 'admin_place_id']),
      levels: pickInteger(nd, ['levels', 'floors']),
      height_m: pickNumeric(nd, ['height_m', 'height']),
      area_m2: pickNumeric(nd, ['area_m2', 'floor_area']),
      geom_json: geomJsonParam(it.geometry_geojson),
    };
  });

  const chunkJson = JSON.stringify(jsonRows);

  const ins = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    with data AS (
      select *
        from jsonb_to_recordset($2::jsonb) as d (
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
          name_field text,
          building_type_id bigint,
          building_type text,
          admin_area_id bigint,
          levels integer,
          height_m numeric,
          area_m2 numeric,
          geom_json text
        )
    ),
    geom_prep AS (
      select data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
          ELSE NULL::geometry
        END AS geom_b
      from data
    )
    insert into import_review.building_candidates (
      review_batch_id,
      source_snapshot_version,
      source_snapshot_id_local,
      local_staging_id,
      entity_family,
      external_id,
      canonical_name,
      class_code,
      confidence_score,
      match_status,
      auto_action,
      review_status,
      review_decision,
      normalized_data,
      source_refs,
      matched_core_id,
      matched_core_table,
      matched_core_data,
      f2_comparison,
      name,
      building_type_id,
      building_type,
      admin_area_id,
      levels,
      height_m,
      area_m2,
      geom,
      centroid,
      updated_at
    )
    select
      $1::bigint,
      gp.source_snapshot_version,
      gp.source_snapshot_id_local::bigint,
      gp.local_staging_id::bigint,
      'buildings'::text,
      gp.external_id,
      gp.canonical_name,
      gp.class_code,
      gp.confidence_score,
      gp.match_status,
      gp.auto_action,
      gp.review_status,
      gp.review_decision,
      coalesce(gp.normalized_data,'{}'::jsonb),
      coalesce(gp.source_refs,'{}'::jsonb),
      gp.matched_core_id,
      gp.matched_core_table,
      gp.matched_core_data::jsonb,
      gp.f2_comparison::jsonb,
      gp.name_field,
      gp.building_type_id::bigint,
      gp.building_type,
      gp.admin_area_id::bigint,
      gp.levels::integer,
      gp.height_m,
      gp.area_m2,
      gp.geom_b,
      CASE WHEN gp.geom_b IS NOT NULL THEN ST_Centroid(gp.geom_b)::geometry(Point,4326) ELSE NULL END,
      now()
    from geom_prep gp
    WHERE NOT EXISTS (
      select 1
        from import_review.building_candidates e
       where e.review_batch_id = $1::bigint
         and e.local_staging_id = gp.local_staging_id
    )
    RETURNING id, local_staging_id
    `,
    [batchId.toString(), chunkJson]
  );

  const upd = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    with data AS (
      select *
        from jsonb_to_recordset($2::jsonb) as d (
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
          name_field text,
          building_type_id bigint,
          building_type text,
          admin_area_id bigint,
          levels integer,
          height_m numeric,
          area_m2 numeric,
          geom_json text
        )
    ),
    geom_prep AS (
      select data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
          ELSE NULL::geometry
        END AS geom_b
      from data
    )
    UPDATE import_review.building_candidates t
       SET source_snapshot_version = gp.source_snapshot_version,
           source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
           external_id = gp.external_id,
           canonical_name = gp.canonical_name,
           class_code = gp.class_code,
           confidence_score = gp.confidence_score,
           match_status = gp.match_status,
           auto_action = gp.auto_action,
           normalized_data = coalesce(gp.normalized_data,'{}'::jsonb),
           source_refs = coalesce(gp.source_refs,'{}'::jsonb),
           matched_core_id = gp.matched_core_id,
           matched_core_table = gp.matched_core_table,
           matched_core_data = gp.matched_core_data::jsonb,
           f2_comparison = gp.f2_comparison::jsonb,
           name = gp.name_field,
           building_type_id = gp.building_type_id::bigint,
           building_type = gp.building_type,
           admin_area_id = gp.admin_area_id::bigint,
           levels = gp.levels::integer,
           height_m = gp.height_m,
           area_m2 = gp.area_m2,
           geom = gp.geom_b,
           centroid = CASE WHEN gp.geom_b IS NOT NULL THEN ST_Centroid(gp.geom_b)::geometry(Point,4326) ELSE NULL END,
           updated_at = now()
      FROM geom_prep gp
     WHERE t.review_batch_id = $1::bigint
       AND t.local_staging_id = gp.local_staging_id
       AND t.review_decision IS NULL
       AND t.review_status = 'pending'::text
    RETURNING t.id, t.local_staging_id
    `,
    [batchId.toString(), chunkJson]
  );

  const remoteIdsByLsid = new Map<string, bigint>();
  mergeRemoteCandidateIdRows(ins.rows, remoteIdsByLsid);
  mergeRemoteCandidateIdRows(upd.rows, remoteIdsByLsid);
  await fillRemoteCandidateIdsSameTxn(
    remoteClient,
    'import_review.building_candidates',
    batchId,
    items.map((i) => String(i.local_staging_id)),
    remoteIdsByLsid
  );

  prog.done += items.length;

  const pr = Math.max(
    0,
    items.length - ((ins.rowCount ?? 0) + (upd.rowCount ?? 0))
  );

  return {
    stats: {
      inserted_total: ins.rowCount ?? 0,
      updated_pending_total: upd.rowCount ?? 0,
      preserved_remote_total: pr,
      errors: [],
      per_family_uploaded: {
        buildings: {
          inserted: ins.rowCount ?? 0,
          updated_pending: upd.rowCount ?? 0,
          preserved_remote: Math.max(
            0,
            items.length - ((ins.rowCount ?? 0) + (upd.rowCount ?? 0))
          ),
        },
        places: { inserted: 0, updated_pending: 0, preserved_remote: 0 },
        roads: { inserted: 0, updated_pending: 0, preserved_remote: 0 },
      },
    },
    remoteIdsByLsid,
  };
}

async function flushPlaces(
  remoteClient: pg.PoolClient,
  batchId: bigint,
  pkg: LocalPackageRow,
  items: LocalPackageItemRow[],
  prog: { done: number; total: number }
): Promise<FlushOutcome> {
  const jsonRows = items.map((it) => {
    const nd = normJsonObj(it.normalized_data);
    const sr =
      typeof it.source_refs === 'object' && it.source_refs !== null
        ? (it.source_refs as Record<string, unknown>)
        : {};
    const conf = parseConfidence(it.confidence_score);

    let matchedPk: bigint | null = null;
    if (it.matched_core_id != null && /^-?\d+$/.test(it.matched_core_id)) {
      matchedPk = BigInt(it.matched_core_id);
    }

    const place_class_id_raw = pickInteger(it.payload, ['place_class_id']);
    const poi_category_id_raw =
      pickInteger(it.payload, ['poi_category_id']) ??
      pickInteger(nd, ['poi_category_id', 'category_id']);

    const primary =
      pickString(nd, ['primary_name', 'name']) ??
      pickString(nd, ['label']) ??
      it.canonical_name;
    const display = pickString(nd, ['display_name']) ?? primary;

    return {
      local_staging_id: Number(it.local_staging_id),
      source_snapshot_version: pkg.snapshot_version,
      source_snapshot_id_local: Number(pkg.source_snapshot_id),
      external_id: it.external_id,
      canonical_name: it.canonical_name,
      class_code: it.class_code,
      confidence_score: conf,
      match_status: it.match_status,
      auto_action: it.auto_action,
      review_status: coerceReviewStatus(it.review_status),
      review_decision: it.review_decision,
      normalized_data:
        typeof it.normalized_data === 'object'
          ? (it.normalized_data as Record<string, unknown>)
          : {},
      source_refs: sr as Record<string, unknown>,
      matched_core_id: matchedPk !== null ? Number(matchedPk) : null,
      matched_core_table: it.matched_core_table,
      matched_core_data:
        typeof it.matched_core_data === 'object' &&
        it.matched_core_data !== null
          ? (it.matched_core_data as Record<string, unknown>)
          : null,
      f2_comparison:
        typeof it.f2_comparison === 'object' && it.f2_comparison !== null
          ? (it.f2_comparison as Record<string, unknown>)
          : null,
      primary_name: primary,
      display_name: display,
      category_id:
        poi_category_id_raw !== null ? Number(poi_category_id_raw) : null,
      place_class_id:
        place_class_id_raw !== null ? Number(place_class_id_raw) : null,
      admin_area_id: pickInteger(nd, ['admin_area_id']),
      geom_json: geomJsonParam(it.geometry_geojson),
    };
  });

  const chunkJson = JSON.stringify(jsonRows);

  const ins = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    with data AS (
      select *
        from jsonb_to_recordset($2::jsonb) as d (
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
          primary_name text,
          display_name text,
          category_id bigint,
          place_class_id bigint,
          admin_area_id bigint,
          geom_json text
        )
    ),
    geom_prep AS (
      select data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Point,4326)
          ELSE NULL::geometry
        END AS pt_geom
      from data
    )
    INSERT INTO import_review.place_candidates (
      review_batch_id,
      source_snapshot_version,
      source_snapshot_id_local,
      local_staging_id,
      entity_family,
      external_id,
      canonical_name,
      class_code,
      confidence_score,
      match_status,
      auto_action,
      review_status,
      review_decision,
      normalized_data,
      source_refs,
      matched_core_id,
      matched_core_table,
      matched_core_data,
      f2_comparison,
      primary_name,
      display_name,
      category_id,
      place_class_id,
      admin_area_id,
      point_geom,
      lat,
      lng,
      updated_at
    )
    SELECT
      $1::bigint,
      gp.source_snapshot_version,
      gp.source_snapshot_id_local::bigint,
      gp.local_staging_id::bigint,
      'places'::text,
      gp.external_id,
      gp.canonical_name,
      gp.class_code,
      gp.confidence_score,
      gp.match_status,
      gp.auto_action,
      gp.review_status,
      gp.review_decision,
      coalesce(gp.normalized_data,'{}'::jsonb),
      coalesce(gp.source_refs,'{}'::jsonb),
      gp.matched_core_id,
      gp.matched_core_table,
      gp.matched_core_data::jsonb,
      gp.f2_comparison::jsonb,
      gp.primary_name,
      gp.display_name,
      gp.category_id::bigint,
      gp.place_class_id::bigint,
      gp.admin_area_id::bigint,
      gp.pt_geom,
      CASE WHEN gp.pt_geom IS NOT NULL THEN ST_Y(gp.pt_geom)::double precision END,
      CASE WHEN gp.pt_geom IS NOT NULL THEN ST_X(gp.pt_geom)::double precision END,
      now()
    FROM geom_prep gp
    WHERE NOT EXISTS (
      SELECT 1 FROM import_review.place_candidates e
       WHERE e.review_batch_id = $1::bigint
         AND e.local_staging_id = gp.local_staging_id
    )
    RETURNING id, local_staging_id
    `,
    [batchId.toString(), chunkJson]
  );

  const upd = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    WITH data AS (
      SELECT *
        FROM jsonb_to_recordset($2::jsonb) AS d (
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
          primary_name text,
          display_name text,
          category_id bigint,
          place_class_id bigint,
          admin_area_id bigint,
          geom_json text
        )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Point,4326)
          ELSE NULL::geometry
        END AS pt_geom
      FROM data
    )
    UPDATE import_review.place_candidates t
       SET source_snapshot_version = gp.source_snapshot_version,
           source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
           external_id = gp.external_id,
           canonical_name = gp.canonical_name,
           class_code = gp.class_code,
           confidence_score = gp.confidence_score,
           match_status = gp.match_status,
           auto_action = gp.auto_action,
           normalized_data = coalesce(gp.normalized_data,'{}'::jsonb),
           source_refs = coalesce(gp.source_refs,'{}'::jsonb),
           matched_core_id = gp.matched_core_id,
           matched_core_table = gp.matched_core_table,
           matched_core_data = gp.matched_core_data::jsonb,
           f2_comparison = gp.f2_comparison::jsonb,
           primary_name = gp.primary_name,
           display_name = gp.display_name,
           category_id = gp.category_id::bigint,
           place_class_id = gp.place_class_id::bigint,
           admin_area_id = gp.admin_area_id::bigint,
           point_geom = gp.pt_geom,
           lat = CASE WHEN gp.pt_geom IS NOT NULL THEN ST_Y(gp.pt_geom)::double precision END,
           lng = CASE WHEN gp.pt_geom IS NOT NULL THEN ST_X(gp.pt_geom)::double precision END,
           updated_at = now()
      FROM geom_prep gp
     WHERE t.review_batch_id = $1::bigint
       AND t.local_staging_id = gp.local_staging_id
       AND t.review_decision IS NULL
       AND t.review_status = 'pending'::text
    RETURNING t.id, t.local_staging_id
    `,
    [batchId.toString(), chunkJson]
  );

  const remoteIdsByLsid = new Map<string, bigint>();
  mergeRemoteCandidateIdRows(ins.rows, remoteIdsByLsid);
  mergeRemoteCandidateIdRows(upd.rows, remoteIdsByLsid);
  await fillRemoteCandidateIdsSameTxn(
    remoteClient,
    'import_review.place_candidates',
    batchId,
    items.map((i) => String(i.local_staging_id)),
    remoteIdsByLsid
  );

  prog.done += items.length;
  const pr = Math.max(
    0,
    items.length -
      ((ins.rowCount ?? 0) + (upd.rowCount ?? 0))
  );

  return {
    stats: {
      inserted_total: ins.rowCount ?? 0,
      updated_pending_total: upd.rowCount ?? 0,
      preserved_remote_total: pr,
      errors: [],
      per_family_uploaded: {
        buildings: { inserted: 0, updated_pending: 0, preserved_remote: 0 },
        places: {
          inserted: ins.rowCount ?? 0,
          updated_pending: upd.rowCount ?? 0,
          preserved_remote: pr,
        },
        roads: { inserted: 0, updated_pending: 0, preserved_remote: 0 },
      },
    },
    remoteIdsByLsid,
  };
}

async function flushRoads(
  remoteClient: pg.PoolClient,
  batchId: bigint,
  pkg: LocalPackageRow,
  items: LocalPackageItemRow[],
  prog: { done: number; total: number }
): Promise<FlushOutcome> {
  const jsonRows = items.map((it) => {
    const nd = normJsonObj(it.normalized_data);
    const sr =
      typeof it.source_refs === 'object' && it.source_refs !== null
        ? (it.source_refs as Record<string, unknown>)
        : {};
    const conf = parseConfidence(it.confidence_score);

    let matchedPk: bigint | null = null;
    if (it.matched_core_id != null && /^-?\d+$/.test(it.matched_core_id)) {
      matchedPk = BigInt(it.matched_core_id);
    }

    const road_class_id_raw = pickInteger(it.payload, ['road_class_id']);

    return {
      local_staging_id: Number(it.local_staging_id),
      source_snapshot_version: pkg.snapshot_version,
      source_snapshot_id_local: Number(pkg.source_snapshot_id),
      external_id: it.external_id,
      canonical_name: it.canonical_name,
      class_code: it.class_code,
      confidence_score: conf,
      match_status: it.match_status,
      auto_action: it.auto_action,
      review_status: coerceReviewStatus(it.review_status),
      review_decision: it.review_decision,
      normalized_data:
        typeof it.normalized_data === 'object'
          ? (it.normalized_data as Record<string, unknown>)
          : {},
      source_refs: sr as Record<string, unknown>,
      matched_core_id: matchedPk !== null ? Number(matchedPk) : null,
      matched_core_table: it.matched_core_table,
      matched_core_data:
        typeof it.matched_core_data === 'object' &&
        it.matched_core_data !== null
          ? (it.matched_core_data as Record<string, unknown>)
          : null,
      f2_comparison:
        typeof it.f2_comparison === 'object' && it.f2_comparison !== null
          ? (it.f2_comparison as Record<string, unknown>)
          : null,
      road_class_id:
        road_class_id_raw !== null ? Number(road_class_id_raw) : null,
      road_class_txt: pickString(nd, ['road_class', 'highway']),
      surface: pickString(nd, ['surface']),
      is_oneway:
        nd.oneway === true
          ? true
          : nd.oneway === false
            ? false
            : null,
      bridge: nd.bridge === true ? true : nd.bridge === false ? false : null,
      tunnel: nd.tunnel === true ? true : nd.tunnel === false ? false : null,
      layer: pickInteger(nd, ['layer']),
      length_m: pickNumeric(nd, ['length_m', 'length']),
      geom_json: geomJsonParam(it.geometry_geojson),
    };
  });

  const chunkJson = JSON.stringify(jsonRows);

  const ins = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    with data AS (
      select *
        from jsonb_to_recordset($2::jsonb) as d (
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
          road_class_id bigint,
          road_class_txt text,
          surface text,
          is_oneway boolean,
          bridge boolean,
          tunnel boolean,
          layer integer,
          length_m numeric,
          geom_json text
        )
    ),
    geom_prep AS (
      select data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
          ELSE NULL::geometry
        END AS ggeom
      from data
    )
    INSERT INTO import_review.road_candidates (
      review_batch_id,
      source_snapshot_version,
      source_snapshot_id_local,
      local_staging_id,
      entity_family,
      external_id,
      canonical_name,
      class_code,
      confidence_score,
      match_status,
      auto_action,
      review_status,
      review_decision,
      normalized_data,
      source_refs,
      matched_core_id,
      matched_core_table,
      matched_core_data,
      f2_comparison,
      road_class_id,
      road_class,
      surface,
      is_oneway,
      bridge,
      tunnel,
      layer,
      length_m,
      geom,
      updated_at
    )
    SELECT
      $1::bigint,
      gp.source_snapshot_version,
      gp.source_snapshot_id_local::bigint,
      gp.local_staging_id::bigint,
      'roads'::text,
      gp.external_id,
      gp.canonical_name,
      gp.class_code,
      gp.confidence_score,
      gp.match_status,
      gp.auto_action,
      gp.review_status,
      gp.review_decision,
      coalesce(gp.normalized_data,'{}'::jsonb),
      coalesce(gp.source_refs,'{}'::jsonb),
      gp.matched_core_id,
      gp.matched_core_table,
      gp.matched_core_data::jsonb,
      gp.f2_comparison::jsonb,
      gp.road_class_id::bigint,
      coalesce(gp.road_class_txt, gp.class_code),
      gp.surface,
      gp.is_oneway,
      gp.bridge,
      gp.tunnel,
      gp.layer::integer,
      gp.length_m,
      gp.ggeom,
      now()
    FROM geom_prep gp
    WHERE NOT EXISTS (
      SELECT 1 FROM import_review.road_candidates e
       WHERE e.review_batch_id = $1::bigint
         AND e.local_staging_id = gp.local_staging_id
    )
    RETURNING id, local_staging_id
    `,
    [batchId.toString(), chunkJson]
  );

  const upd = await remoteClient.query<{ id: string; local_staging_id: string }>(
    `
    WITH data AS (
      SELECT *
        FROM jsonb_to_recordset($2::jsonb) AS d (
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
          road_class_id bigint,
          road_class_txt text,
          surface text,
          is_oneway boolean,
          bridge boolean,
          tunnel boolean,
          layer integer,
          length_m numeric,
          geom_json text
        )
    ),
    geom_prep AS (
      SELECT data.*,
        CASE
          WHEN geom_json IS NOT NULL AND btrim(geom_json) <> '' THEN
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json::text)::geometry, 4326)::geometry(Geometry,4326)
          ELSE NULL::geometry
        END AS ggeom
      FROM data
    )
    UPDATE import_review.road_candidates t
       SET source_snapshot_version = gp.source_snapshot_version,
           source_snapshot_id_local = gp.source_snapshot_id_local::bigint,
           external_id = gp.external_id,
           canonical_name = gp.canonical_name,
           class_code = gp.class_code,
           confidence_score = gp.confidence_score,
           match_status = gp.match_status,
           auto_action = gp.auto_action,
           normalized_data = coalesce(gp.normalized_data,'{}'::jsonb),
           source_refs = coalesce(gp.source_refs,'{}'::jsonb),
           matched_core_id = gp.matched_core_id,
           matched_core_table = gp.matched_core_table,
           matched_core_data = gp.matched_core_data::jsonb,
           f2_comparison = gp.f2_comparison::jsonb,
           road_class_id = gp.road_class_id::bigint,
           road_class = coalesce(gp.road_class_txt, gp.class_code),
           surface = gp.surface,
           is_oneway = gp.is_oneway,
           bridge = gp.bridge,
           tunnel = gp.tunnel,
           layer = gp.layer::integer,
           length_m = gp.length_m,
           geom = gp.ggeom,
           updated_at = now()
      FROM geom_prep gp
     WHERE t.review_batch_id = $1::bigint
       AND t.local_staging_id = gp.local_staging_id
       AND t.review_decision IS NULL
       AND t.review_status = 'pending'::text
    RETURNING t.id, t.local_staging_id
    `,
    [batchId.toString(), chunkJson]
  );

  const remoteIdsByLsid = new Map<string, bigint>();
  mergeRemoteCandidateIdRows(ins.rows, remoteIdsByLsid);
  mergeRemoteCandidateIdRows(upd.rows, remoteIdsByLsid);
  await fillRemoteCandidateIdsSameTxn(
    remoteClient,
    'import_review.road_candidates',
    batchId,
    items.map((i) => String(i.local_staging_id)),
    remoteIdsByLsid
  );

  prog.done += items.length;
  const pr = Math.max(
    0,
    items.length -
      ((ins.rowCount ?? 0) + (upd.rowCount ?? 0))
  );

  return {
    stats: {
      inserted_total: ins.rowCount ?? 0,
      updated_pending_total: upd.rowCount ?? 0,
      preserved_remote_total: pr,
      errors: [],
      per_family_uploaded: {
        buildings: { inserted: 0, updated_pending: 0, preserved_remote: 0 },
        places: { inserted: 0, updated_pending: 0, preserved_remote: 0 },
        roads: {
          inserted: ins.rowCount ?? 0,
          updated_pending: upd.rowCount ?? 0,
          preserved_remote: pr,
        },
      },
    },
    remoteIdsByLsid,
  };
}

function mergeAgg(
  agg: Record<EntityFamily, { inserted: number; updated_pending: number; preserved_remote: number }>,
  part: Record<EntityFamily, { inserted: number; updated_pending: number; preserved_remote: number }>
): void {
  for (const f of ENTITY_FAMILIES) {
    agg[f].inserted += part[f].inserted;
    agg[f].updated_pending += part[f].updated_pending;
    agg[f].preserved_remote += part[f].preserved_remote;
  }
}

async function main(): Promise<number> {
  const enabled = parseBoolEnv(process.env.REMOTE_REVIEW_UPLOAD_ENABLED);
  if (!enabled) {
    console.log(
      'REMOTE_REVIEW_UPLOAD_ENABLED is off; exiting without doing anything (stage K noop).'
    );
    return 0;
  }

  const localUrl = process.env.LOCAL_DATABASE_URL?.trim();
  const remoteUrlRaw = process.env.SUPABASE_DATABASE_URL?.trim();
  const pkgName = process.env.REMOTE_REVIEW_PACKAGE_NAME?.trim();

  if (!localUrl || !remoteUrlRaw) {
    console.error('LOCAL_DATABASE_URL and SUPABASE_DATABASE_URL are required.');
    return 1;
  }

  if (!pkgName) {
    console.error('REMOTE_REVIEW_PACKAGE_NAME is required when upload is enabled.');
    return 1;
  }

  if (process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED !== undefined) {
    console.warn(
      '[stage_k] SUPABASE_DB_SSL_REJECT_UNAUTHORIZED is ignored (deprecated). Strict TLS uses SUPABASE_DB_SSL_VERIFY_SERVER_CERT=true only.'
    );
  }

  const supabaseSslRejectUnauthorized =
    process.env.SUPABASE_DB_SSL_VERIFY_SERVER_CERT === 'true';
  console.log(
    `[stage_k] connection: using Supabase database URL: ${remoteUrlRaw ? 'yes' : 'no'}`
  );
  console.log(
    `[stage_k] connection: ssl.rejectUnauthorized=${supabaseSslRejectUnauthorized}`
  );

  const remoteUrl = sanitizeSupabaseDatabaseUrl(remoteUrlRaw);

  const maxRowsEnv = process.env.REMOTE_REVIEW_MAX_ROWS_PER_FAMILY?.trim();
  const maxPerFamilyParsed =
    maxRowsEnv !== undefined &&
    maxRowsEnv !== '' &&
    Number.isFinite(Number(maxRowsEnv))
      ? Math.trunc(Number(maxRowsEnv))
      : undefined;

  const familyEnv = process.env.REMOTE_REVIEW_ENTITY_FAMILY?.trim();

  const localPool = new pg.Pool({ connectionString: localUrl });
  // Supabase pool only: TLS options below. Local lab DB is unchanged (connectionString only).
  const remotePool = new pg.Pool({
    connectionString: remoteUrl,
    max: 4,
    connectionTimeoutMillis: 30_000,
    ssl: {
      rejectUnauthorized: supabaseSslRejectUnauthorized,
    },
  });

  let pkgSummary: LocalPackageRow | null = null;

  try {
    pkgSummary = await fetchPackage(localPool, pkgName);
    if (!pkgSummary) {
      console.error(`Local package_name not found: ${pkgName}`);
      return 1;
    }

    const itemsAll = await fetchItems(localPool, pkgSummary.id);
    const { filtered, perFamilyCounts } = filterAndCapItems({
      items: itemsAll,
      familyFilter: familyEnv,
      maxPerFamily: maxPerFamilyParsed,
    });

    if (filtered.length === 0) {
      console.log('No candidate rows matched filters — nothing uploaded.');
      return 0;
    }

    const batchId = await upsertReviewBatch(remotePool, pkgSummary);

    const progState = { done: 0, total: filtered.length };
    let insertedRun = 0;
    let updatedRun = 0;
    let preservedRun = 0;

    const agg: Record<
      EntityFamily,
      { inserted: number; updated_pending: number; preserved_remote: number }
    > = {
      buildings: { inserted: 0, updated_pending: 0, preserved_remote: 0 },
      places: { inserted: 0, updated_pending: 0, preserved_remote: 0 },
      roads: { inserted: 0, updated_pending: 0, preserved_remote: 0 },
    };

    const stampEntries: Array<{
      package_id: string;
      family: EntityFamily;
      lsid: string;
      remoteId: bigint;
    }> = [];

    const famRestrictedEnv = mapFamily(familyEnv?.trim().toLowerCase() ?? '');
    const uploadedFamiliesOnly: EntityFamily[] = famRestrictedEnv
      ? [famRestrictedEnv]
      : [...ENTITY_FAMILIES];

    let chunkCommitsOk = 0;
    let chunkFailures = 0;

    function itemEligibleForStamp(it: LocalPackageItemRow): boolean {
      const f = mapFamily(it.entity_family);
      return f !== null && uploadedFamiliesOnly.includes(f);
    }

    for (const family of ENTITY_FAMILIES) {
      const famMapped = mapFamily(familyEnv ?? '');
      if (famMapped && family !== famMapped) continue;

      const famItems = filtered.filter((i) => mapFamily(i.entity_family) === family);
      if (famItems.length === 0) continue;

      const remoteClient = await remotePool.connect();

      console.log(`[family ${family}] uploading ${famItems.length} rows (chunks of ${CHUNK_SIZE})`);

      try {
        for (const slice of chunk(famItems, CHUNK_SIZE)) {
          await remoteClient.query('BEGIN');
          let outcome: FlushOutcome;
          try {
            if (family === 'buildings') {
              outcome = await flushBuildings(remoteClient, batchId, pkgSummary, slice, progState);
            } else if (family === 'places') {
              outcome = await flushPlaces(remoteClient, batchId, pkgSummary, slice, progState);
            } else {
              outcome = await flushRoads(remoteClient, batchId, pkgSummary, slice, progState);
            }
            insertedRun += outcome.stats.inserted_total;
            updatedRun += outcome.stats.updated_pending_total;
            preservedRun += outcome.stats.preserved_remote_total;
            mergeAgg(agg, outcome.stats.per_family_uploaded);
            await remoteClient.query('COMMIT');
            chunkCommitsOk++;

            for (const r of slice) {
              const rid = outcome.remoteIdsByLsid.get(String(r.local_staging_id));
              if (rid !== undefined) {
                stampEntries.push({
                  package_id: pkgSummary.id,
                  family,
                  lsid: r.local_staging_id,
                  remoteId: rid,
                });
              }
            }

            const lsidsUnresolved = slice
              .filter(
                (r) => outcome.remoteIdsByLsid.get(String(r.local_staging_id)) === undefined
              )
              .map((r) => r.local_staging_id);
            if (lsidsUnresolved.length > 0) {
              await mergePayloadUploadResolveFailure(
                localPool,
                pkgSummary.id,
                family,
                lsidsUnresolved,
                'committed_chunk_missing_remote_candidate_id_after_flush'
              );
            }
          } catch (e) {
            chunkFailures++;
            await remoteClient.query('ROLLBACK');
            await mergePayloadUploadFailure(
              localPool,
              pkgSummary.id,
              family,
              slice.map((r) => r.local_staging_id),
              'chunk_flush',
              e
            );
            console.error('[error] chunk aborted:', e);
            throw e;
          }

          const pct = progState.total
            ? ((progState.done / progState.total) * 100).toFixed(1)
            : '100.0';
          console.log(
            `progress ${progState.done}/${progState.total} (${pct}%): family=${family} chunk_ins=${outcome.stats.inserted_total} chunk_upd=${outcome.stats.updated_pending_total} chunk_pres=${outcome.stats.preserved_remote_total}`
          );
        }
      } finally {
        remoteClient.release();
      }

      console.log(
        `[family ${family}] totals inserted=${agg[family].inserted} pending_refresh=${agg[family].updated_pending} preserved_reviewed/skipped_remote=${agg[family].preserved_remote} (planned rows ${perFamilyCounts[family]} )`
      );
    }

    const stampedKeySet = new Set(stampEntries.map((e) => `${e.family}:${e.lsid}`));
    const missingAfterRun = filtered.filter((it) => {
      if (!itemEligibleForStamp(it)) return false;
      const f = mapFamily(it.entity_family)!;
      return !stampedKeySet.has(`${f}:${it.local_staging_id}`);
    });
    if (missingAfterRun.length > 0) {
      const grouped = new Map<EntityFamily, string[]>();
      for (const r of missingAfterRun) {
        const f = mapFamily(r.entity_family)!;
        if (!grouped.has(f)) grouped.set(f, []);
        grouped.get(f)!.push(r.local_staging_id);
      }
      for (const [f, lsids] of grouped) {
        await mergePayloadUploadResolveFailure(
          localPool,
          pkgSummary.id,
          f,
          lsids,
          'post_run_expected_item_never_received_remote_candidate_id'
        );
      }
    }

    const summaryPatch = {
      stage_k_upload: {
        finished_at_utc: new Date().toISOString(),
        package_name: pkgSummary.package_name,
        filtered_items_total: progState.total,
        per_family_filtered: perFamilyCounts,
        per_family_aggregate: agg,
        inserted_estimate: insertedRun,
        pending_refreshes_estimate: updatedRun,
        preserved_remote_estimate: preservedRun,
        stamped_local_remote_candidate_id_count: stampEntries.length,
        chunk_commits_ok: chunkCommitsOk,
        chunk_failures: chunkFailures,
        unresolved_after_run_expected:
          filtered.filter(itemEligibleForStamp).length - stampEntries.length,
        missing_after_run_resolve_marked_count: missingAfterRun.length,
      },
    };

    await syncBatchTotals(remotePool, batchId, summaryPatch, progState.total);

    await bumpLocalPackageSuccess(localPool, pkgSummary, batchId, summaryPatch);

    console.log(`[local stamps] syncing remote_candidate_id for ${stampEntries.length} rows…`);
    await stampLocalItemsRowwiseChunked(localPool, stampEntries);

    console.log('[stage_k] lineage stamp summary:', {
      uploaded_rows_ins_plus_upd_refresh: insertedRun + updatedRun,
      preserved_reviewed_remote: preservedRun,
      local_rows_stamped_with_remote_candidate_id: stampEntries.length,
      chunk_commits_ok: chunkCommitsOk,
      chunk_failures: chunkFailures,
      missing_resolve_markers_post_run: missingAfterRun.length,
    });

    console.log('[stage_k] done', {
      remote_review_batch_id: batchId.toString(),
      summaries: summaryPatch,
    });

    return 0;
  } catch (err) {
    console.error('[stage_k] failed', err);
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'SELF_SIGNED_CERT_IN_CHAIN'
    ) {
      console.error(
        '[stage_k] TLS: certificate chain verification failed. This script uses ssl.rejectUnauthorized=false unless SUPABASE_DB_SSL_VERIFY_SERVER_CERT=true. ' +
          'Unset VERIFY_SERVER_CERT or fix your trust store / Supabase CA if you require strict verify.'
      );
    }
    if (pkgSummary) {
      try {
        await bumpLocalPackageFailure(localPool, pkgSummary.id, err);
      } catch (e2) {
        console.error('[stage_k] could not annotate local failure', e2);
      }
    }
    return 1;
  } finally {
    await Promise.all([
      localPool.end().catch(() => undefined),
      remotePool.end().catch(() => undefined),
    ]);
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });