-- =============================================================================
-- Read-only analysis: import_review candidate naming field conflicts
-- File: tools/import-review/inspect-import-review-name-conflicts.sql
-- Supabase SQL Editor compatible (SELECT only — no DDL/DML)
-- =============================================================================
--
-- Purpose (non-destructive DB naming cleanup analysis):
--   Compare typed reviewer columns (name_mm, name_en) with legacy/import fields
--   (canonical_name, display_name, primary_name, normalized_data.tags.name).
--
-- Contract reference: docs/import-review/naming-contract.md
--
-- How to run:
--   1) Paste into Supabase SQL Editor (or psql) and execute section-by-section.
--   2) Start with section 0 (schema) if a table/column is missing in your env.
--   3) Section 1 = per-family counts; section 2 = 50 suspicious samples (all families).
--
-- Metrics (per candidate table):
--   1  total rows
--   2  name_mm not null/blank
--   3  name_en not null/blank
--   4  canonical_name not null/blank
--   5  display_name not null/blank (place_candidates only; else 0)
--   6  primary_name not null/blank (place_candidates only; else 0)
--   7  normalized_data.tags.name present
--   8  name_mm equals source imported name (contract order)
--   9  name_en equals source imported name
--  10  name_mm contains ASCII letters (possible script mix-up)
--  11  name_en contains Myanmar Unicode (U+1000–U+109F)
--  12  typed name_en set but legacy list EN would still show canonical/tags
--      (simulates pre-fix list that ignored typed name_en; see naming-contract)
--  13  sample suspicious rows (section 2, limit 50 overall)
--
-- -----------------------------------------------------------------------------
-- RECOMMENDATIONS (analysis output interpretation — no auto-migration)
-- -----------------------------------------------------------------------------
--
-- SAFE TO LEAVE
--   • normalized_data.tags.name (and tags.name:*) — immutable OSM source; never delete.
--   • Rows where typed name_mm/name_en is null and only legacy fields hold import labels
--     (reviewers have not edited yet).
--   • Rows where typed name equals source (redundant copy) — harmless; optional cleanup later.
--
-- NEEDS MAPPER / API FIX ONLY (no DB rewrite)
--   • Metric 12 > 0: typed name_en in DB but legacy fallback chain would show a different
--     English label in list UI that ignored typed columns (fixed in dashboard list SQL +
--     cache sync; re-run after deploy).
--   • List endpoint not SELECTing name_mm/name_en (API list SQL) — shows as metric 12 + empty
--     typed counts while detail has values.
--   • effective_name_* still used in a client — switch to typed columns per contract.
--
-- POSSIBLE LATER MIGRATION (plan carefully; not required for direct-edit)
--   • Backfill name_mm/name_en from best import source for rows never directly edited.
--   • Align canonical_name with typed names for promotion/search (family-specific rules).
--   • Deprecate duplicate legacy columns on places (primary_name, display_name) in API only
--     until promotion no longer reads them.
--   • landuse/water/buildings legacy `name` column vs canonical_name dedup.
--
-- NEVER
--   • DELETE or null out normalized_data.tags.name (or tags) as part of “cleanup”.
--   • Overwrite source_refs / normalized_data when saving typed names via PATCH.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0) Schema: which name columns exist per table (skip families missing in env)
-- -----------------------------------------------------------------------------
select
    c.table_name,
    bool_or(c.column_name = 'name_mm') as has_name_mm,
    bool_or(c.column_name = 'name_en') as has_name_en,
    bool_or(c.column_name = 'canonical_name') as has_canonical_name,
    bool_or(c.column_name = 'display_name') as has_display_name,
    bool_or(c.column_name = 'primary_name') as has_primary_name,
    bool_or(c.column_name = 'name') as has_legacy_name_column,
    bool_or(c.column_name = 'normalized_data') as has_normalized_data
from information_schema.columns c
where c.table_schema = 'import_review'
  and c.table_name in (
        'place_candidates',
        'building_candidates',
        'road_candidates',
        'landuse_candidates',
        'water_line_candidates',
        'water_polygon_candidates',
        'admin_area_candidates'
    )
  and c.column_name in (
        'name_mm',
        'name_en',
        'canonical_name',
        'display_name',
        'primary_name',
        'name',
        'normalized_data'
    )
