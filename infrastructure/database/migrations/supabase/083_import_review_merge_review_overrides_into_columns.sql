-- =============================================================================
-- Supabase migration 083: merge review_overrides into typed columns (Phase 2)
-- =============================================================================
--
-- Prerequisites: 082 (archive), 082a (column alignment).
--
-- Policy:
--   - Merge only from review_overrides (not normalized_data).
--   - Legacy keys: name_local -> name_mm; name -> name_mm (Myanmar) or name_en.
--   - waterway_class / water_class -> class_code; poi_category_id -> category_id.
--   - Geometry: GeoJSON object only (jsonb_typeof = 'object').
--   - Does NOT clear review_overrides (Phase 8+); archive unchanged.
--
-- Rollback: restore columns from review_overrides_archive JSON (per key) before
--   new edits; see docs/import-review/review-overrides-inventory-report.md.
--
-- Verify: 003 (quick) or 004 (Phase 3 gate — required before Phase 4 API)
--
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Shared SQL expressions (inline macros via functions in txn)
-- -----------------------------------------------------------------------------

create or replace function import_review._merge_ov_text(ov jsonb, k text)
returns text
language sql
immutable
as $$
    select nullif(trim(ov ->> k), '');
$$;

create or replace function import_review._merge_ov_bigint(ov jsonb, k text)
returns bigint
language sql
immutable
as $$
    select case
        when ov ? k and (ov ->> k) ~ '^[0-9]+$' then (ov ->> k)::bigint
        else null::bigint
    end;
$$;

-- Only return override bigint when it exists in the referenced table (avoids FK violations).
create or replace function import_review._merge_ov_bigint_fk(
    ov jsonb,
    k text,
    ref_table regclass
)
returns bigint
language plpgsql
stable
as $$
declare
    v bigint;
    ok boolean;
begin
    v := import_review._merge_ov_bigint(ov, k);
    if v is null then
        return null;
    end if;
    execute format('select exists (select 1 from %s where id = $1)', ref_table)
        into ok
        using v;
    if ok then
        return v;
    end if;
    return null;
end;
$$;

create or replace function import_review._merge_ov_numeric(ov jsonb, k text)
returns numeric
language sql
immutable
as $$
    select case
        when ov ? k and (ov ->> k) ~ '^-?[0-9]+(\.[0-9]+)?$' then (ov ->> k)::numeric
        else null::numeric
    end;
$$;

create or replace function import_review._merge_ov_bool(ov jsonb, k text)
returns boolean
language sql
immutable
as $$
    select case
        when not (ov ? k) then null::boolean
        when ov ->> k in ('true', '1', 't', 'yes') then true
        when ov ->> k in ('false', '0', 'f', 'no') then false
        else null::boolean
    end;
$$;

create or replace function import_review._merge_name_mm(ov jsonb)
returns text
language sql
immutable
as $$
    select nullif(
        trim(
            coalesce(
                nullif(ov ->> 'name_mm', ''),
                case when ov ? 'name_local' then nullif(ov ->> 'name_local', '') end,
                case
                    when ov ? 'name'
                         and nullif(trim(ov ->> 'name'), '') is not null
                         and trim(ov ->> 'name') ~ '[\u1000-\u109F]'
                        then trim(ov ->> 'name')
                end
            )
        ),
        ''
    );
$$;

create or replace function import_review._merge_name_en(ov jsonb)
returns text
language sql
immutable
as $$
    select nullif(
        trim(
            coalesce(
                nullif(ov ->> 'name_en', ''),
                case
                    when ov ? 'name'
                         and nullif(trim(ov ->> 'name'), '') is not null
                         and trim(ov ->> 'name') !~ '[\u1000-\u109F]'
                        then trim(ov ->> 'name')
                end
            )
        ),
        ''
    );
$$;

create or replace function import_review._geom_from_override(ov jsonb, k text)
returns geometry
language sql
immutable
as $$
    select case
        when ov ? k
             and jsonb_typeof(ov -> k) = 'object'
            then st_setsrid(st_geomfromgeojson(ov -> k), 4326)
        else null::geometry
    end;
$$;

