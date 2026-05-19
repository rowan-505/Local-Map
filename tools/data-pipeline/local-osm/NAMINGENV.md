# Local OSM Import Env Naming Guide

This guide explains how to name each full import env file consistently.

Each import should use one complete env file inside:

    tools/data-pipeline/local-osm/imports/

Example:

    imports/kyauktan_2026_07_v4.env

Run the pipeline with:

    ./run_local_osm_pipeline.sh imports/kyauktan_2026_07_v4.env

---

## 1. Env File Naming Rule

Use this format:

    {region_slug}_{yyyy}_{mm}_v{number}.env

Examples:

    kyauktan_2026_07_v4.env
    kyauktan_2026_08_v5.env
    thanlyin_2026_08_v1.env
    yangon_2026_09_v1.env

Meaning:

    kyauktan_2026_07_v4.env
    │        │    │  │
    │        │    │  └── import version number
    │        │    └───── month
    │        └────────── year
    └─────────────────── region slug

---

## 2. Region Slug Rule

Use lowercase English names.

Good:

    kyauktan
    thanlyin
    yangon
    north_okkalapa
    south_dagon

Bad:

    Kyauktan
    MM-KYAUKTAN
    kyauktan-township
    kyauktan region

The env file name should be simple and filesystem-friendly.

---

## 3. REGION_CODE Rule

Inside the env file, use uppercase stable region codes.

Example:

    export REGION_CODE="MM-KYAUKTAN"

Recommended region codes:

    export REGION_CODE="MM-KYAUKTAN"
    export REGION_CODE="MM-THANLYIN"
    export REGION_CODE="MM-YANGON"

Do not mix different spellings.

Good:

    export REGION_CODE="MM-KYAUKTAN"

Bad:

    export REGION_CODE="kyauktan"
    export REGION_CODE="Kyauktan"
    export REGION_CODE="MM_KYAUKTAN"

If REGION_CODE changes accidentally, the diff script may compare the wrong snapshots or fail to find the previous snapshot.

---

## 4. SNAPSHOT_VERSION Naming Rule

Use this format:

    {source_code}_{yyyy}_{mm}_{region_slug}_v{number}

For OSM Myanmar:

    osm_myanmar_2026_07_kyauktan_v4

Examples:

    export SNAPSHOT_VERSION="osm_myanmar_2026_07_kyauktan_v4"
    export SNAPSHOT_VERSION="osm_myanmar_2026_08_kyauktan_v5"
    export SNAPSHOT_VERSION="osm_myanmar_2026_08_thanlyin_v1"

Meaning:

    osm_myanmar_2026_07_kyauktan_v4
    │           │    │  │        │
    │           │    │  │        └── version number
    │           │    │  └─────────── region slug
    │           │    └────────────── month
    │           └─────────────────── year
    └─────────────────────────────── source code

Rule:

    Never reuse the same SNAPSHOT_VERSION for different imports.

---

## 5. BATCH_NAME Naming Rule

Use this format:

    {region_slug}_osm_import_{yyyy}_{mm}_v{number}

Examples:

    export BATCH_NAME="kyauktan_osm_import_2026_07_v4"
    export BATCH_NAME="kyauktan_osm_import_2026_08_v5"
    export BATCH_NAME="thanlyin_osm_import_2026_08_v1"

SNAPSHOT_VERSION and BATCH_NAME should describe the same import.

Good:

    export SNAPSHOT_VERSION="osm_myanmar_2026_07_kyauktan_v4"
    export BATCH_NAME="kyauktan_osm_import_2026_07_v4"

Bad:

    export SNAPSHOT_VERSION="osm_myanmar_2026_07_kyauktan_v4"
    export BATCH_NAME="test_import"

---

## 6. Version Number Rule

The version number should increase for the same region.

Example for Kyauktan:

    kyauktan_2026_05_v2.env
    kyauktan_2026_06_v3.env
    kyauktan_2026_07_v4.env
    kyauktan_2026_08_v5.env

Example for Thanlyin:

    thanlyin_2026_08_v1.env
    thanlyin_2026_09_v2.env

Each region has its own version sequence.

Before creating a new env file, check the latest snapshot in DB:

    SELECT
      snapshot_version,
      region_code,
      captured_at
    FROM system.system_source_snapshots
    WHERE region_code = 'MM-KYAUKTAN'
    ORDER BY captured_at DESC;

---

## 7. Full Env File Example

File name:

    imports/kyauktan_2026_07_v4.env

Content:

    # =============================================================================
    # Local OSM Import Env
    # Region: Kyauktan
    # Version: 2026-07 v4
    # =============================================================================

    # Local DB
    export LOCAL_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5433/geo_core"

    # Source
    export SOURCE_CODE="osm_myanmar"
    export REGION_CODE="MM-KYAUKTAN"

    # Input file
    export PBF_PATH="/Users/nyi/database/source/myanmar-latest.osm.pbf"
    export SNAPSHOT_REF="myanmar-latest.osm.pbf"

    # Import identity
    export SNAPSHOT_VERSION="osm_myanmar_2026_07_kyauktan_v4"
    export BATCH_NAME="kyauktan_osm_import_2026_07_v4"

    # Optional checksum
    export CHECKSUM=""

    # Import config
    export OSM2PGSQL_FLEX_FILE="/Users/nyi/coremap/tools/data-pipeline/local-osm/osm2pgsql_tmp_import.lua"

    # Logs
    export LOG_DIR="/Users/nyi/coremap/logs/data-pipeline"

