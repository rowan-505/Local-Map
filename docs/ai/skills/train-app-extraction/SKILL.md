---
name: train-app-extraction
description: Extract Myanmar train route data from yrsmm.com (YRS Move app backend), save raw JSON, merge English and Myanmar, normalize DB-compatible fields, match stations to existing train stops, and import into CoreMap transport tables. Use for Myanmar train routes, train schedules, or train transport imports. No phone or ADB required.
disable-model-invocation: true
---

# Train App Extraction

Use this skill when importing Myanmar train route data into CoreMap. Keep it simple. Do not copy the full YBS pipeline.

## Data source

- **Primary:** `https://yrsmm.com` via `extract/extract-yrsmm-web.ts`
- Same data as the YRS Move app (Flutter + InAppWebView)
- **No Android device or ADB** — the app WebView does not expose route text to UIAutomator

## Hard Rules

- Use simple B1 English in user-facing output.
- Extract English first (`--language en`), then Myanmar (`--language my`).
- Fetch route list from `https://yrsmm.com/api/route` (live app API), then each route detail page (Inertia JSON).
- Save raw JSON first. Do not normalize during extraction.
- Merge EN and MY by `train_number` + `direction` + station sequence.
- Do not create new station rows automatically in v1.
- New imported rows must be inactive first: `review_status='imported_unreviewed'`, `is_active=false`.
- Do not delete train stops/terminals. They are a reusable geometry pool.
- Legacy train routes/variants/paths must be marked and cleaned later.

## Normalize Only These Fields

During extraction, save raw JSON only. Normalize later, and only these DB-compatible fields:

- train number
- route code
- variant code
- direction
- operation day
- train type
- train model
- origin / destination
- total stations
- travel duration
- station sequence
- station times

## Timing Offsets

Calculate timing offsets locally from clock times in the extracted schedule:

- `travel_time_from_previous_seconds`
- `arrival_offset_seconds`
- `departure_offset_seconds`

Offsets are relative to the first station departure.

## Station Matching

- Match stations to existing rows in `transport.stops` where `mode = 'train'`.
- Do not create new station rows automatically in v1.
- If a station has no match, mark the route as `needs_review` and skip import. Report the unmatched name.

## Import Rules

Insert only clean, fully matched routes.

- Insert into `transport.routes`, `transport.route_variants`, and `transport.route_stops`.
- New rows: `review_status = 'imported_unreviewed'`, `is_active = false`.
- Do not overwrite rows with `review_status` of `reviewed`, `verified`, or `manual_protected`.

## File layout

Default run root: `tmp/train-import/` (gitignored).

```text
tmp/train-import/raw/en/route-list.json
tmp/train-import/raw/en/routes/TRAIN-<n>-<UP|DOWN>.json
tmp/train-import/raw/my/...
tmp/train-import/merged/
tmp/train-import/normalized/
tmp/train-import/station-matches/
```

## Command order

Run from repo root with `npx tsx`.

1. `extract/extract-yrsmm-web.ts --step index --language en`
2. `extract/extract-yrsmm-web.ts --step details --language en`
3. `extract/extract-yrsmm-web.ts --step index --language my`
4. `extract/extract-yrsmm-web.ts --step details --language my`
5. `normalize/merge-language-routes.ts`
6. `normalize/normalize-train-routes.ts`
7. `db/match-train-stations.ts`
8. `db/import-train-route.ts --route TRAIN-<n>-<UP|DOWN>` (dry-run, then `--execute`)
9. `validate/validate-train-route.ts --route TRAIN-<n>-<UP|DOWN>`
10. Repeat import for more routes after one passes validation
11. `cleanup/mark-legacy-train-data.ts` then `cleanup/cleanup-legacy-train-routes.ts` (later, after new routes are verified)

## Report format

Return a short report with:

1. Extraction scope (languages, route count).
2. Files written under `tmp/train-import/`.
3. Station match summary (matched, unmatched).
4. Import result for the validated route.
5. Routes blocked by unmatched stations or protection rules.
6. Legacy cleanup left for later.

Be honest about uncertainty. If data is approximate or unmatched, say so.

## Legacy ADB path (unsupported)

`extract/legacy-adb/` holds old screen-reading scripts. They do **not** work for YRS Move. Do not use them unless debugging parsers with saved XML dumps.