group by c.table_name
order by c.table_name;


-- -----------------------------------------------------------------------------
-- 1) Per-family summary counts (UNION ALL)
-- -----------------------------------------------------------------------------
-- Shared expressions (inline per subquery):
--   tags_name     = nullif(btrim(normalized_data->'tags'->>'name'), '')
--   source_imported = coalesce(tags_name, primary_name?, display_name?, canonical_name, legacy name?)
--   source_mm     = coalesce(tags name:my/mm, tags_name if Myanmar script, canonical if Myanmar)
--   For simplicity, source_imported uses dashboard helper order (places):
--     tags.name -> primary_name -> display_name -> canonical_name
--   Other families: tags.name -> canonical_name -> legacy name (landuse/water/building)

with
place_enriched as (
    select
        p.*,
        nullif(btrim(p.normalized_data -> 'tags' ->> 'name'), '') as tags_name,
        coalesce(
            nullif(btrim(p.normalized_data -> 'tags' ->> 'name:my'), ''),
            nullif(btrim(p.normalized_data -> 'tags' ->> 'name:mm'), '')
        ) as tags_name_my,
        coalesce(
            nullif(btrim(p.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(p.primary_name), ''),
            nullif(btrim(p.display_name), ''),
            nullif(btrim(p.canonical_name), '')
        ) as source_imported_name,
        coalesce(
            nullif(btrim(p.normalized_data -> 'tags' ->> 'name:my'), ''),
            nullif(btrim(p.normalized_data -> 'tags' ->> 'name:mm'), ''),
            case
                when nullif(btrim(p.normalized_data -> 'tags' ->> 'name'), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(p.normalized_data -> 'tags' ->> 'name'), '')
                else null
            end,
            case
                when nullif(btrim(p.canonical_name), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(p.canonical_name), '')
                else null
            end
        ) as source_imported_mm,
        coalesce(
            nullif(btrim(p.canonical_name), ''),
            nullif(btrim(p.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(p.primary_name), ''),
            nullif(btrim(p.display_name), '')
        ) as legacy_list_en_fallback,
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'place_candidates'
              and e.candidate_id = p.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        ) as has_audit_name_en_edit
    from import_review.place_candidates p
),
building_enriched as (
    select
        b.*,
        nullif(btrim(b.normalized_data -> 'tags' ->> 'name'), '') as tags_name,
        coalesce(
            nullif(btrim(b.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(b.canonical_name), ''),
            nullif(btrim(b.name), '')
        ) as source_imported_name,
        coalesce(
            nullif(btrim(b.normalized_data -> 'tags' ->> 'name:my'), ''),
            nullif(btrim(b.normalized_data -> 'tags' ->> 'name:mm'), ''),
            case
                when nullif(btrim(b.normalized_data -> 'tags' ->> 'name'), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(b.normalized_data -> 'tags' ->> 'name'), '')
                else null
            end,
            case
                when nullif(btrim(b.canonical_name), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(b.canonical_name), '')
                else null
            end,
            nullif(btrim(b.name), '')
        ) as source_imported_mm,
        coalesce(
            nullif(btrim(b.canonical_name), ''),
            nullif(btrim(b.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(b.name), '')
        ) as legacy_list_en_fallback,
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'building_candidates'
              and e.candidate_id = b.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        ) as has_audit_name_en_edit
    from import_review.building_candidates b
),
road_enriched as (
    select
        r.*,
        nullif(btrim(r.normalized_data -> 'tags' ->> 'name'), '') as tags_name,
        coalesce(
            nullif(btrim(r.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(r.canonical_name), '')
        ) as source_imported_name,
        coalesce(
            nullif(btrim(r.normalized_data -> 'tags' ->> 'name:my'), ''),
            nullif(btrim(r.normalized_data -> 'tags' ->> 'name:mm'), ''),
            case
                when nullif(btrim(r.normalized_data -> 'tags' ->> 'name'), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(r.normalized_data -> 'tags' ->> 'name'), '')
                else null
            end,
            case
                when nullif(btrim(r.canonical_name), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(r.canonical_name), '')
                else null
            end
        ) as source_imported_mm,
        coalesce(
            nullif(btrim(r.canonical_name), ''),
            nullif(btrim(r.normalized_data -> 'tags' ->> 'name'), '')
        ) as legacy_list_en_fallback,
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'road_candidates'
              and e.candidate_id = r.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        ) as has_audit_name_en_edit
    from import_review.road_candidates r
),
landuse_enriched as (
    select
        l.*,
        nullif(btrim(l.normalized_data -> 'tags' ->> 'name'), '') as tags_name,
        coalesce(
            nullif(btrim(l.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(l.canonical_name), ''),
            nullif(btrim(l.name), '')
        ) as source_imported_name,
        coalesce(
            nullif(btrim(l.normalized_data -> 'tags' ->> 'name:my'), ''),
            nullif(btrim(l.normalized_data -> 'tags' ->> 'name:mm'), ''),
            case
                when nullif(btrim(l.normalized_data -> 'tags' ->> 'name'), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(l.normalized_data -> 'tags' ->> 'name'), '')
                else null
            end,
            case
                when nullif(btrim(l.canonical_name), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(l.canonical_name), '')
                else null
            end,
            nullif(btrim(l.name), '')
        ) as source_imported_mm,
        coalesce(
            nullif(btrim(l.canonical_name), ''),
            nullif(btrim(l.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(l.name), '')
        ) as legacy_list_en_fallback,
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'landuse_candidates'
              and e.candidate_id = l.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        ) as has_audit_name_en_edit
    from import_review.landuse_candidates l
),
water_line_enriched as (
    select
        w.*,
        nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), '') as tags_name,
        coalesce(
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(w.canonical_name), ''),
            nullif(btrim(w.name), '')
        ) as source_imported_name,
        coalesce(
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name:my'), ''),
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name:mm'), ''),
            case
                when nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), '')
                else null
            end,
            case
                when nullif(btrim(w.canonical_name), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(w.canonical_name), '')
                else null
            end,
            nullif(btrim(w.name), '')
        ) as source_imported_mm,
        coalesce(
            nullif(btrim(w.canonical_name), ''),
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(w.name), '')
        ) as legacy_list_en_fallback,
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'water_line_candidates'
              and e.candidate_id = w.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        ) as has_audit_name_en_edit
    from import_review.water_line_candidates w
),
water_polygon_enriched as (
    select
        w.*,
        nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), '') as tags_name,
        coalesce(
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(w.canonical_name), ''),
            nullif(btrim(w.name), '')
        ) as source_imported_name,
        coalesce(
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name:my'), ''),
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name:mm'), ''),
            case
                when nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), '')
                else null
            end,
            case
                when nullif(btrim(w.canonical_name), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(w.canonical_name), '')
                else null
            end,
            nullif(btrim(w.name), '')
        ) as source_imported_mm,
        coalesce(
            nullif(btrim(w.canonical_name), ''),
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(w.name), '')
        ) as legacy_list_en_fallback,
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'water_polygon_candidates'
              and e.candidate_id = w.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        ) as has_audit_name_en_edit
    from import_review.water_polygon_candidates w
),
admin_area_enriched as (
    select
        a.*,
        nullif(btrim(a.normalized_data -> 'tags' ->> 'name'), '') as tags_name,
        coalesce(
            nullif(btrim(a.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(a.canonical_name), '')
        ) as source_imported_name,
        coalesce(
            nullif(btrim(a.normalized_data -> 'tags' ->> 'name:my'), ''),
            nullif(btrim(a.normalized_data -> 'tags' ->> 'name:mm'), ''),
            case
                when nullif(btrim(a.normalized_data -> 'tags' ->> 'name'), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(a.normalized_data -> 'tags' ->> 'name'), '')
                else null
            end,
            case
                when nullif(btrim(a.canonical_name), '') ~ '[\x{1000}-\x{109F}]'
                    then nullif(btrim(a.canonical_name), '')
                else null
            end
        ) as source_imported_mm,
        coalesce(
            nullif(btrim(a.canonical_name), ''),
            nullif(btrim(a.normalized_data -> 'tags' ->> 'name'), '')
        ) as legacy_list_en_fallback,
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'admin_area_candidates'
              and e.candidate_id = a.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        ) as has_audit_name_en_edit
    from import_review.admin_area_candidates a
),
family_metrics as (
    select
        'place_candidates'::text as candidate_table,
        count(*)::bigint as total_rows,
        count(*) filter (where nullif(btrim(name_mm), '') is not null)::bigint as rows_name_mm,
        count(*) filter (where nullif(btrim(name_en), '') is not null)::bigint as rows_name_en,
        count(*) filter (where nullif(btrim(canonical_name), '') is not null)::bigint as rows_canonical_name,
        count(*) filter (where nullif(btrim(display_name), '') is not null)::bigint as rows_display_name,
        count(*) filter (where nullif(btrim(primary_name), '') is not null)::bigint as rows_primary_name,
        count(*) filter (where tags_name is not null)::bigint as rows_tags_name,
        count(*) filter (
            where nullif(btrim(name_mm), '') is not null
              and source_imported_mm is not null
              and btrim(name_mm) = source_imported_mm
        )::bigint as rows_name_mm_equals_source,
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and source_imported_name is not null
              and btrim(name_en) = source_imported_name
        )::bigint as rows_name_en_equals_source,
        count(*) filter (
            where nullif(btrim(name_mm), '') ~ '[A-Za-z]'
        )::bigint as rows_name_mm_has_ascii,
        count(*) filter (
            where nullif(btrim(name_en), '') ~ '[\x{1000}-\x{109F}]'
        )::bigint as rows_name_en_has_myanmar,
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        )::bigint as rows_typed_en_differs_from_legacy_list_fallback,
        count(*) filter (
            where has_audit_name_en_edit
              and nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        )::bigint as rows_audit_name_en_edit_legacy_list_mismatch
    from place_enriched

    union all

    select
        'building_candidates',
        count(*)::bigint,
        count(*) filter (where nullif(btrim(name_mm), '') is not null),
        count(*) filter (where nullif(btrim(name_en), '') is not null),
        count(*) filter (where nullif(btrim(canonical_name), '') is not null),
        0::bigint,
        0::bigint,
        count(*) filter (where tags_name is not null),
        count(*) filter (
            where nullif(btrim(name_mm), '') is not null
              and source_imported_mm is not null
              and btrim(name_mm) = source_imported_mm
        ),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and source_imported_name is not null
              and btrim(name_en) = source_imported_name
        ),
        count(*) filter (where nullif(btrim(name_mm), '') ~ '[A-Za-z]'),
        count(*) filter (where nullif(btrim(name_en), '') ~ '[\x{1000}-\x{109F}]'),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        ),
        count(*) filter (
            where has_audit_name_en_edit
              and nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        )
    from building_enriched

    union all

    select
        'road_candidates',
        count(*)::bigint,
        count(*) filter (where nullif(btrim(name_mm), '') is not null),
        count(*) filter (where nullif(btrim(name_en), '') is not null),
        count(*) filter (where nullif(btrim(canonical_name), '') is not null),
        0::bigint,
        0::bigint,
        count(*) filter (where tags_name is not null),
        count(*) filter (
            where nullif(btrim(name_mm), '') is not null
              and source_imported_mm is not null
              and btrim(name_mm) = source_imported_mm
        ),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and source_imported_name is not null
              and btrim(name_en) = source_imported_name
        ),
        count(*) filter (where nullif(btrim(name_mm), '') ~ '[A-Za-z]'),
        count(*) filter (where nullif(btrim(name_en), '') ~ '[\x{1000}-\x{109F}]'),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        ),
        count(*) filter (
            where has_audit_name_en_edit
              and nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        )
    from road_enriched

    union all

    select
        'landuse_candidates',
        count(*)::bigint,
        count(*) filter (where nullif(btrim(name_mm), '') is not null),
        count(*) filter (where nullif(btrim(name_en), '') is not null),
        count(*) filter (where nullif(btrim(canonical_name), '') is not null),
        0::bigint,
        0::bigint,
        count(*) filter (where tags_name is not null),
        count(*) filter (
            where nullif(btrim(name_mm), '') is not null
              and source_imported_mm is not null
              and btrim(name_mm) = source_imported_mm
        ),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and source_imported_name is not null
              and btrim(name_en) = source_imported_name
        ),
        count(*) filter (where nullif(btrim(name_mm), '') ~ '[A-Za-z]'),
        count(*) filter (where nullif(btrim(name_en), '') ~ '[\x{1000}-\x{109F}]'),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        ),
        count(*) filter (
            where has_audit_name_en_edit
              and nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        )
    from landuse_enriched

    union all

    select
        'water_line_candidates',
        count(*)::bigint,
        count(*) filter (where nullif(btrim(name_mm), '') is not null),
        count(*) filter (where nullif(btrim(name_en), '') is not null),
        count(*) filter (where nullif(btrim(canonical_name), '') is not null),
        0::bigint,
        0::bigint,
        count(*) filter (where tags_name is not null),
        count(*) filter (
            where nullif(btrim(name_mm), '') is not null
              and source_imported_mm is not null
              and btrim(name_mm) = source_imported_mm
        ),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and source_imported_name is not null
              and btrim(name_en) = source_imported_name
        ),
        count(*) filter (where nullif(btrim(name_mm), '') ~ '[A-Za-z]'),
        count(*) filter (where nullif(btrim(name_en), '') ~ '[\x{1000}-\x{109F}]'),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        ),
        count(*) filter (
            where has_audit_name_en_edit
              and nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        )
    from water_line_enriched

    union all

    select
        'water_polygon_candidates',
        count(*)::bigint,
        count(*) filter (where nullif(btrim(name_mm), '') is not null),
        count(*) filter (where nullif(btrim(name_en), '') is not null),
        count(*) filter (where nullif(btrim(canonical_name), '') is not null),
        0::bigint,
        0::bigint,
        count(*) filter (where tags_name is not null),
        count(*) filter (
            where nullif(btrim(name_mm), '') is not null
              and source_imported_mm is not null
              and btrim(name_mm) = source_imported_mm
        ),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and source_imported_name is not null
              and btrim(name_en) = source_imported_name
        ),
        count(*) filter (where nullif(btrim(name_mm), '') ~ '[A-Za-z]'),
        count(*) filter (where nullif(btrim(name_en), '') ~ '[\x{1000}-\x{109F}]'),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        ),
        count(*) filter (
            where has_audit_name_en_edit
              and nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        )
    from water_polygon_enriched

    union all

    select
        'admin_area_candidates',
        count(*)::bigint,
        count(*) filter (where nullif(btrim(name_mm), '') is not null),
        count(*) filter (where nullif(btrim(name_en), '') is not null),
        count(*) filter (where nullif(btrim(canonical_name), '') is not null),
        0::bigint,
        0::bigint,
        count(*) filter (where tags_name is not null),
        count(*) filter (
            where nullif(btrim(name_mm), '') is not null
              and source_imported_mm is not null
              and btrim(name_mm) = source_imported_mm
        ),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and source_imported_name is not null
              and btrim(name_en) = source_imported_name
        ),
        count(*) filter (where nullif(btrim(name_mm), '') ~ '[A-Za-z]'),
        count(*) filter (where nullif(btrim(name_en), '') ~ '[\x{1000}-\x{109F}]'),
        count(*) filter (
            where nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        ),
        count(*) filter (
            where has_audit_name_en_edit
              and nullif(btrim(name_en), '') is not null
              and legacy_list_en_fallback is not null
              and btrim(name_en) is distinct from legacy_list_en_fallback
        )
    from admin_area_enriched
)
select
    candidate_table,
    total_rows,
    rows_name_mm,
    rows_name_en,
    rows_canonical_name,
    rows_display_name,
    rows_primary_name,
    rows_tags_name,
    rows_name_mm_equals_source,
    rows_name_en_equals_source,
    rows_name_mm_has_ascii,
    rows_name_en_has_myanmar,
    rows_typed_en_differs_from_legacy_list_fallback,
    rows_audit_name_en_edit_legacy_list_mismatch,
    round(100.0 * rows_name_mm / nullif(total_rows, 0), 2) as pct_name_mm,
    round(100.0 * rows_name_en / nullif(total_rows, 0), 2) as pct_name_en,
    round(100.0 * rows_typed_en_differs_from_legacy_list_fallback / nullif(total_rows, 0), 2)
        as pct_legacy_list_en_mismatch