---

## 8. How to Create a New Import Env

Step 1: copy template.

    cd tools/data-pipeline/local-osm
    cp imports/template.full.env imports/kyauktan_2026_08_v5.env

Step 2: edit new file.

    code imports/kyauktan_2026_08_v5.env

Step 3: update these values.

    export REGION_CODE="MM-KYAUKTAN"
    export PBF_PATH="/Users/nyi/database/source/myanmar-latest.osm.pbf"
    export SNAPSHOT_REF="myanmar-latest.osm.pbf"
    export SNAPSHOT_VERSION="osm_myanmar_2026_08_kyauktan_v5"
    export BATCH_NAME="kyauktan_osm_import_2026_08_v5"
    export CHECKSUM=""

Step 4: run pipeline.

    ./run_local_osm_pipeline.sh imports/kyauktan_2026_08_v5.env

---

## 9. Naming Consistency Checklist

Before running, check:

    [ ] Env file name matches region/date/version
    [ ] REGION_CODE is uppercase and stable
    [ ] SNAPSHOT_VERSION uses source/year/month/region/version
    [ ] BATCH_NAME matches SNAPSHOT_VERSION meaning
    [ ] SNAPSHOT_VERSION has not been used before
    [ ] PBF_PATH points to the correct file
    [ ] SNAPSHOT_REF is a clean file name
    [ ] CHECKSUM is filled for serious imports
    [ ] If using Stages J/K/L: `REMOTE_REVIEW_PACKAGE_NAME` is set and equals Stage J `-v package_name` (see §10 below)
    [ ] Optional: when using `REMOTE_LINEAGE_ALIGNMENT_VERIFY=true`, read **`README_REMOTE_REVIEW.md`** (Stage `14`)

---

## 10. Remote review package (`REMOTE_REVIEW_PACKAGE_NAME`)

When you enable outbound review tooling in **`run_local_osm_pipeline.sh`** (`REMOTE_REVIEW_UPLOAD_ENABLED` and/or `REMOTE_REVIEW_PREPARE_VERIFY_ONLY`; see **`README.md`**), **`REMOTE_REVIEW_PACKAGE_NAME`** identifies the **`system.system_remote_review_packages.package_name`** row and (after Stage **K**) the Supabase **`import_review.review_batches.batch_name`** for the same upload.

Recommended patterns:

**A) Fixed name tied to import** (readable, stable across machines):

```bash
export REMOTE_REVIEW_PACKAGE_NAME="remote_review_pkg_osm_myanmar_2026_07_kyauktan_v4"
```

Reuse the **`SNAPSHOT_VERSION`** slug so operators can correlate:

```bash
export REMOTE_REVIEW_PACKAGE_NAME="remote_review_pkg_${SNAPSHOT_VERSION}"
```

**B) Auto-name from Stage J SQL only**: when you run **`11_prepare_remote_review_package.sql` by yourself** with an **empty** `-v package_name=`, Stage J emits  
`remote_review_pkg_<snapshot>_<YYYYMMDDHHMMSS>`. The pipeline runner **always** passes `package_name="${REMOTE_REVIEW_PACKAGE_NAME}"`, so for **`run_local_osm_pipeline.sh`** you must set **`REMOTE_REVIEW_PACKAGE_NAME`** to a nonempty string.

Conflict rule: **`replace_package=false`** in the runner. If **`REMOTE_REVIEW_PACKAGE_NAME`** already exists in **`system.system_remote_review_packages`**, Stage **J fails** unless you drop that row or re-run SQL with **`replace_package=true`** manually.

---

## 11. Lineage alignment Stage `14` (`REMOTE_LINEAGE_ALIGNMENT_VERIFY`)

Set only when **`REMOTE_REVIEW_UPLOAD_ENABLED`** or **`REMOTE_REVIEW_PREPARE_VERIFY_ONLY`** is true (Stages **11–13** must run first).

```bash
export REMOTE_LINEAGE_ALIGNMENT_VERIFY='true'
```

The runner executes **`14_verify_lineage_alignment.sql`** after **`13_verify_remote_review_upload.sql`**, using the same **`REMOTE_REVIEW_PACKAGE_NAME`**, **`STAGING_SCHEMA`**, and **`SNAPSHOT_VERSION`** as the rest of the pipeline.

Details: **`README_REMOTE_REVIEW.md`**.

---

## 12. Recommended .gitignore

Real env files may contain database passwords.

Use:

    # Ignore real import env files
    tools/data-pipeline/local-osm/imports/*.env

    # Keep template only
    !tools/data-pipeline/local-osm/imports/template.full.env

Do not commit real files like:

    imports/kyauktan_2026_07_v4.env

unless you remove secrets first.