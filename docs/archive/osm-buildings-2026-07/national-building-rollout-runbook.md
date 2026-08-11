# National building rollout runbook

Status: **NO-GO — planning and evidence only. Do not start an import.**

This runbook promotes the Kyauktan regional flow to a controlled 15-region
rollout. It does not authorize Yangon or national writes. Every region remains
an explicit operator-approved transaction.

## Current blockers

1. Migrations 149 and 150 are not applied to production.
2. The Supabase dashboard backup/PITR status could not be authenticated from
   this session. A successful managed backup and its recovery point must be
   recorded before GO.
3. The planning extracts account for 5,440,508 of 5,578,343 national OSM
   building identities. The 137,835 unassigned identities (2.47%) must be
   deterministically assigned to exactly one region before any apply.
4. Allocated production disk is not visible through SQL. The operator must
   provision and record at least 30.589 GB of free database-disk headroom.
5. The region-aware tile view plan is acceptable for the pilot but must be
   repeated on a national-scale restored clone after `ANALYZE`.

## Evidence snapshot

Captured 2026-07-29:

- Production: PostgreSQL 17.6, 5,642,964,115 database bytes and
  1,073,742,194 WAL-directory bytes.
- Production buildings: 1,133 rows, 0 invalid geometries, 170 names, 51 links.
- Building relation: 2,588,672 table bytes, 3,170,304 index bytes,
  5,816,320 total bytes.
- Kyauktan first apply: 1,402 staged, 449 inserted, 953 updated, 581.359 ms,
  4,360,848 WAL bytes.
- Kyauktan transaction-local relations: 5,595,136 bytes for 1,402 rows.
- Kyauktan COPY CSV: 258,403 bytes for 1,402 rows.
- Kyauktan GeoJSON: 607,985 bytes; PMTiles approximately 245 KiB.

### Measured unit costs

| Resource | Measured bytes/building | Capacity use |
|---|---:|---|
| Persistent table growth | 72.98 | Core table |
| Persistent index growth | 620.33 | Core indexes |
| Persistent total growth | 693.31 | Table + indexes |
| WAL, first apply | 3,110.45 per staged row | Database disk/transient |
| Transaction-local relations | 3,990.83 per staged row | Database temp/transient |
| COPY CSV | 184.31 | Runner filesystem |
| GeoJSON | 433.66 | Tile workspace |
| PMTiles | 178.94 | Tile workspace |

The persistent measurement uses the conservative post-migration-baseline to
final-pilot delta. It includes the dry-run page allocation observed before the
committed pilot.

### National capacity

National source count: **5,578,343** ways + relations.

| Projection | Decimal GB |
|---|---:|
| Persistent national growth | 3.868 |
| WAL generated across all regional applies | 17.351 |
| Temp-relation bytes written across all regions | 22.262 |
| National CSV artifacts | 1.028 |
| National GeoJSON artifacts | 2.419 |
| National PMTiles at pilot density | 0.998 |

The current largest planning region is Ayeyarwady at 1,609,125 identities:

- persistent: 1.116 GB
- WAL: 5.005 GB
- transaction-local relations: 6.422 GB
- regional transaction peak: 12.542 GB
- peak incremental database footprint with prior regions retained: 15.294 GB
- mandatory 2x free headroom: **30.589 GB**

Mathematical allocated-disk floor is current database + WAL + required free
headroom, approximately 37.31 GB before system overhead. Provision **at least
48 GB**, and verify free disk is at least 30.589 GB immediately before GO.
64 GB is preferred if the first two regions exceed measured unit costs.

Expected steady-state database size is approximately 9.51 GB. Budget 12 GB for
steady state after page/index rounding and normal bloat.

Hard stop and recalculate if any completed region exceeds:

- 866.64 persistent bytes/new building (125% of pilot)
- 3,888.06 WAL bytes/staged building
- 4,988.53 temp bytes/staged building
- 125% of the frozen regional CSV, GeoJSON or PMTiles projection

