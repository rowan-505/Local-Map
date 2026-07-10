# Train app import pipeline

Offline TypeScript pipeline for importing Myanmar train route schedules into CoreMap `transport.*` tables.

**Data source:** [https://yrsmm.com](https://yrsmm.com) — the same backend the YRS Move app loads in its WebView.

**Technology:** TypeScript, run with `npx tsx` from the **repo root**.

**AI skill:** [`docs/ai/skills/train-app-extraction/SKILL.md`](../../../docs/ai/skills/train-app-extraction/SKILL.md)

**DB migration (timing fields):** [`infrastructure/database/migrations/supabase/124_train_route_stops_timing_prep.sql`](../../../infrastructure/database/migrations/supabase/124_train_route_stops_timing_prep.sql)

---

## What this pipeline does

| Does | Does not (v1) |
|------|----------------|
| Extract route list + station schedules from yrsmm.com | Use Android ADB / phone screen dumps |
| Merge English + Myanmar raw JSON | Import fares |
| Normalize DB-compatible fields + timing offsets | Import route paths / corridor geometry |
| Match stations to `transport.stops` (`mode = train`) | Overwrite `reviewed` / `verified` / `manual_protected` rows |
| Import routes, variants, and `route_stops` | Auto-activate imported rows |
| Validate imported data (read-only) | Replace the YBS bus pipeline |

This is intentionally smaller than the YBS bus pipeline: **raw JSON first**, one variant at a time, review before activation.

**Generation tag:** `simple_train_system_v1` (stored in `normalized_data` / `source_refs`).

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Network | Access to `https://yrsmm.com` for extraction |
| Database URL | `SUPABASE_DIRECT_DATABASE_URL`, `DATABASE_URL`, or `LOCAL_DATABASE_URL` in `apps/api/.env` or `infrastructure/.env` |
| Working folder | `tmp/train-import/` (gitignored) |
| Node + tsx | Run all scripts with `npx tsx` from repo root |

**Not needed:** Android device, ADB, or the train app installed. The YRS Move app renders inside a WebView; UIAutomator cannot read route text. Legacy ADB scripts are reference-only — see [`extract/legacy-adb/README.md`](extract/legacy-adb/README.md).

---

## End-to-end flow

```text
yrsmm.com API
    │
    ▼
[1–4] Extract (EN + MY)          → tmp/train-import/raw/
    │
    ▼
[5]   Merge languages            → tmp/train-import/merged/
    │
    ▼
[6]   Normalize                  → tmp/train-import/normalized/
    │
    ▼
[7]   Match stations (SELECT)      → tmp/train-import/station-matches/
    │                              → tmp/train-import/import-ready/
    │
    ├─ optional: create missing stops (placeholder geom)
    │             re-run match
    │
    ▼
[8–9] Import + validate (write)  → transport.routes / route_variants / route_stops
    │
    ▼
[post] Fix placeholder coordinates → activate routes (optional)
    │
    ▼
[11–12] Mark + cleanup legacy train data (after new routes verified)
```

---

## Quick start (copy-paste order)

Run every command from the **repo root**.

### Phase A — Extract (no database)

```bash
# English: route index, then all route details
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step index --language en
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step details --language en

# Myanmar: route index, then all route details
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step index --language my
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step details --language my
```

### Phase B — Merge + normalize (no database)

```bash
npx tsx tools/data-pipeline/train-app-import/normalize/merge-language-routes.ts
npx tsx tools/data-pipeline/train-app-import/normalize/normalize-train-routes.ts
```

### Phase C — Station match (read-only SELECT)

```bash
npx tsx tools/data-pipeline/train-app-import/db/match-train-stations.ts
```

### Phase D — Import one route first (dry-run → execute → validate)

Replace `TRAIN-141-UP` with your target variant code.

```bash
npx tsx tools/data-pipeline/train-app-import/db/import-train-route.ts --route TRAIN-141-UP
npx tsx tools/data-pipeline/train-app-import/db/import-train-route.ts --route TRAIN-141-UP --execute
npx tsx tools/data-pipeline/train-app-import/validate/validate-train-route.ts --route TRAIN-141-UP
```

### Phase E — Import remaining routes

After the first route passes validation:

```bash
# All import-ready variants (dry-run, then execute)
npx tsx tools/data-pipeline/train-app-import/db/import-all-train-routes.ts
npx tsx tools/data-pipeline/train-app-import/db/import-all-train-routes.ts --execute
```

---

## Data folder layout

Default run root: `tmp/train-import/`

```text
tmp/train-import/
├── raw/
│   ├── en/
│   │   ├── route-list.json                    # all routes (index pass)
│   │   └── routes/
│   │       ├── TRAIN-11-UP.json
│   │       ├── TRAIN-141-UP.json
│   │       ├── TRAIN-GA-3-CLOCKWISE.json      # urban loop routes
│   │       └── ...
│   └── my/
│       ├── route-list.json
│       └── routes/
│           └── ...
├── merged/
│   └── TRAIN-<number>-<DIRECTION>.json        # EN+MY combined
├── normalized/
│   └── TRAIN-<number>-<DIRECTION>.json        # DB-compatible fields + offsets
├── station-matches/
│   ├── auto-matches.json                      # per-route match results
│   ├── unmatched-stations.json                # stations with no DB match
│   └── manual-overrides.json                  # optional human fixes
├── import-ready/
│   └── TRAIN-<number>-<DIRECTION>.json        # fully matched, ready for import
├── reviewed-station-geometry.json             # manual lon/lat for placeholder stops
└── reports/
    ├── placeholder-stations-review.json
    ├── create-missing-train-stops.json
    ├── import-all-train-routes.json
    ├── update-placeholder-station-geometry.json
    ├── activate-reviewed-train-routes.json
    ├── backfill-circular-route-metadata.json
    └── TRAIN-<variant>-validation.json
```

### Variant code format

```text
TRAIN-{train_number}-{DIRECTION}
```

| Direction code | Meaning | Examples |
|----------------|---------|----------|
| `UP` | Up / အဆန် | `TRAIN-11-UP`, `TRAIN-141-UP` |
| `DOWN` | Down / အစုန် | `TRAIN-11-DOWN` |
| `CLOCKWISE` | Urban loop | `TRAIN-GA-3-CLOCKWISE` |
| `ANTICLOCKWISE` | Urban loop | `TRAIN-KA-6-ANTICLOCKWISE` |

Urban Yangon routes use train numbers like `GA-3`, `KA-6`, `KHA-4`, `ZA-2`.

---

## Step-by-step guide

### Step 1–2 — Extract English

**Script:** `extract/extract-yrsmm-web.ts`

Fetches live data from yrsmm.com:

1. **Index** — `GET https://yrsmm.com/api/route` → writes `raw/en/route-list.json`
2. **Details** — fetches each route's Inertia JSON page → writes `raw/en/routes/TRAIN-*.json`

```bash
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step index --language en
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step details --language en
```

**CLI flags:**

| Flag | Purpose |
|------|---------|
| `--step index` \| `details` | Required. Index list or per-route detail files |
| `--language en` \| `my` | Required. Extract language |
| `--run <path>` | Optional. Default `tmp/train-import` |
| `--slug <slug>` | Optional. One route only, e.g. `141-up` (details step) |
| `--force` | Re-fetch even if output file already exists |

**Single route example:**

```bash
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts \
  --step details --language en --slug 141-up
```

**Output fields (raw, not normalized):** train number, direction, station names, clock times, operation text, train type/model, origin/destination headers. Long marketing text and images are kept in raw but ignored later.

**DB access:** none.

---

### Step 3–4 — Extract Myanmar

Same commands with `--language my`. Always run **English first**, then Myanmar.

```bash
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step index --language my
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step details --language my
```

**DB access:** none.

---

### Step 5 — Merge English + Myanmar

**Script:** `normalize/merge-language-routes.ts`

**Input:**

- `tmp/train-import/raw/en/routes/*.json`
- `tmp/train-import/raw/my/routes/*.json`

**Output:** `tmp/train-import/merged/{variant_code}.json`

Pairs routes by `variant_code` (train number + direction). Merges station rows by sequence. Does **not** translate — keeps `name_en` and `name_my` side by side.

```bash
npx tsx tools/data-pipeline/train-app-import/normalize/merge-language-routes.ts
```

**CLI flags:** `--run <path>`, `--self-test`

**Merge status values:**

| Status | Meaning |
|--------|---------|
| `merged` | Clean merge |
| `needs_manual_fix` | Warnings (station count mismatch, time mismatch, etc.) — may still proceed |
| `blocked_missing_language` | Missing EN or MY file for this variant |

**Report:** `tmp/train-import/reports/merge-language-routes.json` (if generated by script run)

**DB access:** none.

---

### Step 6 — Normalize

**Script:** `normalize/normalize-train-routes.ts`

**Input:** `tmp/train-import/merged/*.json`

**Output:** `tmp/train-import/normalized/{variant_code}.json`

Builds DB-compatible fields only:

- `route_code`, `variant_code`, `direction_id`
- `operation_days`, `train_type`, `train_model`
- `origin` / `destination` names (EN + MY)
- Station sequence, names, source times
- **Timing offsets** (computed locally from clock times):
  - `travel_time_from_previous_seconds`
  - `arrival_offset_seconds`
  - `departure_offset_seconds` (relative to first station departure)

Ignores: fare/price text, long passage paragraphs (except operation day), images, Favorite/Share UI.

```bash
npx tsx tools/data-pipeline/train-app-import/normalize/normalize-train-routes.ts
```

**CLI flags:** `--run <path>`, `--self-test`

**Normalization status:**

| Status | Meaning |
|--------|---------|
| `ready_for_station_match` | OK to match stations |
| `needs_manual_fix` | Timing parse failed, station count mismatch, or no stations |

**DB access:** none.

---

### Step 7 — Match stations

**Script:** `db/match-train-stations.ts`

**Input:** `tmp/train-import/normalized/*.json`

**Output:**

- `tmp/train-import/station-matches/auto-matches.json`
- `tmp/train-import/station-matches/unmatched-stations.json`
- `tmp/train-import/import-ready/{variant_code}.json` (only when **all** stations matched)

Matches each station name against existing `transport.stops` where `mode = 'train'`. **Does not create stops** in this step.

```bash
npx tsx tools/data-pipeline/train-app-import/db/match-train-stations.ts
```

**CLI flags:**

| Flag | Purpose |
|------|---------|
| `--run <path>` | Custom run root |
| `--database-url <url>` | Override env database URL |
| `--skip-db` | Offline test with empty stop pool |

**Match methods (best → worst):** `manual_override` → exact name → normalized name → alias → `ambiguous` → `unmatched`

**Route quality after match:**

| Status | Import allowed? |
|--------|-----------------|
| `ready_for_import` | Yes — `import-ready/*.json` written |
| `needs_station_match_review` | No — fix matches first |

**Manual overrides (optional):**

Create `tmp/train-import/station-matches/manual-overrides.json`:

```json
{
  "overrides": [
    {
      "variant_code": "TRAIN-141-UP",
      "sequence": 5,
      "stop_id": 1234,
      "note": "Dashboard-confirmed match"
    }
  ]
}
```

Then re-run `match-train-stations.ts`.

**DB access:** `SELECT` only on `transport.stops`.

---

### Step 7b — Create missing train stops (optional)

Use when many stations have no match in the existing train stop pool. Creates **one shared stop per unique station name** with **placeholder geometry** (near Myanmar centroid ~96.1, 19.75 + small jitter). Stops start as `review_status=needs_review`, `is_active=false`.

**Script:** `db/create-missing-train-stops.ts`

```bash
# Dry-run: report how many stops would be created
npx tsx tools/data-pipeline/train-app-import/db/create-missing-train-stops.ts

# Execute, then re-match
npx tsx tools/data-pipeline/train-app-import/db/create-missing-train-stops.ts --execute
npx tsx tools/data-pipeline/train-app-import/db/match-train-stations.ts
```

**Report:** `tmp/train-import/reports/create-missing-train-stops.json`

**DB access:** `INSERT` into `transport.stops` (with `--execute` only).

---

### Step 8 — Import route(s)

**Scripts:**

- `db/import-train-route.ts` — one variant
- `db/import-all-train-routes.ts` — all files in `import-ready/`

**Input:** `tmp/train-import/import-ready/{variant_code}.json`

**Writes to database:**

| Table | What is written |
|-------|-----------------|
| `transport.routes` | One row per `route_code` (e.g. `TRAIN-141`) |
| `transport.route_variants` | One row per variant (e.g. `TRAIN-141-UP`) |
| `transport.route_stops` | Station sequence, `stop_id`, timing offsets, source times |

**Not written in v1:** `route_paths`, fares, `source_links` batch (generation stored in `normalized_data` / `source_refs` on rows).

**Default import state:**

- `review_status = imported_unreviewed`
- `is_active = false`
- `generation = simple_train_system_v1`

**Single route (recommended first):**

```bash
npx tsx tools/data-pipeline/train-app-import/db/import-train-route.ts --route TRAIN-141-UP
npx tsx tools/data-pipeline/train-app-import/db/import-train-route.ts --route TRAIN-141-UP --execute
```

**All import-ready routes:**

```bash
npx tsx tools/data-pipeline/train-app-import/db/import-all-train-routes.ts
npx tsx tools/data-pipeline/train-app-import/db/import-all-train-routes.ts --execute

# Optional: first N routes only
npx tsx tools/data-pipeline/train-app-import/db/import-all-train-routes.ts --limit 5 --execute
```

**CLI flags (single import):**

| Flag | Purpose |
|------|---------|
| `--route TRAIN-141-UP` | Required variant code |
| `--execute` | Commit transaction (default is dry-run rollback) |
| `--run <path>` | Custom run root |
| `--database-url <url>` | Override env |

**Import behavior:**

- Re-importing the same variant **replaces** `route_stops` for that variant (delete + insert).
- Protected rows (`reviewed`, `verified`, `manual_protected`) are **not** overwritten.
- **Circular urban routes:** source JSON often has 39 stations with the first station repeated at the end. Import skips the closing duplicate because of `unique(route_variant_id, stop_id)`. Metadata records `source_total_stations=39`, `imported_route_stops=38`.

**DB access:** write (with `--execute`).

---

### Step 9 — Validate imported route

**Script:** `validate/validate-train-route.ts`

Read-only checks against live DB + normalized file on disk.

```bash
npx tsx tools/data-pipeline/train-app-import/validate/validate-train-route.ts --route TRAIN-141-UP
```

**Report:** `tmp/train-import/reports/TRAIN-141-UP-validation.json`

**Validation checks:**

| # | Check | What it verifies |
|---|-------|------------------|
| 1 | `route_exists` | Route row in DB |
| 2 | `variant_exists` | Variant row in DB |
| 3 | `route_mode_train` | `mode = train` |
| 4 | `route_generation` | `simple_train_system_v1` |
| 5 | `variant_generation` | `simple_train_system_v1` |
| 6 | `route_stop_count` | DB count matches expected (circular routes expect deduped count) |
| 7 | `stop_sequence_starts_at_one` | Sequence starts at 1 |
| 8 | `stop_sequence_no_gaps` | Contiguous 1..N |
| 9 | `route_stop_has_stop_id` | Every row has `stop_id` |
| 10 | `stop_id_exists` | Referenced stops exist |
| 11 | `stop_has_geom` | Every stop has geometry |
| 12 | `arrival_offset_non_decreasing` | Timing monotonic |
| 13 | `first_station_departure` | First stop has departure offset |
| 14 | `last_station_arrival` | Last stop has arrival offset |
| 15 | `inactive_until_reviewed` | Route/variant still inactive (fails after activation — expected) |

**DB access:** `SELECT` only.

---

## Post-import: geometry, activation, circular metadata

### Fix placeholder stop coordinates

When stops were created by `create-missing-train-stops.ts`, they use jitter coordinates near lat 19.7 (not real Yangon positions).

```bash
# 1) Report placeholder stops
npx tsx tools/data-pipeline/train-app-import/reports/report-placeholder-train-stations.ts

# 2) Edit real lon/lat in:
#    tmp/train-import/reviewed-station-geometry.json

# 3) Dry-run, then execute
npx tsx tools/data-pipeline/train-app-import/repair/update-placeholder-station-geometry.ts
npx tsx tools/data-pipeline/train-app-import/repair/update-placeholder-station-geometry.ts --execute

# Optional: also set is_active=true on reviewed stops
npx tsx tools/data-pipeline/train-app-import/repair/update-placeholder-station-geometry.ts --execute --activate-stops
```

**Input JSON shape:**

```json
[
  {
    "stop_id": 19370,
    "name_en": "Yangon Central Railway Station",
    "lon": 96.12345,
    "lat": 16.78901,
    "review_note": "OSM / manual map pin"
  }
]
```

The script updates already-`reviewed` stops when coordinates change.

**Reports:** `tmp/train-import/reports/placeholder-stations-review.json`, `update-placeholder-station-geometry.json`

---

### Activate reviewed routes

Activates `simple_train_system_v1` routes/variants when quality checks pass (no placeholder stops still on `needs_review`, validation passes, sibling variants on same route all pass).

```bash
npx tsx tools/data-pipeline/train-app-import/repair/activate-reviewed-train-routes.ts
npx tsx tools/data-pipeline/train-app-import/repair/activate-reviewed-train-routes.ts --execute
```

**Report:** `tmp/train-import/reports/activate-reviewed-train-routes.json`

After activation, validation check #15 (`inactive_until_reviewed`) will fail — that is expected.

---

### Backfill circular route metadata

For the 9 known Yangon urban loop variants, backfill `normalized_data` on variants imported before circular metadata existed:

```bash
npx tsx tools/data-pipeline/train-app-import/repair/backfill-circular-route-metadata.ts
npx tsx tools/data-pipeline/train-app-import/repair/backfill-circular-route-metadata.ts --execute
```

Known variants: `TRAIN-GA-3-CLOCKWISE`, `TRAIN-GA-6-ANTICLOCKWISE`, `TRAIN-KA-3-ANTICLOCKWISE`, `TRAIN-KA-6-ANTICLOCKWISE`, `TRAIN-KHA-3-CLOCKWISE`, `TRAIN-KHA-4-ANTICLOCKWISE`, `TRAIN-KHA-5-CLOCKWISE`, `TRAIN-KHA-6-CLOCKWISE`, `TRAIN-ZA-2-ANTICLOCKWISE`.

---

### Backfill train variant departure_time_text

One-time backfill for active train variants with missing `normalized_data.departure_time_text`.
Copies the first ordered `route_stop.source_time_text` when `source_time_type = departure`,
converts through the shared transport time parser (`04:45 PM` → `16:45`), and never overwrites
an existing explicit departure anchor.

```bash
npx tsx tools/data-pipeline/train-app-import/repair/backfill-train-variant-departure-time.ts
npx tsx tools/data-pipeline/train-app-import/repair/backfill-train-variant-departure-time.ts --execute
npx tsx tools/data-pipeline/train-app-import/repair/backfill-train-variant-departure-time.ts --verify
```

**Report:** `tmp/train-import/reports/backfill-train-variant-departure-time.json`

Dry-run rolls back the transaction. `--execute` commits updates only when
`departure_time_text` is still null/empty. `--verify` checks active train variants for
canonical `HH:mm` departure anchors.

---

## Legacy train cleanup (after new routes verified)

Run **only after** at least one `simple_train_system_v1` route is imported and validated.

### Step 11 — Mark legacy data

Marks pre-import train routes/variants/paths. Does **not** delete.

```bash
npx tsx tools/data-pipeline/train-app-import/cleanup/mark-legacy-train-data.ts
npx tsx tools/data-pipeline/train-app-import/cleanup/mark-legacy-train-data.ts --execute
```

Sets `generation = pre_simple_train_import` and `review_status = needs_review` (except `verified` / `manual_protected`).

### Step 12 — Soft-delete legacy routes

```bash
npx tsx tools/data-pipeline/train-app-import/cleanup/cleanup-legacy-train-routes.ts
npx tsx tools/data-pipeline/train-app-import/cleanup/cleanup-legacy-train-routes.ts \
  --execute --confirm-legacy-train-cleanup
```

Requires `--confirm-legacy-train-cleanup` on execute. Soft-deletes only rows already marked legacy.

**Do not delete train stops.** Stops are a shared geometry pool reused across imports.

---

## Pipeline stage reference

| Stage | Script | DB access |
|-------|--------|-----------|
| Extract index + details | `extract/extract-yrsmm-web.ts` | none |
| Merge EN + MY | `normalize/merge-language-routes.ts` | none |
| Normalize | `normalize/normalize-train-routes.ts` | none |
| Match stations | `db/match-train-stations.ts` | SELECT |
| Create missing stops | `db/create-missing-train-stops.ts` | INSERT (`--execute`) |
| Import one route | `db/import-train-route.ts` | write (`--execute`) |
| Import all routes | `db/import-all-train-routes.ts` | write (`--execute`) |
| Validate route | `validate/validate-train-route.ts` | SELECT |
| Report placeholder stops | `reports/report-placeholder-train-stations.ts` | SELECT |
| Update stop geometry | `repair/update-placeholder-station-geometry.ts` | write (`--execute`) |
| Activate routes | `repair/activate-reviewed-train-routes.ts` | write (`--execute`) |
| Backfill circular metadata | `repair/backfill-circular-route-metadata.ts` | write (`--execute`) |
| Mark legacy | `cleanup/mark-legacy-train-data.ts` | write (`--execute`) |
| Cleanup legacy | `cleanup/cleanup-legacy-train-routes.ts` | write (`--execute`) |

Shared types: [`lib/types.ts`](lib/types.ts). Path helpers: [`lib/paths.ts`](lib/paths.ts). Import logic: [`lib/train-import-executor.ts`](lib/train-import-executor.ts).

---

## Safety rules

1. **Extract English first**, then Myanmar.
2. **Save raw JSON before normalize.** No normalization during extraction.
3. **Dry-run imports by default.** Pass `--execute` only after reviewing output.
4. **New imports are inactive.** `review_status = imported_unreviewed`, `is_active = false`.
5. **Do not set imported rows to `verified`.** Use dashboard review workflow.
6. **Protected rows are never silently overwritten** (`reviewed`, `verified`, `manual_protected`).
7. **Do not delete train stops.** They are shared across routes and imports.
8. **No legacy cleanup until new routes are imported and checked.**
9. **No fares or route paths in v1.**
10. **DB writes only** in `db/`, `repair/`, and `cleanup/` scripts — not in extract/normalize stages.

---

## Code folder layout

```text
tools/data-pipeline/train-app-import/
├── README.md
├── lib/
│   ├── types.ts                      # JSON schemas (raw → import-ready)
│   ├── paths.ts                      # tmp/train-import path helpers
│   ├── yrsmm-web.ts                  # yrsmm.com API client + parsers
│   ├── time.ts                       # Clock time → offset seconds
│   ├── text-normalize.ts
│   ├── route-display-names.ts
│   ├── station-aliases.ts
│   ├── db.ts                         # Read-only + write PG helpers
│   ├── train-station-matcher.ts      # Stop name matching
│   ├── train-import-constants.ts     # generation, review status, mode
│   ├── train-import-executor.ts      # Core import (routes/variants/stops)
│   ├── train-route-validator.ts      # Pure validation checks
│   ├── circular-train-route.ts       # Urban loop dedupe + metadata
│   ├── mark-legacy-train-data.ts
│   └── cleanup-legacy-train-routes.ts
├── extract/
│   ├── extract-yrsmm-web.ts          # ★ supported extractor
│   ├── extract-route-index.ts      # stub → redirects to yrsmm-web
│   ├── extract-route-details.ts    # stub → redirects to yrsmm-web
│   ├── parse-train-ui.ts           # parser tests / legacy replay
│   ├── parse-train-detail-ui.ts
│   └── legacy-adb/                   # unsupported ADB path
├── normalize/
│   ├── merge-language-routes.ts
│   └── normalize-train-routes.ts
├── db/
│   ├── match-train-stations.ts
│   ├── create-missing-train-stops.ts
│   ├── import-train-route.ts
│   └── import-all-train-routes.ts
├── validate/
│   └── validate-train-route.ts
├── reports/
│   └── report-placeholder-train-stations.ts
├── repair/
│   ├── update-placeholder-station-geometry.ts
│   ├── activate-reviewed-train-routes.ts
│   └── backfill-circular-route-metadata.ts
└── cleanup/
    ├── mark-legacy-train-data.ts
    └── cleanup-legacy-train-routes.ts
```

---

## Self-tests

Offline unit checks (no database, no network):

```bash
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --self-test
npx tsx tools/data-pipeline/train-app-import/extract/parse-train-ui.ts --self-test
npx tsx tools/data-pipeline/train-app-import/extract/parse-train-detail-ui.ts --self-test
npx tsx tools/data-pipeline/train-app-import/normalize/merge-language-routes.ts --self-test
npx tsx tools/data-pipeline/train-app-import/normalize/normalize-train-routes.ts --self-test
npx tsx tools/data-pipeline/train-app-import/db/match-train-stations.ts --self-test
npx tsx tools/data-pipeline/train-app-import/db/import-train-route.ts --self-test
npx tsx tools/data-pipeline/train-app-import/validate/validate-train-route.ts --self-test
npx tsx tools/data-pipeline/train-app-import/cleanup/mark-legacy-train-data.ts --self-test
npx tsx tools/data-pipeline/train-app-import/cleanup/cleanup-legacy-train-routes.ts --self-test
```

Parser replay (`--replay-page-sources`) is only for legacy ADB XML dumps under `extract/legacy-adb/`.

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| `No import-ready file` | Run `match-train-stations.ts` — route may have unmatched stations |
| Many unmatched stations | Run `create-missing-train-stops.ts --execute`, then re-match |
| Import dry-run shows 0 route_stops | Check `import-ready/*.json` has `route_quality_status: ready_for_import` |
| Validation fails on stop count (38 vs 39) | Circular route — expected 38 after closing duplicate skip. Run `backfill-circular-route-metadata.ts` if metadata missing |
| Validation check #15 fails after activation | Expected — routes are now active |
| Stops on map at wrong location | Edit `reviewed-station-geometry.json`, run `update-placeholder-station-geometry.ts --execute` |
| `extract-route-index.ts` error about WebView | Use `extract-yrsmm-web.ts` instead (see stub message) |
| Protected row not updated on re-import | By design — change `review_status` in dashboard or use mergeable status |

---

## Typical production order

```text
1.  Extract EN index + details
2.  Extract MY index + details
3.  Merge + normalize
4.  Match stations
5.  (If needed) create missing stops → re-match
6.  Import one route — dry-run, execute, validate
7.  Import all remaining routes — dry-run, execute
8.  Validate sample routes (especially circular urban loops)
9.  Fix placeholder stop coordinates (reviewed-station-geometry.json)
10. Activate routes when geometry + validation pass
11. Mark legacy train data
12. Cleanup legacy routes (only after full verification)
```