from family_metrics
order by candidate_table;


-- -----------------------------------------------------------------------------
-- 1b) Optional: filter summary to one batch (uncomment and set id)
-- -----------------------------------------------------------------------------
-- Repeat section 1 CTEs with:  and review_batch_id = 2  on each base table.


-- -----------------------------------------------------------------------------
-- 2) Suspicious sample rows (50 total, highest suspicion first)
-- -----------------------------------------------------------------------------
-- Flags: script_mix | typed_equals_source | legacy_list_mismatch | canonical_drift
--        | typed_empty_source_present | audit_name_en_edit

with
all_candidates as (
    select
        'place_candidates'::text as candidate_table,
        p.id,
        p.review_batch_id,
        p.external_id,
        p.updated_at,
        nullif(btrim(p.name_mm), '') as name_mm,
        nullif(btrim(p.name_en), '') as name_en,
        nullif(btrim(p.canonical_name), '') as canonical_name,
        nullif(btrim(p.display_name), '') as display_name,
        nullif(btrim(p.primary_name), '') as primary_name,
        null::text as legacy_name,
        nullif(btrim(p.normalized_data -> 'tags' ->> 'name'), '') as tags_name,
        coalesce(
            nullif(btrim(p.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(p.primary_name), ''),
            nullif(btrim(p.display_name), ''),
            nullif(btrim(p.canonical_name), '')
        ) as source_imported_name,
        coalesce(
            nullif(btrim(p.canonical_name), ''),
            nullif(btrim(p.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(p.primary_name), ''),
            nullif(btrim(p.display_name), '')
        ) as legacy_list_en_fallback,
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'place_candidates'
              and e.candidate_id = p.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        ) as has_audit_name_en_edit
    from import_review.place_candidates p

    union all

    select
        'building_candidates',
        b.id,
        b.review_batch_id,
        b.external_id,
        b.updated_at,
        nullif(btrim(b.name_mm), ''),
        nullif(btrim(b.name_en), ''),
        nullif(btrim(b.canonical_name), ''),
        null::text,
        null::text,
        nullif(btrim(b.name), ''),
        nullif(btrim(b.normalized_data -> 'tags' ->> 'name'), ''),
        coalesce(
            nullif(btrim(b.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(b.canonical_name), ''),
            nullif(btrim(b.name), '')
        ),
        coalesce(
            nullif(btrim(b.canonical_name), ''),
            nullif(btrim(b.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(b.name), '')
        ),
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'building_candidates'
              and e.candidate_id = b.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        )
    from import_review.building_candidates b

    union all

    select
        'road_candidates',
        r.id,
        r.review_batch_id,
        r.external_id,
        r.updated_at,
        nullif(btrim(r.name_mm), ''),
        nullif(btrim(r.name_en), ''),
        nullif(btrim(r.canonical_name), ''),
        null::text,
        null::text,
        null::text,
        nullif(btrim(r.normalized_data -> 'tags' ->> 'name'), ''),
        coalesce(
            nullif(btrim(r.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(r.canonical_name), '')
        ),
        coalesce(
            nullif(btrim(r.canonical_name), ''),
            nullif(btrim(r.normalized_data -> 'tags' ->> 'name'), '')
        ),
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'road_candidates'
              and e.candidate_id = r.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        )
    from import_review.road_candidates r

    union all

    select
        'landuse_candidates',
        l.id,
        l.review_batch_id,
        l.external_id,
        l.updated_at,
        nullif(btrim(l.name_mm), ''),
        nullif(btrim(l.name_en), ''),
        nullif(btrim(l.canonical_name), ''),
        null::text,
        null::text,
        nullif(btrim(l.name), ''),
        nullif(btrim(l.normalized_data -> 'tags' ->> 'name'), ''),
        coalesce(
            nullif(btrim(l.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(l.canonical_name), ''),
            nullif(btrim(l.name), '')
        ),
        coalesce(
            nullif(btrim(l.canonical_name), ''),
            nullif(btrim(l.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(l.name), '')
        ),
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'landuse_candidates'
              and e.candidate_id = l.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        )
    from import_review.landuse_candidates l

    union all

    select
        'water_line_candidates',
        w.id,
        w.review_batch_id,
        w.external_id,
        w.updated_at,
        nullif(btrim(w.name_mm), ''),
        nullif(btrim(w.name_en), ''),
        nullif(btrim(w.canonical_name), ''),
        null::text,
        null::text,
        nullif(btrim(w.name), ''),
        nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
        coalesce(
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(w.canonical_name), ''),
            nullif(btrim(w.name), '')
        ),
        coalesce(
            nullif(btrim(w.canonical_name), ''),
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(w.name), '')
        ),
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'water_line_candidates'
              and e.candidate_id = w.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        )
    from import_review.water_line_candidates w

    union all

    select
        'water_polygon_candidates',
        w.id,
        w.review_batch_id,
        w.external_id,
        w.updated_at,
        nullif(btrim(w.name_mm), ''),
        nullif(btrim(w.name_en), ''),
        nullif(btrim(w.canonical_name), ''),
        null::text,
        null::text,
        nullif(btrim(w.name), ''),
        nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
        coalesce(
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(w.canonical_name), ''),
            nullif(btrim(w.name), '')
        ),
        coalesce(
            nullif(btrim(w.canonical_name), ''),
            nullif(btrim(w.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(w.name), '')
        ),
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'water_polygon_candidates'
              and e.candidate_id = w.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        )
    from import_review.water_polygon_candidates w

    union all

    select
        'admin_area_candidates',
        a.id,
        a.review_batch_id,
        a.external_id,
        a.updated_at,
        nullif(btrim(a.name_mm), ''),
        nullif(btrim(a.name_en), ''),
        nullif(btrim(a.canonical_name), ''),
        null::text,
        null::text,
        null::text,
        nullif(btrim(a.normalized_data -> 'tags' ->> 'name'), ''),
        coalesce(
            nullif(btrim(a.normalized_data -> 'tags' ->> 'name'), ''),
            nullif(btrim(a.canonical_name), '')
        ),
        coalesce(
            nullif(btrim(a.canonical_name), ''),
            nullif(btrim(a.normalized_data -> 'tags' ->> 'name'), '')
        ),
        exists (
            select 1
            from import_review.review_candidate_edits e
            where e.candidate_table = 'admin_area_candidates'
              and e.candidate_id = a.id
              and e.edit_type = 'override_update'
              and e.after_data ? 'name_en'
              and coalesce(e.after_data ->> 'name_en', '')
                  is distinct from coalesce(e.before_data ->> 'name_en', '')
        )
    from import_review.admin_area_candidates a
),
scored as (
    select
        c.*,
        (
            case when c.name_mm ~ '[A-Za-z]' then 4 else 0 end
            + case when c.name_en ~ '[\x{1000}-\x{109F}]' then 4 else 0 end
            + case
                when c.name_en is not null
                 and c.legacy_list_en_fallback is not null
                 and c.name_en is distinct from c.legacy_list_en_fallback
                    then 6
                else 0
              end
            + case when c.has_audit_name_en_edit then 3 else 0 end
            + case
                when c.name_en is not null
                 and c.source_imported_name is not null
                 and c.name_en = c.source_imported_name
                    then 1
                else 0
              end
            + case
                when c.name_mm is null
                 and c.name_en is null
                 and c.source_imported_name is not null
                    then 2
                else 0
              end
            + case
                when c.name_en is not null
                 and c.canonical_name is not null
                 and c.name_en is distinct from c.canonical_name
                 and c.canonical_name = c.tags_name
                    then 2
                else 0
              end
        ) as suspicion_score,
        array_remove(
            array[
                case when c.name_mm ~ '[A-Za-z]' then 'script_mix_mm_ascii' end,
                case when c.name_en ~ '[\x{1000}-\x{109F}]' then 'script_mix_en_myanmar' end,
                case
                    when c.name_en is not null
                     and c.legacy_list_en_fallback is not null
                     and c.name_en is distinct from c.legacy_list_en_fallback
                        then 'legacy_list_en_mismatch'
                end,
                case when c.has_audit_name_en_edit then 'audit_name_en_edit' end,
                case
                    when c.name_en is not null
                     and c.source_imported_name is not null
                     and c.name_en = c.source_imported_name
                        then 'typed_en_equals_source'
                end,
                case
                    when c.name_mm is null
                     and c.name_en is null
                     and c.source_imported_name is not null
                        then 'typed_empty_source_present'
                end,
                case
                    when c.name_en is not null
                     and c.canonical_name is not null
                     and c.name_en is distinct from c.canonical_name
                     and c.canonical_name = c.tags_name
                        then 'canonical_still_osm_tags_name'
                end
            ],
            null
        ) as suspicion_flags
    from all_candidates c
    where
        c.name_mm ~ '[A-Za-z]'
        or c.name_en ~ '[\x{1000}-\x{109F}]'
        or (
            c.name_en is not null
            and c.legacy_list_en_fallback is not null
            and c.name_en is distinct from c.legacy_list_en_fallback
        )
        or c.has_audit_name_en_edit
        or (
            c.name_mm is null
            and c.name_en is null
            and c.source_imported_name is not null
        )
        or (
            c.name_en is not null
            and c.source_imported_name is not null
            and c.name_en = c.source_imported_name
        )
)
select
    candidate_table,
    id,
    review_batch_id,
    external_id,
    updated_at,
    suspicion_score,
    suspicion_flags,
    name_mm,
    name_en,
    canonical_name,
    display_name,
    primary_name,
    legacy_name,
    tags_name,
    source_imported_name,
    legacy_list_en_fallback,
    has_audit_name_en_edit
