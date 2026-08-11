# Database target safety (CoreMap pipelines)

Eliminate accidental local-versus-production writes.

Canonical shared libraries:

| Language | Path |
|----------|------|
| Bash | `tools/data-pipeline/lib/database_target_safety.sh` |
| TypeScript | `tools/data-pipeline/lib/database-target-safety.ts` |

The direct-Core runner and Stage K uploader both use these target-resolution
rules. Family SQL is executed only after the shared guard prints and verifies
the selected database identity.

Automated tests:

```bash
./tools/data-pipeline/tests/database_target_safety_tests.sh
```

---

## Canonical environment names

Use **only** these for pipeline target resolution:

| Variable | Role |
|----------|------|
| `LOCAL_DATABASE_URL` | Local lab / staging / mirror target |
| `SUPABASE_READ_DATABASE_URL` | Production **read** (FDW mirror refresh, reports) |
| `SUPABASE_WRITE_DATABASE_URL` | Production **write** (direct-Core regional import or Stage K review upload) |

Legacy (temporary):

| Variable | Allowed as |
|----------|------------|
| `SUPABASE_DATABASE_URL` | Fallback for read or write when the matching canonical var is unset (prints a warning) |

**Refused as a silent production write target:**

- `DATABASE_URL`
- `SUPABASE_DIRECT_DATABASE_URL` alone (prefer mapping into `SUPABASE_WRITE_DATABASE_URL`)
- Treating `SUPABASE_READ_DATABASE_URL` as the write URL (unless `SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL=true`)

`DATABASE_URL` remains valid for the Fastify API and Martin. Pipeline write tools must not fall back to it.

---

## Hard rules

1. **Explicit target** — `--target local` or `--target production` (or equivalent). Do not infer from “whatever env is set”.
2. **Print identity before write** — masked URL, host fingerprint, database name, Supabase project ref.
3. **Mask credentials** — never print passwords.
4. **Production confirmation** — production durable writes need `--apply` plus an exact confirmation string.
5. **Identity match** — production URL must match expected project ref (default `locghyuranqaqsnbxflc`).
6. **Sample / classify scripts** — local only; refuse production writes.
7. **Default dry-run** — no durable write unless `--apply` (or family-specific apply mode) is set.
8. **Refuse ambiguous fingerprints** — `LOCAL_DATABASE_URL` must not equal the production URL fingerprint.

Expected production project ref override:

```bash
export DB_TARGET_PRODUCTION_PROJECT_REF=locghyuranqaqsnbxflc
```

---

## Confirmation strings

| Tool | Production apply confirmation |
|------|-------------------------------|
| Direct-Core regional import | `IMPORT <family> <region_code> <snapshot_version>` |
| Stage K remote review upload | `UPLOAD remote_review <package_name>` |

Pipeline Stage K also requires:

```bash
export REMOTE_REVIEW_UPLOAD_ENABLED=true
export REMOTE_REVIEW_UPLOAD_CONFIRMATION="UPLOAD remote_review ${REMOTE_REVIEW_PACKAGE_NAME}"
```

`REMOTE_REVIEW_UPLOAD_ENABLED` alone is not enough.

---

## Command examples

### Direct-Core regional import (dry-run → apply)

```bash
# Export only locally validated safe_new/safe_update rows first.
PAGER=cat psql "$LOCAL_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v staging_schema=staging \
  -v output_path="/absolute/path/roads.safe.csv" \
  -v rejection_path="/absolute/path/roads.invalid.csv" \
  -f tools/data-pipeline/direct-core/export/export_roads.sql

# Dry-run against production: the complete regional transaction rolls back.
bash tools/data-pipeline/direct-core/run_direct_core_import.sh \
  --family roads \
  --target production \
  --csv /absolute/path/roads.safe.csv \
  --region-code yangon \
  --snapshot-version "$SNAPSHOT_VERSION" \
  --dry-run

# Apply only with the exact family/region/snapshot confirmation.
bash tools/data-pipeline/direct-core/run_direct_core_import.sh \
  --family roads \
  --target production \
  --csv /absolute/path/roads.safe.csv \
  --region-code yangon \
  --snapshot-version "$SNAPSHOT_VERSION" \
  --apply \
  --confirmation "IMPORT roads yangon ${SNAPSHOT_VERSION}"
```

### Stage K (direct TypeScript)

```bash
# Dry-run (default): prints what would upload
REMOTE_REVIEW_UPLOAD_ENABLED=true \
LOCAL_DATABASE_URL=... \
SUPABASE_WRITE_DATABASE_URL=... \
npx tsx tools/data-pipeline/local-osm/12_upload_remote_review_package.ts \
  --target=production \
  --package-name=remote_review_conflicts_osm_myanmar_2026_07_21

# Apply
REMOTE_REVIEW_UPLOAD_ENABLED=true \
LOCAL_DATABASE_URL=... \
SUPABASE_WRITE_DATABASE_URL=... \
npx tsx tools/data-pipeline/local-osm/12_upload_remote_review_package.ts \
  --target=production \
  --apply \
  --confirmation='UPLOAD remote_review remote_review_conflicts_osm_myanmar_2026_07_21' \
  --package-name=remote_review_conflicts_osm_myanmar_2026_07_21
```

### Prod mirror refresh (read-only to Supabase)

```bash
cp tools/data-pipeline/prod-mirror/00_env.example.sh tools/data-pipeline/prod-mirror/00_env.sh
# Fill LOCAL_DATABASE_URL + SUPABASE_READ_DATABASE_URL (+ optional WRITE for refuse checks)
./tools/data-pipeline/prod-mirror/refresh_prod_mirror.sh
```

Mirror refresh never uses `SUPABASE_WRITE_DATABASE_URL`.

### Sample / classify (local only)

```bash
./tools/data-pipeline/local-osm/scripts/run_yangon_downtown_family_sample.sh buildings 80
./tools/data-pipeline/local-osm/scripts/run_yangon_roads_5k_classify.sh 5000
```

These refuse `--target production` and write only via `LOCAL_DATABASE_URL`.

### TypeScript resolve helper

```ts
import {
  resolveDbTarget,
  printResolvedDbTarget,
  requireProductionWriteConfirmation,
} from "../lib/database-target-safety.js";

const resolved = resolveDbTarget({ target: "production", role: "write" });
printResolvedDbTarget(resolved);
requireProductionWriteConfirmation({
  mode: "apply",
  confirmationExpected: "IMPORT places yangon osm_myanmar_2026_07_29_yangon_v1",
  confirmationGot: process.env.CONFIRMATION,
});
```

YBS scripts: `tools/data-pipeline/transport-json-import/ybs-supabase-import/lib/resolve-pipeline-db-url.ts`  
Train scripts: `tools/data-pipeline/train-app-import/lib/db.ts` → `resolvePipelineDatabaseUrl`

---

## What “print identity” looks like

```text
=== database target identity ===
target=production
target_label=production-write (SUPABASE_WRITE_DATABASE_URL)
target_role=write
database_url=postgresql://postgres.locghyuranqaqsnbxflc:***@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
production_project_ref=locghyuranqaqsnbxflc
production_url_fingerprint=postgres.locghyuranqaqsnbxflc@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
database=postgres
server_addr=...
server_port=5432
db_user=postgres
================================
```

---

## Related docs

- Direct-Core contract and commands: `tools/data-pipeline/direct-core/README.md`
- Local OSM README: `tools/data-pipeline/local-osm/README.md`
- Prod mirror README: `tools/data-pipeline/prod-mirror/README.md`