-- -----------------------------------------------------------------------------
-- buildings
-- -----------------------------------------------------------------------------
update import_review.building_candidates as c
set
    name_mm = coalesce(import_review._merge_name_mm(c.review_overrides), c.name_mm),
    name_en = coalesce(import_review._merge_name_en(c.review_overrides), c.name_en),
    building_type_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'building_type_id',
            'ref.ref_building_types'::regclass
        ),
        c.building_type_id
    ),
    admin_area_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'admin_area_id',
            'core.core_admin_areas'::regclass
        ),
        c.admin_area_id
    ),
    levels = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'levels')::integer,
        c.levels
    ),
    height_m = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'height_m'),
        c.height_m
    ),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    ),
    geom = coalesce(import_review._geom_from_override(c.review_overrides, 'geom'), c.geom)
where c.review_overrides <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- places
-- -----------------------------------------------------------------------------
update import_review.place_candidates as c
set
    name_mm = coalesce(import_review._merge_name_mm(c.review_overrides), c.name_mm),
    name_en = coalesce(import_review._merge_name_en(c.review_overrides), c.name_en),
    primary_name = coalesce(
        import_review._merge_ov_text(c.review_overrides, 'primary_name'),
        import_review._merge_ov_text(c.review_overrides, 'display_name'),
        import_review._merge_name_en(c.review_overrides),
        import_review._merge_name_mm(c.review_overrides),
        import_review._merge_ov_text(c.review_overrides, 'name'),
        import_review._merge_ov_text(c.review_overrides, 'canonical_name'),
        c.primary_name
    ),
    display_name = coalesce(
        import_review._merge_ov_text(c.review_overrides, 'display_name'),
        import_review._merge_ov_text(c.review_overrides, 'primary_name'),
        import_review._merge_name_en(c.review_overrides),
        import_review._merge_name_mm(c.review_overrides),
        import_review._merge_ov_text(c.review_overrides, 'name'),
        c.display_name,
        c.primary_name
    ),
    category_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'category_id',
            'ref.ref_poi_categories'::regclass
        ),
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'poi_category_id',
            'ref.ref_poi_categories'::regclass
        ),
        c.category_id
    ),
    admin_area_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'admin_area_id',
            'core.core_admin_areas'::regclass
        ),
        c.admin_area_id
    ),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    ),
    importance_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'importance_score'),
        c.importance_score
    ),
    popularity_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'popularity_score'),
        c.popularity_score
    ),
    point_geom = coalesce(
        import_review._geom_from_override(c.review_overrides, 'point_geom'),
        import_review._geom_from_override(c.review_overrides, 'geom'),
        c.point_geom
    )
where c.review_overrides <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- roads
-- -----------------------------------------------------------------------------
update import_review.road_candidates as c
set
    name_mm = coalesce(import_review._merge_name_mm(c.review_overrides), c.name_mm),
    name_en = coalesce(import_review._merge_name_en(c.review_overrides), c.name_en),
    canonical_name = coalesce(
        import_review._merge_name_en(c.review_overrides),
        import_review._merge_name_mm(c.review_overrides),
        import_review._merge_ov_text(c.review_overrides, 'canonical_name'),
        c.canonical_name
    ),
    road_class_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'road_class_id',
            'ref.ref_road_classes'::regclass
        ),
        c.road_class_id
    ),
    admin_area_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'admin_area_id',
            'core.core_admin_areas'::regclass
        ),
        c.admin_area_id
    ),
    surface = coalesce(import_review._merge_ov_text(c.review_overrides, 'surface'), c.surface),
    is_oneway = coalesce(import_review._merge_ov_bool(c.review_overrides, 'is_oneway'), c.is_oneway),
    bridge = coalesce(import_review._merge_ov_bool(c.review_overrides, 'bridge'), c.bridge),
    tunnel = coalesce(import_review._merge_ov_bool(c.review_overrides, 'tunnel'), c.tunnel),
    layer = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'layer')::integer,
        c.layer
    ),
    access = coalesce(import_review._merge_ov_text(c.review_overrides, 'access'), c.access),
    speed_kph = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'speed_kph'),
        c.speed_kph
    ),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    ),
    geom = coalesce(import_review._geom_from_override(c.review_overrides, 'geom'), c.geom)
where c.review_overrides <> '{}'::jsonb;

