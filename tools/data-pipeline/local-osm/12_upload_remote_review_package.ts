/**
 * Stage K — upload_remote_review_package
 *
 * Reads local system.system_remote_review_packages + package_items, upserts Supabase import_review.
 * Idempotent on (review_batch_id, local_staging_id) for pending rows.
 *
 * CLI:
 *   --package-name=remote_review_pkg_...
 *   --entity-family=all|buildings,places,roads,bus_stops,landuse,water_lines,water_polygons,addresses,admin_areas,routing_barriers
 *   --max-rows-per-family=N
 *
 * ENV: LOCAL_DATABASE_URL, SUPABASE_DATABASE_URL, REMOTE_REVIEW_UPLOAD_ENABLED,
 *      REMOTE_REVIEW_PACKAGE_NAME, REMOTE_REVIEW_ENTITY_FAMILY, REMOTE_REVIEW_MAX_ROWS_PER_FAMILY
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

import {
  emptyPerFamilyCounts,
  emptyPerFamilyUploadStats,
  familiesFromPackageItemCounts,
  isEntityFamilySlug,
  parseEntityFamilyFilter,
  REMOTE_REVIEW_ENTITY_FAMILIES,
  resolveEntityFamiliesForUpload,
  type EntityFamilySlug,
} from './remote-review-entity-config.js';
import {
  assertUploadConfigForFamily,
  buildBatchCountUnionSql,
  buildBatchPreservedUnionSql,
  flushEntityFamily,
  mergeFlushOutcomes,
  type FlushOutcome,
  type LocalPackageItemRow,
  type LocalPackageRow,
} from './remote-review-upload-flush.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const LOG_DIR = path.join(REPO_ROOT, 'logs', 'data-pipeline');

const DOTENV_PATH = path.join(REPO_ROOT, '.env');
if (fs.existsSync(DOTENV_PATH)) {
  dotenv.config({ path: DOTENV_PATH });
} else {
  dotenv.config();
}

const CHUNK_SIZE = 500;

function parseBoolEnv(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function sanitizeSupabaseDatabaseUrl(urlStr: string): string {
  try {
    const scheme = /^postgresql:/i.test(urlStr) ? 'postgresql:' : 'postgres:';
    const normalized = urlStr.trim().replace(/^postgres(ql)?:/i, 'http:');
    const u = new URL(normalized);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('sslrootcert');
    return u.toString().replace(/^http:/i, scheme);
  } catch {
    return urlStr
      .replace(/([?&])sslmode=[^&]*/gi, '$1')
      .replace(/([?&])sslrootcert=[^&]*/gi, '$1')
      .replace(/\?&/, '?')
      .replace(/[?&]$/, '');
  }
}

function parseCliArgs(): {
  packageName?: string;
  entityFamilyRaw?: string;
  maxRowsPerFamily?: number;
} {
  const args = process.argv.slice(2);
  let packageName: string | undefined;
  let entityFamilyRaw: string | undefined;
  let maxRowsPerFamily: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--package-name' && args[i + 1]) {
      packageName = args[++i];
      continue;
    }
    if (a.startsWith('--package-name=')) {
      packageName = a.slice('--package-name='.length);
      continue;
    }
    if (a === '--entity-family' && args[i + 1]) {
      entityFamilyRaw = args[++i];
      continue;
    }
    if (a.startsWith('--entity-family=')) {
      entityFamilyRaw = a.slice('--entity-family='.length);
      continue;
    }
    if (a === '--max-rows-per-family' && args[i + 1]) {
      const n = Number(args[++i]);
      if (Number.isFinite(n) && n > 0) maxRowsPerFamily = Math.trunc(n);
      continue;
    }
    if (a.startsWith('--max-rows-per-family=')) {
      const n = Number(a.slice('--max-rows-per-family='.length));
      if (Number.isFinite(n) && n > 0) maxRowsPerFamily = Math.trunc(n);
    }
  }

  return { packageName, entityFamilyRaw, maxRowsPerFamily };
}

function safeErrorMessage(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message).slice(0, 4000);
  }
  return String(err).slice(0, 4000);
}