## Backup and restore gate

A scoped production logical backup and restore rehearsal passed:

- backup:
  `/tmp/coremap-building-backup-20260729-pg17.sql`
- backup bytes: 1,324,281
- SHA-256:
  `734a9bcc723430ac8cd73be30129165e5cd96b43585456ac2f69d48ccc63cc70`
- isolated restore database:
  `coremap_building_restore_20260729_019fac81`
- restored buildings/names/links: 1,133 / 170 / 51
- restored invalid geometry and orphan links: 0 / 0
- production and restored content checksum:
  `75a9ea822f5465815602c4e0774c4821`

The production server is PostgreSQL 17 and the local restore server is older.
The rehearsal used PostgreSQL 17 `pg_dump`; the single unsupported
`SET transaction_timeout = 0` session line was removed from the plain restore
script. Production recovery must use a PostgreSQL 17-compatible target/client.

Before GO, record:

1. Supabase managed backup type: daily physical backup or PITR.
2. Latest successful backup timestamp, less than 24 hours old.
3. Recovery point immediately before migration 149.
4. Recovery point immediately before each regional apply.
5. Retention window and the named operator authorized to restore.
6. A full-project restore rehearsal on a Supabase branch or isolated project.

The scoped rehearsal does not replace the full managed-backup gate. Supabase
documents that physical/PITR projects may not expose a downloadable logical
backup; use `supabase db dump` or `pg_dump` when a logical artifact is needed.

## Advisor gate

Run immediately before migration and after every schema/index change.

Current advisor snapshot:

| Advisor | Total | Breakdown |
|---|---:|---|
| Security | 171 | 93 RLS/no-policy info, 76 mutable search-path warnings, 2 extensions in public |
| Performance | 641 | 83 unindexed FKs, 3 no-PK, 547 unused-index info, 7 duplicate-index warnings, 1 Auth connection info |

Building-related security notices are private-schema tables with RLS enabled
and no policies. Core building tables have grants only to `postgres`; `anon`
and `authenticated` have no table privileges.

Advisor INFO alone never authorizes an index drop.

## Index decision

**Remove zero building indexes before the first national cycle.**

No index is proven unused by all three required evidence sources:

1. repository search,
2. live query evidence, and
3. pilot/national-scale tests.

Evidence for retained indexes:

| Query | Plan evidence |
|---|---|
| Bbox/tile lookup | Geometry GiST + active partial bitmap scan, 32.225 ms |
| Point-in-building reverse lookup | Geometry GiST, 1.435 ms |
| Admin-area filter | `admin_area_id` btree, 3.142 ms |
| Public building lookup | `public_id` unique index, 3.311 ms |
| Building-name lookup | `building_id` index, 0.214 ms |
| OSM conflict key | New partial unique identity index, 3.553 ms pilot |
| Reverse POI link | 0.125 ms sequential scan on only 51 rows; live index has six scans |

The reusable read-only EXPLAIN pack also passed on the final pilot:

- bounded bbox: geometry GiST, 56 rows, 3.016 ms
- point-in-building: geometry GiST, 1.195 ms
- public ID: unique index, 0.088 ms
- typed source identity: partial unique index, 0.222 ms
- regional tile view: 1,402 rows, 38.145 ms

The pilot planner selected sequential scans for the admin, name and reverse-link
samples because those relations contain only 1,582 / 177 / 51 rows. Production
evidence has already exercised their indexes. Repeat the same pack after every
regional `ANALYZE`; a national-scale sequential scan or temp spill is a stop.

The JSON GIN indexes report zero scans, but legacy loaders still inspect
`source_refs`, and API detail/class fallbacks read `normalized_data`. They stay
through the first national cycle. Reconsider them only after the cycle, a
statistics window that includes real traffic, repository regression tests and
a restored-clone plan comparison.