update import_review.road_candidates as c
set length_m = round(st_length(c.geom::geography)::numeric, 2)
where c.geom is not null
  and not st_isempty(c.geom)
  and c.review_overrides ? 'geom'
  and jsonb_typeof(c.review_overrides -> 'geom') = 'object';

-- -----------------------------------------------------------------------------
-- admin_areas
-- -----------------------------------------------------------------------------
update import_review.admin_area_candidates as c
set
    name_mm = coalesce(import_review._merge_name_mm(c.review_overrides), c.name_mm),
    name_en = coalesce(import_review._merge_name_en(c.review_overrides), c.name_en),
    admin_level_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'admin_level_id',
            'ref.ref_admin_levels'::regclass
        ),
        c.admin_level_id
    ),
    parent_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'parent_id',
            'core.core_admin_areas'::regclass
        ),
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'parent_admin_area_id',
            'core.core_admin_areas'::regclass
        ),
        c.parent_id
    ),
    slug = coalesce(import_review._merge_ov_text(c.review_overrides, 'slug'), c.slug),
    geom = coalesce(import_review._geom_from_override(c.review_overrides, 'geom'), c.geom)
where c.review_overrides <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- bus_stops (review-only)
-- -----------------------------------------------------------------------------
update import_review.bus_stop_candidates as c
set
    name_mm = coalesce(import_review._merge_name_mm(c.review_overrides), c.name_mm),
    name_en = coalesce(import_review._merge_name_en(c.review_overrides), c.name_en),
    stop_code = coalesce(import_review._merge_ov_text(c.review_overrides, 'stop_code'), c.stop_code),
    admin_area_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'admin_area_id',
            'core.core_admin_areas'::regclass
        ),
        c.admin_area_id
    ),
    geom = coalesce(import_review._geom_from_override(c.review_overrides, 'geom'), c.geom)
where c.review_overrides <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- bus_routes (review-only)
-- -----------------------------------------------------------------------------
update import_review.bus_route_candidates as c
set
    name_mm = coalesce(import_review._merge_name_mm(c.review_overrides), c.name_mm),
    name_en = coalesce(import_review._merge_name_en(c.review_overrides), c.name_en),
    route_code = coalesce(import_review._merge_ov_text(c.review_overrides, 'route_code'), c.route_code),
    public_name = coalesce(import_review._merge_ov_text(c.review_overrides, 'public_name'), c.public_name),
    operator_name = coalesce(
        import_review._merge_ov_text(c.review_overrides, 'operator_name'),
        c.operator_name
    ),
    route_type = coalesce(import_review._merge_ov_text(c.review_overrides, 'route_type'), c.route_type),
    directionality = coalesce(
        import_review._merge_ov_text(c.review_overrides, 'directionality'),
        c.directionality
    ),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    )
where c.review_overrides <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- addresses
-- -----------------------------------------------------------------------------
update import_review.address_candidates as c
set
    full_address = coalesce(import_review._merge_ov_text(c.review_overrides, 'full_address'), c.full_address),
    house_number = coalesce(import_review._merge_ov_text(c.review_overrides, 'house_number'), c.house_number),
    street_name = coalesce(import_review._merge_ov_text(c.review_overrides, 'street_name'), c.street_name),
    street_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'street_id',
            'core.core_streets'::regclass
        ),
        c.street_id
    ),
    quarter = coalesce(import_review._merge_ov_text(c.review_overrides, 'quarter'), c.quarter),
    township = coalesce(import_review._merge_ov_text(c.review_overrides, 'township'), c.township),
    city = coalesce(import_review._merge_ov_text(c.review_overrides, 'city'), c.city),
    postcode = coalesce(import_review._merge_ov_text(c.review_overrides, 'postcode'), c.postcode),
    plus_code = coalesce(import_review._merge_ov_text(c.review_overrides, 'plus_code'), c.plus_code),
    admin_area_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'admin_area_id',
            'core.core_admin_areas'::regclass
        ),
        c.admin_area_id
    ),
    point_geom = coalesce(
        import_review._geom_from_override(c.review_overrides, 'point_geom'),
        import_review._geom_from_override(c.review_overrides, 'geom'),
        c.point_geom
    )