async function fetchPackage(local: pg.Pool, packageName: string): Promise<LocalPackageRow | null> {
  const r = await local.query(
    `
    select id, package_name, source_snapshot_id, snapshot_version, region_code, entity_families, summary
      from system.system_remote_review_packages
     where package_name = $1 limit 1
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
    select id, entity_family, local_staging_id, external_id, match_status, auto_action,
           review_status, review_decision, confidence_score, canonical_name, class_code,
           normalized_data, source_refs, matched_core_id, matched_core_table, matched_core_data,
           f2_comparison, geometry_geojson, coalesce(payload, '{}'::jsonb) as payload
      from system.system_remote_review_package_items
     where package_id = $1
     order by entity_family asc, local_staging_id asc
    `,
    [pkgId]
  );
  return (res.rows as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    entity_family: String(row.entity_family),
    local_staging_id: String(row.local_staging_id),
    external_id: row.external_id == null ? null : String(row.external_id),
    match_status: row.match_status == null ? null : String(row.match_status),
    auto_action: row.auto_action == null ? null : String(row.auto_action),
    review_status: row.review_status == null ? null : String(row.review_status),
    review_decision: row.review_decision == null ? null : String(row.review_decision),
    confidence_score: row.confidence_score == null ? null : String(row.confidence_score),
    canonical_name: row.canonical_name == null ? null : String(row.canonical_name),
    class_code: row.class_code == null ? null : String(row.class_code),
    normalized_data: row.normalized_data,
    source_refs: row.source_refs,
    matched_core_id: row.matched_core_id == null ? null : String(row.matched_core_id),
    matched_core_table: row.matched_core_table == null ? null : String(row.matched_core_table),
    matched_core_data: row.matched_core_data,
    f2_comparison: row.f2_comparison,
    geometry_geojson: row.geometry_geojson,
    payload:
      row.payload !== null && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
  }));
}

function filterAndCapItems(params: {
  items: LocalPackageItemRow[];
  families: EntityFamilySlug[];
  maxPerFamily?: number;
}): { filtered: LocalPackageItemRow[]; perFamilyCounts: Record<EntityFamilySlug, number> } {
  const allowed = new Set(params.families);
  let list = params.items.filter((i) => isEntityFamilySlug(i.entity_family) && allowed.has(i.entity_family));

  const buckets = new Map<EntityFamilySlug, LocalPackageItemRow[]>();
  for (const f of params.families) buckets.set(f, []);
  for (const it of list) {
    buckets.get(it.entity_family as EntityFamilySlug)!.push(it);
  }

  const cap =
    typeof params.maxPerFamily === 'number' &&
    Number.isFinite(params.maxPerFamily) &&
    params.maxPerFamily > 0
      ? Math.trunc(params.maxPerFamily)
      : null;

  for (const f of params.families) {
    buckets.get(f)!.sort((a, b) => Number(a.local_staging_id) - Number(b.local_staging_id));
  }

  const perFamilyCounts = emptyPerFamilyCounts();
  const result: LocalPackageItemRow[] = [];

  for (const f of params.families) {
    const arr = buckets.get(f)!;
    const slice = cap == null ? arr : arr.slice(0, cap);
    perFamilyCounts[f] = slice.length;
    result.push(...slice);
  }

  result.sort((a, b) => {
    const af = a.entity_family as EntityFamilySlug;
    const bf = b.entity_family as EntityFamilySlug;
    if (af !== bf) {
      return REMOTE_REVIEW_ENTITY_FAMILIES.indexOf(af) - REMOTE_REVIEW_ENTITY_FAMILIES.indexOf(bf);
    }
    return Number(a.local_staging_id) - Number(b.local_staging_id);
  });

  return { filtered: result, perFamilyCounts };
}

function assertKnownPackageItemFamilies(items: LocalPackageItemRow[]): void {
  for (const it of items) {
    if (!isEntityFamilySlug(it.entity_family)) {
      throw new Error(`Missing Stage 12 upload config for entity_family=${it.entity_family}`);
    }
  }
}

function formatFamilyFilterLog(filter: EntityFamilySlug[] | null): string {
  return filter === null ? 'all' : filter.join(',');
}

