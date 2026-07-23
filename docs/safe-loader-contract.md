# Safe loader contract (CoreMap)

Shared rules for production-safe **import_work → core** family loaders.

This is a **contract + small runner helper**, not a generic loader framework.  
Each family keeps its own typed work table, field/geometry mapping, allowlists, protection, and verification SQL.

**Database target rules** (canonical env names, dry-run default, confirmation):  
[`docs/database-target-safety.md`](database-target-safety.md)

Evidence / context:

- Production Baseline v1 — `tools/data-repair/current-production/PRODUCTION_BASELINE_V1.md` (project `locghyuranqaqsnbxflc`)
- Yangon pilot — `tools/data-pipeline/local-osm/reports/yangon_production_pilot_2026-07-23.md`
- Places pilot schema — migration `136_import_work_places_pilot.sql`
- Places loader — `tools/data-pipeline/import-work/places_safe_loader*.sql`

---

## Shared contract (only these)

| # | Rule | Meaning |
|---|---|---|
| 1 | Explicit target | `--target local` or `--target production` required |
| 2 | Import batch identity | `import_work.import_batches.batch_code` (+ numeric `id`) |
| 3 | Source snapshot identity | `source_snapshot_id` **and** `source_snapshot_version` required |
| 4 | Dry-run mode | Default; rolls back durable core writes |
| 5 | Apply confirmation | Production apply needs exact confirmation string |
| 6 | Expected row counts | Batch `expected_row_count` / `loaded_row_count` must match work rows |
| 7 | Metrics | Insert / update / skip / fail (+ publish summary where family writes one) |
| 8 | One family transaction | One entity family per loader run / transaction body |
| 9 | Idempotent rerun | Identical safe rows skip; no duplicate core growth |
| 10 | Cleanup | After successful apply, delete completed `import_work` family rows (batch → `cleaned`) |

---

## Family responsibilities (not shared)

Each family loader owns:

- typed work table (e.g. `import_work.place_rows`)
- target core table (e.g. `core.core_places`)
- field mapping
- geometry mapping
- reference mapping
- name handling
- safe-update allowlist
- manual protection
- verified protection
- verification SQL / fixture tests

---

## Target selection

```bash
--target local         # uses LOCAL_DATABASE_URL only
--target production    # uses SUPABASE_WRITE_DATABASE_URL, else legacy SUPABASE_DATABASE_URL
```

`DATABASE_URL` is never a production write target for these runners.

Rules:

- Do **not** pick a URL only because some env var exists.
- Print project / database host identity **before** any loader SQL.
- Production dry-run is allowed.
- Production apply requires **all** of:
  - `--target production`
  - `--apply`
  - `--confirmation "APPLY <family> <batch_id>"`  
    Example: `APPLY places 11`
- Refuse production when project identity cannot be verified  
  (URL must contain `SAFE_LOADER_PRODUCTION_PROJECT_REF`, default `locghyuranqaqsnbxflc`).
- Refuse when `LOCAL_DATABASE_URL` and production URL fingerprints are identical.
- Refuse when batch is missing, or snapshot id/version is missing.

---

## Helper (shared, small)

```text
tools/data-pipeline/import-work/lib/safe_loader_contract.sh
```

Family runners source this file and call `safe_loader_preflight`.

Places runner (updated):

```text
tools/data-pipeline/import-work/run_places_safe_loader.sh
```

Also family runners (same contract): buildings, landuse, water_lines, water_polygons, routing_barriers, roads.
### Places examples

```bash
# Local dry-run
./run_places_safe_loader.sh \
  --target local \
  --batch-code places_contract_local_dryrun \
  --dry-run

# Production dry-run (allowed)
./run_places_safe_loader.sh \
  --target production \
  --batch-code places_yangon_essential_safe_2026_07_23 \
  --dry-run \
  --sample-limit 5

# Production apply (dangerous — confirmation required)
./run_places_safe_loader.sh \
  --target production \
  --batch-code places_yangon_essential_safe_2026_07_23 \
  --apply \
  --confirmation "APPLY places 11"
```

After a successful apply, the runner calls `cleanup_import_work_batches.sql` for that `batch_code` unless `--skip-cleanup`.

---

## Metrics every run should surface

- `batch_id`, `batch_code`, `entity_family`
- `source_snapshot_id`, `source_snapshot_version`
- `expected_row_count` / `loaded_row_count`
- `inserted`, `updated`, `skipped`, `failed`
- dry-run vs apply outcome (rollback vs commit)

Places already emits `places_loader [N%]` NOTICE progress and a `system.system_publish_batches` summary row inside the SQL body.

---

## Tests

```bash
./tools/data-pipeline/import-work/tests/safe_loader_contract_tests.sh
```

Covers:

- local dry-run **preflight** (`--target local --preflight-only`) — batch/snapshot identity on local `import_work`
- production dry-run (sample only; **no apply**)
- missing `--target`
- wrong / missing production confirmation
- local/production URL ambiguity
- unverifiable production URL
- identical-batch rerun + simulated failure rollback (`places_safe_loader_tests.sql`, production txn **ROLLBACK**)

Note: local `geo_core.core.core_places` in this workspace is an older shape (no `external_id` / `source_refs`). Places **SQL** dry-run/apply therefore targets production-shaped databases. The shared contract still requires explicit `--target local` for local work and refuses silent URL inference.

---

## Live inspection (2026-07-23)

Supabase MCP was not connected in the agent session; identity was checked read-only via `psql`:

| Target | Evidence |
|---|---|
| Production project | `locghyuranqaqsnbxflc` (Baseline v1) |
| `core.core_places` live | 11213 |
| `import_work` batches | yangon settlements/essential **applied**; work rows still present until cleanup |

---

## Out of scope (this contract)

- Generic multi-family loader engine
- Buildings / landuse / water / roads loaders (not implemented yet)
- National import
- Silent target inference from env
- Production apply in this task

---

## Stop line

Contract + places compatibility only. Next family loaders must reuse this helper and keep family-specific SQL separate.