where c.review_overrides <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- landuse / water (no rows with overrides today; safe for future)
-- -----------------------------------------------------------------------------
update import_review.landuse_candidates as c
set
    name_mm = coalesce(import_review._merge_name_mm(c.review_overrides), c.name_mm),
    name_en = coalesce(import_review._merge_name_en(c.review_overrides), c.name_en),
    class_code = coalesce(import_review._merge_ov_text(c.review_overrides, 'class_code'), c.class_code),
    landuse_class_id = coalesce(
        import_review._merge_ov_bigint_fk(
            c.review_overrides,
            'landuse_class_id',
            'ref.ref_landuse_classes'::regclass
        ),
        c.landuse_class_id
    ),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    ),
    geom = coalesce(import_review._geom_from_override(c.review_overrides, 'geom'), c.geom)
where c.review_overrides <> '{}'::jsonb;

update import_review.water_line_candidates as c
set
    name_mm = coalesce(import_review._merge_name_mm(c.review_overrides), c.name_mm),
    name_en = coalesce(import_review._merge_name_en(c.review_overrides), c.name_en),
    class_code = coalesce(
        import_review._merge_ov_text(c.review_overrides, 'waterway_class'),
        import_review._merge_ov_text(c.review_overrides, 'class_code'),
        c.class_code
    ),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    ),
    geom = coalesce(import_review._geom_from_override(c.review_overrides, 'geom'), c.geom)
where c.review_overrides <> '{}'::jsonb;

update import_review.water_polygon_candidates as c
set
    name_mm = coalesce(import_review._merge_name_mm(c.review_overrides), c.name_mm),
    name_en = coalesce(import_review._merge_name_en(c.review_overrides), c.name_en),
    class_code = coalesce(
        import_review._merge_ov_text(c.review_overrides, 'water_class'),
        import_review._merge_ov_text(c.review_overrides, 'class_code'),
        c.class_code
    ),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    ),
    geom = coalesce(import_review._geom_from_override(c.review_overrides, 'geom'), c.geom)
where c.review_overrides <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- bus_route_variants / bus_route_stops (when populated)
-- -----------------------------------------------------------------------------
update import_review.bus_route_variant_candidates as c
set
    route_id = coalesce(import_review._merge_ov_bigint(c.review_overrides, 'route_id'), c.route_id),
    route_code = coalesce(import_review._merge_ov_text(c.review_overrides, 'route_code'), c.route_code),
    variant_code = coalesce(import_review._merge_ov_text(c.review_overrides, 'variant_code'), c.variant_code),
    direction_name = coalesce(
        import_review._merge_ov_text(c.review_overrides, 'direction_name'),
        c.direction_name
    ),
    origin_name = coalesce(import_review._merge_ov_text(c.review_overrides, 'origin_name'), c.origin_name),
    destination_name = coalesce(
        import_review._merge_ov_text(c.review_overrides, 'destination_name'),
        c.destination_name
    ),
    distance_m = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'distance_m'),
        c.distance_m
    ),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    ),
    geom = coalesce(import_review._geom_from_override(c.review_overrides, 'geom'), c.geom)
where c.review_overrides <> '{}'::jsonb;

update import_review.bus_route_stop_candidates as c
set
    route_variant_id = coalesce(
        import_review._merge_ov_bigint(c.review_overrides, 'route_variant_id'),
        c.route_variant_id
    ),
    stop_id = coalesce(import_review._merge_ov_bigint(c.review_overrides, 'stop_id'), c.stop_id),
    stop_sequence = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'stop_sequence')::integer,
        c.stop_sequence
    ),
    distance_from_start_m = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'distance_from_start_m'),
        c.distance_from_start_m
    ),
    is_timing_point = coalesce(
        import_review._merge_ov_bool(c.review_overrides, 'is_timing_point'),
        c.is_timing_point
    ),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    )
where c.review_overrides <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- routing_barriers
-- -----------------------------------------------------------------------------
update import_review.routing_barrier_candidates as c
set
    barrier_type = coalesce(import_review._merge_ov_text(c.review_overrides, 'barrier_type'), c.barrier_type),
    class_code = coalesce(import_review._merge_ov_text(c.review_overrides, 'class_code'), c.class_code),
    confidence_score = coalesce(
        import_review._merge_ov_numeric(c.review_overrides, 'confidence_score'),
        c.confidence_score
    ),
    point_geom = coalesce(
        import_review._geom_from_override(c.review_overrides, 'geom'),
        import_review._geom_from_override(c.review_overrides, 'point_geom'),
        c.point_geom
    )