async function getPackageItemStats(
  local: pg.Pool,
  packageName: string
): Promise<{ package_name: string; entity_family_count: number; item_total: number } | null> {
  const r = await local.query<{
    package_name: string;
    entity_family_count: string;
    item_total: string;
  }>(
    `
    select p.package_name,
           count(distinct i.entity_family)::int::text as entity_family_count,
           count(i.id)::int::text as item_total
      from system.system_remote_review_packages p
      join system.system_remote_review_package_items i on i.package_id = p.id
     where p.package_name = $1
     group by p.package_name
    `,
    [packageName]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    package_name: row.package_name,
    entity_family_count: Number(row.entity_family_count),
    item_total: Number(row.item_total),
  };
}

async function findBestPackageForSnapshot(
  local: pg.Pool,
  snapshotVersion: string
): Promise<{ package_name: string; entity_family_count: number; item_total: number } | null> {
  const r = await local.query<{
    package_name: string;
    entity_family_count: string;
    item_total: string;
  }>(
    `
    select p.package_name,
           count(distinct i.entity_family)::int::text as entity_family_count,
           count(i.id)::int::text as item_total
      from system.system_remote_review_packages p
      join system.system_remote_review_package_items i on i.package_id = p.id
     where p.snapshot_version = $1
     group by p.id, p.package_name
     order by count(i.id) desc, count(distinct i.entity_family) desc, p.created_at desc
     limit 1
    `,
    [snapshotVersion]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    package_name: row.package_name,
    entity_family_count: Number(row.entity_family_count),
    item_total: Number(row.item_total),
  };
}

/** Prefer the fullest package for the snapshot when the requested name is stale or partial. */
async function resolveUploadPackageName(
  local: pg.Pool,
  requestedName: string,
  snapshotVersion: string
): Promise<string> {
  const current = await getPackageItemStats(local, requestedName);
  const best = await findBestPackageForSnapshot(local, snapshotVersion);
  if (!current || !best || best.package_name === requestedName) {
    return requestedName;
  }
  if (best.item_total > current.item_total) {
    console.warn(
      `[stage_k] WARN auto-selected package "${best.package_name}" (${best.item_total} items, ${best.entity_family_count} families) ` +
        `instead of "${requestedName}" (${current.item_total} items, ${current.entity_family_count} families) for snapshot ${snapshotVersion}`
    );
    return best.package_name;
  }
  return requestedName;
}

function countItemsByFamily(items: LocalPackageItemRow[]): Record<EntityFamilySlug, number> {
  const counts = emptyPerFamilyCounts();
  for (const it of items) {
    if (!isEntityFamilySlug(it.entity_family)) continue;
    counts[it.entity_family] += 1;
  }
  return counts;
}

function logPackageItemCounts(
  label: string,
  counts: Record<EntityFamilySlug, number>
): void {
  const lines = REMOTE_REVIEW_ENTITY_FAMILIES.map(
    (f) => `  ${f}: ${counts[f] ?? 0}`
  );
  const total = REMOTE_REVIEW_ENTITY_FAMILIES.reduce((n, f) => n + (counts[f] ?? 0), 0);
  console.log(`[stage_k] ${label} (${total} items)`);
  for (const line of lines) console.log(line);
}

function printUploadSummary(params: {
  packageName: string;
  remoteBatchId: bigint;
  uploadFamilies: EntityFamilySlug[];
  perFamilyCounts: Record<EntityFamilySlug, number>;
  agg: ReturnType<typeof emptyPerFamilyUploadStats>;
  success: boolean;
}): void {
  console.log('\n[stage_k] upload summary');
  console.log(`  package_name: ${params.packageName}`);
  console.log(`  remote_review_batch_id: ${params.remoteBatchId.toString()}`);
  console.log(`  entity_families: ${params.uploadFamilies.join(', ')}`);
  console.log(`  result: ${params.success ? 'SUCCESS' : 'FAILURE'}`);
  console.log('  per_entity:');
  for (const f of params.uploadFamilies) {
    const a = params.agg[f];
    console.log(
      `    ${f}: selected=${a.selected} inserted=${a.inserted} updated=${a.updated_pending} preserved=${a.preserved_remote} failed=${a.failed} (package_items=${params.perFamilyCounts[f] ?? 0})`
    );
  }
  const totals = params.uploadFamilies.reduce(
    (acc, f) => {
      const a = params.agg[f];
      acc.selected += a.selected;
      acc.inserted += a.inserted;
      acc.updated += a.updated_pending;
      acc.preserved += a.preserved_remote;
      acc.failed += a.failed;
      return acc;
    },
    { selected: 0, inserted: 0, updated: 0, preserved: 0, failed: 0 }
  );
  console.log(
    `  totals: selected=${totals.selected} inserted=${totals.inserted} updated=${totals.updated} preserved=${totals.preserved} failed=${totals.failed}`
  );
}