After the first two regions, run `ANALYZE` on the three building tables and
repeat plans. If region export does not use a selective geometry/region path,
prepare and pilot a separate additive partial `region_code` index migration.
Do not improvise an index during a regional apply.

## Region order

Planning order is smallest to largest:

| Order | Region | Planning identities |
|---:|---|---:|
| 1 | Kayah | 992 |
| 2 | Kachin | 27,662 |
| 3 | Kayin | 32,847 |
| 4 | Chin | 65,559 |
| 5 | Rakhine | 65,743 |
| 6 | Tanintharyi | 87,394 |
| 7 | Yangon | 151,577 |
| 8 | Naypyitaw | 193,543 |
| 9 | Magway | 194,924 |
| 10 | Mon | 224,134 |
| 11 | Bago | 261,963 |
| 12 | Sagaing | 289,502 |
| 13 | Shan | 748,850 |
| 14 | Mandalay | 1,486,693 |
| 15 | Ayeyarwady | 1,609,125 |

These are measured `building=*` way/relation counts from one-pass smart
extracts of `myanmar-260721.osm.pbf`. They are planning numbers, not frozen
import counts. Re-sort if the deterministic final partition changes the order.

The authoritative ledger must be stored with the frozen regional direct-Core
CSV artifacts outside the retired loader directory.
Do not change a `planning_only` row to `ready` until every blank checksum/count
field is populated.

## Freeze the national source

1. Freeze one PBF, SHA-256, source registry row and national snapshot.
2. Assign each OSM `way`/`relation` building identity to exactly one region by
   point-on-surface against the canonical non-overlapping region boundaries.
3. Fail if an identity matches zero or multiple regions.
4. Produce one sorted CSV per region using the regional importer contract.
5. Record for every CSV:
   - SHA-256
   - exact row count
   - distinct identity count
   - way/relation counts
   - `staged_identity_xor`
   - `staged_content_xor`
   - real-name count
   - file bytes
6. Require the union of all regional identity sets to equal the national
   identity set:
   - duplicates: 0
   - unassigned: 0
   - regional sum: 5,578,343 for this frozen PBF

Any regenerated CSV is a new source artifact: update its checksum and rerun all
dry-run gates. Never edit an approved CSV in place.

## Per-region pre-import gate

Run with `set -euo pipefail`. Capture all output in an immutable log.

1. Confirm no other migration/import transaction is active.
2. Confirm the managed backup/recovery point.
3. Confirm free database disk remains above the larger of:
   - 2x the measured projected peak for the next region, or
   - the recorded 30.589 GB national headroom floor.
4. Run:
   - `verify_national_building_rollout_readiness.sql`
   - the regional importer in dry-run mode
   - `explain_national_building_queries.sql` for representative
     `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, VERBOSE)` queries
5. Record pre-import:
   - global and regional building counts
   - global ID/public-ID checksum
   - regional source-identity checksum
   - global name count/checksum
   - global POI-link count/checksum
   - table/index/database/WAL bytes
   - current PMTiles version and SHA-256
6. Compute exact expected post values:
   - `post_total = pre_total + planned_new`
   - `post_region = expected_input_rows`
   - `post_names = pre_names + planned_name_inserts`
   - `post_links = pre_links`
7. Require dry-run:
   - invalid rows: 0
   - duplicate stage/global identities: 0
   - inactive/deleted conflicts: 0
   - verification failures: 0
   - input count/checksums exactly equal the frozen manifest
   - missing-source rows are reported before upsert

Row-count tolerance against the frozen manifest is **zero**. Compare with the
previous OSM snapshot separately; a change greater than 5% is a manual-review
stop, even if the current frozen manifest is internally consistent.

## Regional apply

1. Use only `run_regional_buildings_import.sh`.
2. Use `--target production --apply` with the exact confirmation phrase.
3. One region, one transaction. Never concatenate regional CSVs.
4. COPY to transaction-local staging.
5. Validate before upsert.
6. Report source deletions before upsert.
7. Set-based upsert on the typed source identity.
8. Verify before commit.
9. Commit only if every SQL verification count is zero.
10. Do not run another region until post-import and PMTiles gates pass.