where c.review_overrides <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- HS-2 / HS-3 verification (abort on failure)
-- -----------------------------------------------------------------------------

do $$
declare
    n bigint;
begin
    -- buildings.building_type_id (only when override id exists in ref)
    select count(*)::bigint into n
    from import_review.building_candidates as b
    where b.review_overrides ? 'building_type_id'
      and nullif(trim(b.review_overrides ->> 'building_type_id'), '') is not null
      and exists (
          select 1
          from ref.ref_building_types as bt
          where bt.id = (b.review_overrides ->> 'building_type_id')::bigint
      )
      and b.building_type_id is distinct from (b.review_overrides ->> 'building_type_id')::bigint;
    if n > 0 then
        raise exception '083 HS-2: buildings.building_type_id mismatch count=%', n;
    end if;

    -- roads.road_class_id
    select count(*)::bigint into n
    from import_review.road_candidates as r
    where r.review_overrides ? 'road_class_id'
      and nullif(trim(r.review_overrides ->> 'road_class_id'), '') is not null
      and exists (
          select 1
          from ref.ref_road_classes as rc
          where rc.id = (r.review_overrides ->> 'road_class_id')::bigint
      )
      and r.road_class_id is distinct from (r.review_overrides ->> 'road_class_id')::bigint;
    if n > 0 then
        raise exception '083 HS-2: roads.road_class_id mismatch count=%', n;
    end if;

    -- places.category_id (category_id or poi_category_id in overrides)
    select count(*)::bigint into n
    from import_review.place_candidates as p
    where (
        (
            p.review_overrides ? 'category_id'
            and nullif(trim(p.review_overrides ->> 'category_id'), '') is not null
            and exists (
                select 1
                from ref.ref_poi_categories as pc
                where pc.id = (p.review_overrides ->> 'category_id')::bigint
            )
            and p.category_id is distinct from (p.review_overrides ->> 'category_id')::bigint
        )
        or (
            p.review_overrides ? 'poi_category_id'
            and nullif(trim(p.review_overrides ->> 'poi_category_id'), '') is not null
            and exists (
                select 1
                from ref.ref_poi_categories as pc
                where pc.id = (p.review_overrides ->> 'poi_category_id')::bigint
            )
            and p.category_id is distinct from (p.review_overrides ->> 'poi_category_id')::bigint
        )
    );
    if n > 0 then
        raise exception '083 HS-2: places.category_id mismatch count=%', n;
    end if;

    -- informational: overrides with FK ids that do not exist in ref (left in JSON)
    select count(*)::bigint into n
    from import_review.building_candidates as b
    where b.review_overrides ? 'building_type_id'
      and nullif(trim(b.review_overrides ->> 'building_type_id'), '') is not null
      and not exists (
          select 1
          from ref.ref_building_types as bt
          where bt.id = (b.review_overrides ->> 'building_type_id')::bigint
      );
    if n > 0 then
        raise notice '083: % building rows have building_type_id override not in ref.ref_building_types (skipped)', n;
    end if;

    -- HS-3 roads geom
    select count(*)::bigint into n
    from import_review.road_candidates as r
    where r.review_overrides ? 'geom'
      and jsonb_typeof(r.review_overrides -> 'geom') = 'object'
      and (
          r.geom is null
          or not st_equals(
              r.geom,
              st_setsrid(st_geomfromgeojson(r.review_overrides -> 'geom'), 4326)
          )
      );
    if n > 0 then
        raise exception '083 HS-3: roads geom mismatch after merge count=%', n;
    end if;

    raise notice '083: HS-2/HS-3 verification passed.';
end $$;

-- Drop merge helpers (keep schema clean; migration is one-shot)
drop function if exists import_review._geom_from_override(jsonb, text);
drop function if exists import_review._merge_name_en(jsonb);
drop function if exists import_review._merge_name_mm(jsonb);
drop function if exists import_review._merge_ov_bool(jsonb, text);
drop function if exists import_review._merge_ov_numeric(jsonb, text);
drop function if exists import_review._merge_ov_bigint_fk(jsonb, text, regclass);
drop function if exists import_review._merge_ov_bigint(jsonb, text);
drop function if exists import_review._merge_ov_text(jsonb, text);

commit;