from scored
order by suspicion_score desc, updated_at desc nulls last, candidate_table, id
limit 50;


-- -----------------------------------------------------------------------------
-- 3) Recent direct-edit name_en audit trail (optional, last 7 days)
-- -----------------------------------------------------------------------------
select
    e.created_at,
    e.candidate_table,
    e.candidate_id,
    e.review_batch_id,
    e.before_data ->> 'name_en' as before_name_en,
    e.after_data ->> 'name_en' as after_name_en,
    c.name_en as current_name_en,
    c.canonical_name as current_canonical_name,
    nullif(btrim(c.normalized_data -> 'tags' ->> 'name'), '') as current_tags_name
from import_review.review_candidate_edits e
left join lateral (
    select p.name_en, p.canonical_name, p.normalized_data
    from import_review.place_candidates p
    where e.candidate_table = 'place_candidates' and p.id = e.candidate_id
    union all
    select b.name_en, b.canonical_name, b.normalized_data
    from import_review.building_candidates b
    where e.candidate_table = 'building_candidates' and b.id = e.candidate_id
    union all
    select r.name_en, r.canonical_name, r.normalized_data
    from import_review.road_candidates r
    where e.candidate_table = 'road_candidates' and r.id = e.candidate_id
    union all
    select l.name_en, l.canonical_name, l.normalized_data
    from import_review.landuse_candidates l
    where e.candidate_table = 'landuse_candidates' and l.id = e.candidate_id
    union all
    select wl.name_en, wl.canonical_name, wl.normalized_data
    from import_review.water_line_candidates wl
    where e.candidate_table = 'water_line_candidates' and wl.id = e.candidate_id
    union all
    select wp.name_en, wp.canonical_name, wp.normalized_data
    from import_review.water_polygon_candidates wp
    where e.candidate_table = 'water_polygon_candidates' and wp.id = e.candidate_id
    union all
    select a.name_en, a.canonical_name, a.normalized_data
    from import_review.admin_area_candidates a
    where e.candidate_table = 'admin_area_candidates' and a.id = e.candidate_id
    limit 1
) c on true
where e.edit_type = 'override_update'
  and e.after_data ? 'name_en'
  and coalesce(e.after_data ->> 'name_en', '')
      is distinct from coalesce(e.before_data ->> 'name_en', '')
  and e.created_at >= now() - interval '7 days'
order by e.created_at desc
limit 100;
