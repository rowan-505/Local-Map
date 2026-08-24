# Source-fresh street-name refresh

This is a name-metadata-only OSM refresh. It never imports or compares geometry.
The sole automatic match is:

```sql
core.core_streets.external_id = 'osm:W:' || osm_way_id
```

## Workflow

1. Use the project Myanmar Geofabrik PBF and record its embedded replication
   timestamp plus SHA-256 checksum.
2. Use `osmium tags-filter --omit-referenced` to retain ways carrying current,
   language-specific, secondary, or historical name tags. Referenced nodes are
   deliberately omitted.
3. Convert the filtered way metadata to OSM XML, then to CSV/JSON with
   `parse_name_ways.py`.
4. Load that CSV into a PostgreSQL temporary table over the configured read-only
   Supabase connection.
5. Run `classify_source_fresh_names.sql` and export the dry-run report.
6. Generate a migration only from `safe_insert` and
   `safe_update_source_derived`; review every other class separately.

Current automatic tags are `name:my`, `name:en`, `name`, and the explicitly
supported `name:und`. Other `name:*` tags are report-only because the present
CoreMap language model documents only `my`, `en`, and `und`. `official_name`,
`short_name`, `loc_name`, `alt_name`, and `old_name` are also report-only; the
street-name table does not currently provide a safely established alias/history
model. `ref` is never a name candidate.

Run:

```bash
tools/data-pipeline/local-osm/street-name-refresh/run_source_fresh_street_name_refresh.sh \
  tools/data-pipeline/local-osm/imports/myanmar_national_dry_run_2026_07_23.env
```

The report directory is gitignored. The generated migration is not; inspect it
before applying it through the repository's normal numbered Supabase migration
process.

Generate migration 194 after the dry run:

```bash
python3 tools/data-pipeline/local-osm/street-name-refresh/generate_migration.py \
  --classified-csv tools/data-pipeline/local-osm/reports/street-name-refresh/2026-08-23/classified-current-names.csv \
  --source-summary tools/data-pipeline/local-osm/reports/street-name-refresh/2026-08-23/source-summary.json \
  --output infrastructure/database/migrations/supabase/194_source_fresh_street_name_refresh.sql
```
