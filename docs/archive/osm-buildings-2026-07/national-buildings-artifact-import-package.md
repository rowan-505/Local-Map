# National buildings — one-time artifact import package

Prepared from retained approved CSV/manifest (no staging restore, no reclassify).

**Package:** [`tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/one_time_artifact_package/`](../tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/one_time_artifact_package/)

**Runner:** `tools/data-pipeline/direct-core/run_buildings_artifact_import.sh`

## Verdict

**NO_GO for re-apply** on current Supabase: all 22,703 `safe_new` identities already exist (publish batch **255**). Artifact/basemap/FK checks pass.

Details: `one_time_artifact_package/dry_run_summary.md`.