async function upsertReviewBatch(
  remote: pg.Pool,
  pkg: LocalPackageRow,
  uploadFamilies: EntityFamilySlug[]
): Promise<bigint> {
  if (uploadFamilies.length === 0) {
    throw new Error('upsertReviewBatch: uploadFamilies must not be empty');
  }
  const entityFamiliesRaw = uploadFamilies;
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
        batch_name, source_snapshot_version, source_snapshot_id_local, region_code,
        entity_families, total_candidate_count, uploaded_candidate_count,
        preserved_reviewed_count, skipped_count, summary, status, upload_mode
      ) values ($1,$2,$3::bigint,$4,$5::text[],$6::int,0,0,0,$7::jsonb,$8::text,$9::text)
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
          pkg.summary != null
            ? { ...pkg.summary, pipeline_touch: 'stage_k_upload_created' }
            : { pipeline_touch: 'stage_k_upload_created' }
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
  filteredPackageItems: number,
  entityFamilies: EntityFamilySlug[]
): Promise<void> {
  const countUnion = buildBatchCountUnionSql();
  const preservedUnion = buildBatchPreservedUnionSql();
  await remote.query(
    `
    with cand as (${countUnion}),
    prv as (${preservedUnion})
    update import_review.review_batches b
       set entity_families = $4::text[],
           total_candidate_count = $2::int,
           uploaded_candidate_count = (select coalesce(sum(c), 0) from cand),
           preserved_reviewed_count = (select coalesce(sum(p), 0) from prv),
           skipped_count = (select coalesce(sum(p), 0) from prv),
           summary = coalesce(summary, '{}'::jsonb) || $3::jsonb,
           status = 'reviewing'::text,
           updated_at = now()
     where b.id = $1::bigint
    `,
    [batchId.toString(), filteredPackageItems, JSON.stringify(summaryPatch), entityFamilies]
  );
}

