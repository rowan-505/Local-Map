# YBS Phase 5 Normalization

Normalize merged Phase 4 YBS route JSON into Phase 6-ready files.

This tool does **not** touch Supabase or the CoreMap database. It only reads
merged JSON and writes normalized JSON plus reports under
`tmp/transport-imports/ybs-all/`.

## Input

```text
tmp/transport-imports/ybs-all/merged/routes/*.json
```

Expected merged schema version: `3`.

## Output

```text
tmp/transport-imports/ybs-all/normalized/routes/*.json
tmp/transport-imports/ybs-all/reports/phase5-normalization-report.json
tmp/transport-imports/ybs-all/reports/phase5-normalization-report.md
```

## What normalization does

1. Trim text fields.
2. Collapse duplicate spaces.
3. Convert empty strings to `null`.
4. Convert `N/A` and `N/A - N/A` to `null`.
5. Set `route.route_code` from `route.route_code_candidate`.
6. Ensure `route_number`, `fare_min`, and `fare_max` are numbers or `null`.
7. Keep only `outbound` and `inbound` variants.
8. Renumber stop `sequence` to start at `1` in each direction.
9. Preserve `area_text_en_script_status`, `parser_diagnostics`, and source warnings in `source_warnings`.
10. Add normalization status, quality score, blocking errors, and `warnings`.

## Status values

| Status | Meaning |
|---|---|
| `ready_for_phase6` | No blocking errors and no warnings |
| `needs_manual_fix` | Warnings only, no blocking errors |
| `blocked_invalid_structure` | Missing route code, missing Myanmar route name, missing direction, zero stops, or broken sequence |
| `blocked_dirty_stop_data` | Placeholder Myanmar stop text or English metadata stop names |

## Commands

Normalize all merged routes:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-normalize/normalize-merged-routes.ts \
  --run tmp/transport-imports/ybs-all
```

Normalize selected routes:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-normalize/normalize-merged-routes.ts \
  --run tmp/transport-imports/ybs-all \
  --routes YBS-1,YBS-2
```

Validate normalized output:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-normalize/validate-normalized-routes.ts \
  --run tmp/transport-imports/ybs-all
```

## Rules not done here

- No translation.
- No guessed names.
- No database insert.
- No ADB extraction.

Phase 6 can use only routes with `normalization_status = ready_for_phase6`, or
review routes marked `needs_manual_fix` before import.
