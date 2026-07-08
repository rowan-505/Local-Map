---
name: transport-data-extraction
description: Extract visible bus route and stop data from external apps, clean it as JSON, check duplicates, generate temporary approximate geometry, and import it safely into CoreMap transport tables. Use when working on external bus app data, transport JSON imports, YBS or express bus data extraction, duplicate reports, temporary geometry, or CoreMap transport import workflows.
disable-model-invocation: true
---

# Transport Data Extraction

Use this skill when extracting visible bus route or stop data from an external app and preparing it for CoreMap.

## Hard Rules

- Use simple B1 English in user-facing output.
- Do not bypass private APIs, authentication, app security, rate limits, or paywalls.
- Extract only data that is visible to the user or data the user is allowed to use.
- Do not insert unreviewed data as verified.
- Do not overwrite rows with `review_status` of `reviewed`, `verified`, or `manual_protected`.
- Generate approximate geometry before insert because `transport.stops.geom` and `transport.route_paths.geom` are required.
- Store auto geometry status in `normalized_data` first. Do not add new DB columns unless the user asks.
- Use `transport.import_batches` and `transport.source_links` for every import.
- Write extracted data and reports into `tmp/transport-imports`.
- Do not create a new dashboard review page.
- Reuse existing transport dashboard CRUD and geometry pages for manual review and correction.

## CoreMap Transport Pattern

Use the live `transport` schema as the target:

- Routes: `transport.routes`
- Variants: `transport.route_variants`
- Route paths: `transport.route_paths`
- Stops: `transport.stops`
- Route-stop sequence: `transport.route_stops`
- Import batch metadata: `transport.import_batches`
- Source lineage: `transport.source_links`
- Import errors: `transport.import_errors`

Use `review_status = 'imported_unreviewed'` for newly imported data. Use `review_status = 'needs_review'` for auto-generated or low-confidence geometry. Never set imported rows to `verified`.

## File Workflow

Keep all temporary files under:

```text
tmp/transport-imports/<source>_<date>/
```

Use this layout:

```text
raw/extracted.json
normalized/normalized.json
reports/duplicates.md
reports/quality.md
reports/import-plan.md
```

Before creating this folder in a repo, check that it is gitignored. If it is not ignored, ask to add a `.gitignore` rule before writing raw data.

## Extraction Rules

1. Record the source name, source kind, source URL or app name, extraction date, and visible screen context.
2. Save raw extracted data before cleaning it.
3. Normalize names into separate fields when possible:
   - `name_mm`
   - `name_en`
   - `route_code`
   - `origin_name`
   - `destination_name`
4. Keep original source fields in `raw_payload` or `source_payload`.
5. Store cleaned data in `normalized_data`.
6. Do not guess hidden fields such as schedules, fares, or live GPS.

## Duplicate Checks

Create a duplicate report before any DB insert.

Check in this order:

1. `transport.source_links` by `entity_type`, `source_name`, `source_kind`, and `external_id`.
2. Existing route by `mode`, `route_code`, `origin_name`, and `destination_name`.
3. Existing route names using text similarity where available.
4. Existing stops by name and route context.
5. Existing stops by spatial distance if geometry exists, using a small radius such as 30 meters.

Mark each candidate as:

- `new`
- `exact_source_match`
- `possible_duplicate`
- `conflict`
- `needs_manual_review`

Do not auto-merge possible duplicates.

## Approximate Geometry

If the source gives only start and end points, create a temporary straight route line.

Use PostGIS logic like:

```sql
ST_MakeLine(
  ST_SetSRID(ST_MakePoint(:start_lng, :start_lat), 4326),
  ST_SetSRID(ST_MakePoint(:end_lng, :end_lat), 4326)
)
```

Place stops along the route line by sequence with:

```sql
ST_LineInterpolatePoint(path.geom, (stop_index - 1)::float / (stop_count - 1))
```

For one-stop or invalid route cases, do not fake geometry. Add a quality error instead.

Store geometry status in `normalized_data`, for example:

```json
{
  "geom_status": "auto_approximate",
  "geom_method": "start_end_linestring",
  "needs_manual_geom_review": true
}
```

## Safe Import Rules

Use an import script or SQL pipeline. Do not make the dashboard or public web app write directly to the database.

For each import:

1. Create one row in `transport.import_batches`.
2. Insert or update source lineage in `transport.source_links`.
3. Insert new route, variant, stop, route path, and route-stop rows with safe review status.
4. Write failed rows to `transport.import_errors`.
5. Keep the normalized source data in `normalized_data`.
6. Keep original source references in `source_refs` or `source_links.source_payload`.

Protection rules:

- If a target row is `manual_protected`, do not change it.
- If a target row is `verified` or `reviewed`, do not change names, sequence, or geometry.
- If a target row is `verified` or `reviewed`, only append source metadata when safe.
- Only replace geometry that is missing or still marked as auto-generated.
- Never delete old point ledger, audit, or review history data.

## Dashboard Review

Do not create a new import review page for this workflow.

Use existing transport dashboard pages:

- Route list and detail pages for route and variant review.
- Variant path editor for route path correction.
- Stop list and detail pages for stop name and point correction.
- Import pages for import batches, source links, and errors.

Small dashboard improvements are allowed only when needed:

- Filters for auto-imported rows.
- Filters for missing geometry.
- Filters for approximate geometry.
- Badges for `needs_review`, `auto_approximate`, and missing geometry.

## Report Format

Return a short report with:

1. Source and extraction scope.
2. Files written under `tmp/transport-imports`.
3. Duplicate summary.
4. Quality summary.
5. Import plan or dry-run result.
6. Rows blocked by protection rules.
7. Manual review steps in the existing transport dashboard.

Be honest about uncertainty. If the data is approximate, say it is approximate.