async function bumpLocalPackageSuccess(
  local: pg.Pool,
  pkg: LocalPackageRow,
  remoteBatchId: bigint,
  uploadFamilies: EntityFamilySlug[],
  summaryJson: Record<string, unknown>
): Promise<void> {
  await local.query(
    `
    update system.system_remote_review_packages
       set uploaded_at = now(), remote_review_batch_id = $2::bigint,
           remote_upload_status = 'completed'::text,
           entity_families = $7::text[],
           note = concat_ws(E'\n', nullif(trim(coalesce(note, '')), ''),
                 format('stage_k_upload %s remote_batch=%s snapshot=%s', $3::text, $4::text, $5::text)),
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
      uploadFamilies,
    ]
  );
}

async function bumpLocalPackageFailure(local: pg.Pool, pkgId: string, err: unknown): Promise<void> {
  await local.query(
    `
    update system.system_remote_review_packages
       set remote_upload_status = 'failed'::text,
           note = concat_ws(E'\n', nullif(trim(coalesce(note, '')), ''),
                 format(E'stage_k_upload failed %s: %s', $2::text, $3::text))
     where id = $1::bigint
    `,
    [pkgId, new Date().toISOString(), safeErrorMessage(err).slice(0, 2048)]
  );
}

async function stampLocalItemsRowwiseChunked(
  local: pg.Pool,
  entries: Array<{ package_id: string; family: EntityFamilySlug; lsid: string; remoteId: bigint }>
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
             set remote_candidate_id = $3::bigint, upload_status = 'completed'::text
           where package_id = $1::bigint and entity_family = $4::text and local_staging_id = $2::bigint
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
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
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
  const nums = localStagingIds.map((s) => {
    const n = Number(s);
    if (!Number.isSafeInteger(n)) throw new Error(`invalid local_staging_id: ${s}`);
    return n;
  });
  await local.query(
    `
    update system.system_remote_review_package_items
       set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
             'upload_error', jsonb_strip_nulls(jsonb_build_object(
               'phase', $4::text, 'message', left($5::text, 4000),
               'at', to_char(timezone('UTC', clock_timestamp()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             ))),
           upload_status = 'failed'::text
     where package_id = $1::bigint and entity_family = $2::text and local_staging_id = any ($3::bigint[])
    `,
    [pkgId, entityFamily, nums, phase, safeErrorMessage(err)]
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function writePipelineLog(payload: Record<string, unknown>): string {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `stage-k-upload-${ts}.json`);
  fs.writeFileSync(logPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return logPath;
}

async function main(): Promise<number> {
  const cli = parseCliArgs();
  const enabled = parseBoolEnv(process.env.REMOTE_REVIEW_UPLOAD_ENABLED);
  if (!enabled) {
    console.log('REMOTE_REVIEW_UPLOAD_ENABLED is off; exiting (stage K noop).');
    return 0;
  }

  const localUrl = process.env.LOCAL_DATABASE_URL?.trim();
  const remoteUrlRaw = process.env.SUPABASE_DATABASE_URL?.trim();
  const pkgName = cli.packageName?.trim() || process.env.REMOTE_REVIEW_PACKAGE_NAME?.trim();

  if (!localUrl || !remoteUrlRaw) {
    console.error('LOCAL_DATABASE_URL and SUPABASE_DATABASE_URL are required.');
    return 1;
  }
  if (!pkgName) {
    console.error(
      'Package name is required: set REMOTE_REVIEW_PACKAGE_NAME or pass --package-name=remote_review_pkg_...'
    );
    return 1;
  }

  const entityFamilyRaw =
    cli.entityFamilyRaw ?? process.env.REMOTE_REVIEW_ENTITY_FAMILY?.trim();
  let familyFilter: EntityFamilySlug[] | null;
  try {
    familyFilter = parseEntityFamilyFilter(entityFamilyRaw);
  } catch (e) {
    console.error(safeErrorMessage(e));
    return 1;
  }

  const maxRowsEnv = process.env.REMOTE_REVIEW_MAX_ROWS_PER_FAMILY?.trim();
  const maxPerFamily =
    cli.maxRowsPerFamily ??
    (maxRowsEnv && Number.isFinite(Number(maxRowsEnv)) ? Math.trunc(Number(maxRowsEnv)) : undefined);

  const supabaseSslRejectUnauthorized =
    process.env.SUPABASE_DB_SSL_VERIFY_SERVER_CERT === 'true';
  console.log(`[stage_k] ssl.rejectUnauthorized=${supabaseSslRejectUnauthorized}`);

  const localPool = new pg.Pool({ connectionString: localUrl });
  const remotePool = new pg.Pool({
    connectionString: sanitizeSupabaseDatabaseUrl(remoteUrlRaw),
    max: 4,
    connectionTimeoutMillis: 30_000,
    ssl: { rejectUnauthorized: supabaseSslRejectUnauthorized },
  });

  let pkgSummary: LocalPackageRow | null = null;
  const startedAt = new Date().toISOString();

  try {
    pkgSummary = await fetchPackage(localPool, pkgName);
    if (!pkgSummary) {
      console.error(`Local package not found for package_name=${pkgName}`);
      return 1;
    }

    const resolvedPkgName = await resolveUploadPackageName(
      localPool,
      pkgName,
      pkgSummary.snapshot_version
    );
    if (resolvedPkgName !== pkgName) {
      pkgSummary = await fetchPackage(localPool, resolvedPkgName);
      if (!pkgSummary) {
        console.error(`Auto-selected package not found: ${resolvedPkgName}`);
        return 1;
      }
    }
    const effectivePkgName = pkgSummary.package_name;

    const itemsAll = await fetchItems(localPool, pkgSummary.id);
    assertKnownPackageItemFamilies(itemsAll);
    const packageItemCounts = countItemsByFamily(itemsAll);
    const familiesInPackage = familiesFromPackageItemCounts(packageItemCounts);
    const metaFamilies = (pkgSummary.entity_families ?? []).filter(isEntityFamilySlug);

    console.log(`[stage_k] package_name=${effectivePkgName}`);
    console.log(`[stage_k] package metadata entity_families=${metaFamilies.length > 0 ? metaFamilies.join(',') : '(none)'}`);
    console.log(`[stage_k] package item entity_families=${familiesInPackage.join(',')}`);
    console.log(`[stage_k] requested family filter=${formatFamilyFilterLog(familyFilter)}`);

    logPackageItemCounts('local package_items by entity_family', packageItemCounts);

    if (familiesInPackage.length === 0) {
      console.error(`Package ${effectivePkgName} has zero package_items rows — nothing to upload.`);
      return 1;
    }

    const metaSet = new Set(metaFamilies);
    const itemSet = new Set(familiesInPackage);
    const onlyInItems = familiesInPackage.filter((f) => !metaSet.has(f));
    const onlyInMeta = metaFamilies.filter((f) => !itemSet.has(f));
    if (onlyInItems.length > 0) {
      console.warn(
        `[stage_k] WARN stale package metadata: package_items include families not on package row: ${onlyInItems.join(', ')} (metadata will not limit upload)`
      );
    }
    if (onlyInMeta.length > 0) {
      console.warn(
        `[stage_k] WARN stale package metadata: package row lists families with zero package_items: ${onlyInMeta.join(', ')}`
      );
    }

    for (const f of familiesInPackage) {
      assertUploadConfigForFamily(f);
    }

    const uploadFamilies = resolveEntityFamiliesForUpload({
      itemFamilies: familiesInPackage,
      filter: familyFilter,
    });

    console.log(`[stage_k] final upload families=${uploadFamilies.join(',')}`);

    if (uploadFamilies.length === 0) {
      console.error('No entity families matched filter — nothing uploaded.');
      return 1;
    }

    for (const f of uploadFamilies) {
      if ((packageItemCounts[f] ?? 0) === 0) {
        throw new Error(`Missing Stage 12 upload config for entity_family=${f} (zero package_items)`);
      }
      assertUploadConfigForFamily(f);
    }

    console.log(`[stage_k] max_per_family=${maxPerFamily ?? 'unlimited'}`);

    const { filtered, perFamilyCounts } = filterAndCapItems({
      items: itemsAll,
      families: uploadFamilies,
      maxPerFamily,
    });

    if (filtered.length === 0) {
      console.error('No candidate rows matched filters — nothing uploaded.');
      return 1;
    }

    logPackageItemCounts('selected for upload by entity_family', perFamilyCounts);

    const batchId = await upsertReviewBatch(remotePool, pkgSummary, uploadFamilies);
    const progState = { done: 0, total: filtered.length };
    const agg = emptyPerFamilyUploadStats();
    const stampEntries: Array<{
      package_id: string;
      family: EntityFamilySlug;
      lsid: string;
      remoteId: bigint;
    }> = [];

    let insertedRun = 0;
    let updatedRun = 0;
    let preservedRun = 0;
    let chunkCommitsOk = 0;
    let chunkFailures = 0;

    for (const family of uploadFamilies) {
      const famItems = filtered.filter((i) => i.entity_family === family);
      if (famItems.length === 0) {
        throw new Error(
          `Missing Stage 12 upload config for entity_family=${family} (selected for upload but zero rows after filter)`
        );
      }

      console.log(`[family ${family}] uploading ${famItems.length} rows (chunks of ${CHUNK_SIZE})`);
      agg[family].selected = famItems.length;
      const remoteClient = await remotePool.connect();

      try {
        for (const slice of chunk(famItems, CHUNK_SIZE)) {
          await remoteClient.query('BEGIN');
          let outcome: FlushOutcome;
          try {
            outcome = await flushEntityFamily(
              remoteClient,
              family,
              batchId,
              pkgSummary,
              slice,
              progState
            );
            insertedRun += outcome.stats.inserted_total;
            updatedRun += outcome.stats.updated_pending_total;
            preservedRun += outcome.stats.preserved_remote_total;
            agg[family].inserted += outcome.stats.per_family_uploaded[family].inserted;
            agg[family].updated_pending += outcome.stats.per_family_uploaded[family].updated_pending;
            agg[family].preserved_remote += outcome.stats.per_family_uploaded[family].preserved_remote;
            agg[family].skipped += outcome.stats.per_family_uploaded[family].skipped;

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

            const unresolved = slice
              .filter((r) => !outcome.remoteIdsByLsid.has(String(r.local_staging_id)))
              .map((r) => r.local_staging_id);
            if (unresolved.length > 0) {
              await mergePayloadUploadFailure(
                localPool,
                pkgSummary.id,
                family,
                unresolved,
                'remote_id_resolve',
                'committed_chunk_missing_remote_candidate_id_after_flush'
              );
            }
          } catch (e) {
            chunkFailures++;
            agg[family].failed += slice.length;
            await remoteClient.query('ROLLBACK');
            await mergePayloadUploadFailure(
              localPool,
              pkgSummary.id,
              family,
              slice.map((r) => r.local_staging_id),
              'chunk_flush',
              e
            );
            console.error(`[family ${family}] chunk failed: ${safeErrorMessage(e)}`);
            throw e;
          }

          const pct = progState.total
            ? ((progState.done / progState.total) * 100).toFixed(1)
            : '100.0';
          console.log(
            `[family ${family}] progress ${progState.done}/${progState.total} (${pct}%): inserted=${outcome.stats.inserted_total} updated=${outcome.stats.updated_pending_total} preserved=${outcome.stats.preserved_remote_total}`
          );
        }
      } finally {
        remoteClient.release();
      }

      console.log(
        `[family ${family}] done selected=${agg[family].selected} inserted=${agg[family].inserted} updated=${agg[family].updated_pending} preserved=${agg[family].preserved_remote} failed=${agg[family].failed} (planned ${perFamilyCounts[family]})`
      );
    }

    const summaryPatch = {
      stage_k_upload: {
        started_at_utc: startedAt,
        finished_at_utc: new Date().toISOString(),
        package_name: pkgSummary.package_name,
        entity_families: uploadFamilies,
        per_entity_uploaded: Object.fromEntries(
          uploadFamilies.map((f) => [
            f,
            {
              selected: agg[f].selected,
              inserted: agg[f].inserted,
              updated_pending: agg[f].updated_pending,
              preserved_remote: agg[f].preserved_remote,
              failed: agg[f].failed,
            },
          ])
        ),
        filtered_items_total: progState.total,
        per_family_filtered: perFamilyCounts,
        per_family_aggregate: agg,
        inserted_estimate: insertedRun,
        pending_refreshes_estimate: updatedRun,
        preserved_remote_estimate: preservedRun,
        stamped_local_remote_candidate_id_count: stampEntries.length,
        chunk_commits_ok: chunkCommitsOk,
        chunk_failures: chunkFailures,
      },
    };

    await syncBatchTotals(
      remotePool,
      batchId,
      summaryPatch,
      progState.total,
      uploadFamilies
    );
    await bumpLocalPackageSuccess(localPool, pkgSummary, batchId, uploadFamilies, summaryPatch);
    await stampLocalItemsRowwiseChunked(localPool, stampEntries);

    const logPath = writePipelineLog({
      ...summaryPatch,
      remote_review_batch_id: batchId.toString(),
    });
    console.log(`[stage_k] log written ${logPath}`);
    printUploadSummary({
      packageName: pkgSummary.package_name,
      remoteBatchId: batchId,
      uploadFamilies,
      perFamilyCounts,
      agg,
      success: chunkFailures === 0,
    });
    return chunkFailures === 0 ? 0 : 1;
  } catch (err) {
    console.error('[stage_k] failed', safeErrorMessage(err));
    if (pkgSummary) {
      try {
        await bumpLocalPackageFailure(localPool, pkgSummary.id, err);
      } catch (e2) {
        console.error('[stage_k] could not annotate local failure', safeErrorMessage(e2));
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
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(safeErrorMessage(e));
    process.exit(1);
  });