During the first national cycle, missing source buildings are **report-only**.
No loader, repair script, dashboard action or cleanup job may deactivate,
soft-delete or delete them.

## Post-import database gate

Populate the manifest from the committed summary, then run
`verify_national_building_region_post.sql`.

Automatic stop conditions:

- any invalid/empty/wrong-type/wrong-SRID geometry
- any duplicate source identity
- any orphan place/building relationship
- total, region, name, link or identity checksum mismatch
- any new ordinary footprint with non-empty legacy JSON
- unnamed ordinary footprint exposed to search
- tile-view count mismatch
- observed bytes/building above the 125% thresholds
- any SQL or advisor verification failure
- database free space below the headroom gate

Run `ANALYZE core.core_map_buildings`,
`ANALYZE core.core_map_building_names` and
`ANALYZE core.core_place_buildings` after each committed region before final
plans. Schedule this outside the apply transaction.

An identical regional dry-run after commit must report:

- planned new: 0
- planned updates: 0
- inserted/updated/name rows: 0
- duplicate identities: 0

## PMTiles gate and rollback

1. Export only the committed `region_code`.
2. Write a new versioned GeoJSON and PMTiles archive. Never overwrite the
   currently published archive.
3. Validate:
   - GeoJSON feature count equals active tile-view region count
   - only Polygon/MultiPolygon
   - PMTiles v3 opens and reports expected bounds/zoom/layer
   - source GeoJSON and PMTiles SHA-256 are recorded
   - representative urban/rural/border tiles decode
4. Upload the versioned archive.
5. Preview it before changing `current.json` or the tile registry pointer.
6. Publish only after preview passes.
7. Keep the previous archive and pointer.

PMTiles rollback is a pointer rollback to the previous version; it never
changes building IDs or database relationships. If tile generation fails, do
not publish and do not advance to the next region.

## Failure recovery

### Before database commit

The regional transaction rolls back. Preserve the failed CSV, checksum and log.
Fix the source/export process, produce a new checksummed artifact, rerun dry-run
and obtain a new explicit apply approval.

### After commit, before PMTiles publish

Do not rerun the database apply if post-import SQL passed. Repair/regenerate the
versioned PMTiles archive and repeat tile QA. The old tile pointer remains live.

### Post-commit database verification failure

Stop all regions. Do not write ad-hoc DELETE/UPDATE repair SQL.

Use either:

1. the recorded Supabase recovery point, if whole-project rollback is approved
   and no unrelated writes would be lost, or
2. the pre-region external row backup plus its exact identity manifest:
   delete only identities proven new in the failed transaction, restore only
   rows proven pre-existing, then restore their name/link rows in one
   maintenance transaction.

Run the global readiness SQL and application smoke tests after recovery. A
recovered region starts again from dry-run with the same frozen source.

### Source deletion

Keep the row active. Store the missing-source report with the region artifacts.
After all 15 regions and a review window, design a separately authorized
deactivation policy. The first national cycle never auto-deletes.

## GO criteria

GO for **one region only** when all are true:

- migrations 149/150 applied and verified
- managed backup/PITR and full restore rehearsal recorded
- allocated disk at least 48 GB and free disk at least 30.589 GB
- exact regional union has zero duplicates and zero unassigned identities
- frozen manifest row is complete and `ready`
- advisors reviewed with no unresolved building-critical finding
- dry-run and representative plans pass
- pre-import counts/checksums captured
- previous region, if any, passed database, rerun and PMTiles gates
- named production operator approves the exact region/CSV/snapshot

## NO-GO criteria

Any missing GO item, warning promoted by an advisor, source/checksum change,
active competing migration, disk pressure, unexpected row variance, timeout,
invalid geometry, duplicate, orphan, verification failure or PMTiles failure is
NO-GO. Stop without advancing the manifest.
