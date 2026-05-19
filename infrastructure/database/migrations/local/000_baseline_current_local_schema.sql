-- =============================================================================
-- BASELINE MIGRATION: current local database schema (documentation / source control)
-- =============================================================================
--
-- Generated from: infrastructure/database/snapshots/local/local_schema_baseline_2026_05_15.sql
-- Source: pg_dump --schema-only of the local PostGIS database (2026-05-15).
--
-- Why this file exists:
--   The project had no prior checked-in baseline migrations for the full local DB.
--   This file records the schema as it existed at capture time (schemas, tables,
--   views, functions, constraints, indexes, PostGIS types).
--
-- DO NOT rely on this for production migrations. Prefer numbered files under migrations/local/ or migrations/supabase/.
-- If executed accidentally on an existing DB, DDL uses IF NOT EXISTS / OR REPLACE and guarded ALTER blocks to skip duplicates.
-- Still avoid running against Supabase or any DB you are not willing to reconcile manually.
--
-- Use this file to:
--   - Diff and review structure in git
--   - Bootstrap a brand-new empty local database only when you intend a full rebuild
--
-- All future schema changes MUST go in new numbered migrations:
--   - infrastructure/database/migrations/local/   (local raw/staging/system workflow)
--   - infrastructure/database/migrations/supabase/ (hosted production DDL)
--
-- Machine-specific pg_dump lines (\restrict, \unrestrict, OWNER, GRANT) removed if present.
-- =============================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 18.3
--
-- pg_dump 18 may emit SET transaction_timeout; PostgreSQL 16 does not support that GUC (line commented out below).
-- Idempotent: CREATE SCHEMA/TABLE/INDEX IF NOT EXISTS; CREATE OR REPLACE VIEW/FUNCTION; ALTER wrapped in duplicate-safe DO blocks.
-- Documentation / source control baseline — not a substitute for incremental migrations.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0;  -- removed: pg_dump 18 only; fails on PostgreSQL 16 (e.g. DBeaver)
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS app;


--
-- Name: app_auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS app_auth;


--
-- Name: core; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS core;


--
-- Name: feedback; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS feedback;


--
-- Name: offline; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS offline;


--
-- Name: ogr_system_tables; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS ogr_system_tables;


--
-- Name: raw; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS raw;


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS realtime;


--
-- Name: ref; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS ref;


--
-- Name: routing; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS routing;


--
-- Name: search; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS search;


--
-- Name: social; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS social;


--
-- Name: staging; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS staging;


--
-- Name: system; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS system;


--
-- Name: tiger; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS tiger;


--
-- Name: tiger_data; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS tiger_data;


--
-- Name: tiles; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS tiles;


--
-- Name: tmp_import; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS tmp_import;


--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS topology;


--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: hstore; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS hstore WITH SCHEMA public;


--
-- Name: EXTENSION hstore; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION hstore IS 'data type for storing sets of (key, value) pairs';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_tiger_geocoder; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;


--
-- Name: EXTENSION postgis_tiger_geocoder; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_tiger_geocoder IS 'PostGIS tiger geocoder and reverse geocoder';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: get_initial_publish_status_id(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.get_initial_publish_status_id() RETURNS bigint
    LANGUAGE sql STABLE
    AS $$
    select p.id
    from ref.ref_publish_statuses as p
    where p.code in ('approved', 'published')
    order by case p.code
        when 'approved' then 1
        when 'published' then 2
        else 99
    end
    limit 1;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: system_source_registry; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_source_registry (
    id bigint NOT NULL,
    source_code text NOT NULL,
    source_name text NOT NULL,
    source_uri text,
    source_type_id bigint NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_source_registry_source_code_chk CHECK ((btrim(source_code) <> ''::text)),
    CONSTRAINT system_source_registry_source_name_chk CHECK ((btrim(source_name) <> ''::text))
);


--
-- Name: get_source_registry_from_snapshot(bigint); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.get_source_registry_from_snapshot(p_source_snapshot_id bigint) RETURNS system.system_source_registry
    LANGUAGE sql STABLE
    AS $$
    select r.*
    from system.system_source_snapshots as s
    join system.system_source_registry as r
        on r.id = s.source_registry_id
    where s.id = p_source_snapshot_id;
$$;


--
-- Name: system_source_snapshots; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_source_snapshots (
    id bigint NOT NULL,
    source_registry_id bigint NOT NULL,
    import_batch_id bigint NOT NULL,
    snapshot_ref text NOT NULL,
    snapshot_version text,
    region_code text,
    checksum text,
    captured_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_source_snapshots_checksum_chk CHECK (((checksum IS NULL) OR (btrim(checksum) <> ''::text))),
    CONSTRAINT system_source_snapshots_region_code_chk CHECK (((region_code IS NULL) OR (btrim(region_code) <> ''::text))),
    CONSTRAINT system_source_snapshots_snapshot_ref_chk CHECK ((btrim(snapshot_ref) <> ''::text)),
    CONSTRAINT system_source_snapshots_snapshot_version_chk CHECK (((snapshot_version IS NULL) OR (btrim(snapshot_version) <> ''::text)))
);


--
-- Name: get_source_snapshot_row(bigint); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.get_source_snapshot_row(p_source_snapshot_id bigint) RETURNS system.system_source_snapshots
    LANGUAGE sql STABLE
    AS $$
    select s.*
    from system.system_source_snapshots as s
    where s.id = p_source_snapshot_id;
$$;


--
-- Name: get_source_type_id_from_snapshot(bigint); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.get_source_type_id_from_snapshot(p_source_snapshot_id bigint) RETURNS bigint
    LANGUAGE sql STABLE
    AS $$
    select r.source_type_id
    from system.system_source_snapshots as s
    join system.system_source_registry as r
        on r.id = s.source_registry_id
    where s.id = p_source_snapshot_id;
$$;


--
-- Name: is_promotable_match_status(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.is_promotable_match_status(p_match_status text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
    select coalesce(lower(btrim(p_match_status)), '') in (
        'approved',
        'publishable',
        'ready_to_publish',
        'published'
    );
$$;


--
-- Name: make_slug(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.make_slug(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    select trim(both '-' from regexp_replace(lower(btrim(p_value)), '[^a-z0-9]+', '-', 'g'));
$$;


--
-- Name: promote_admin_area_candidate(bigint); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.promote_admin_area_candidate(p_candidate_id bigint) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
declare
    v_candidate staging.staging_admin_area_candidates%rowtype;
    v_core_id bigint;
    v_parent_core_id bigint;
    v_source_type_id bigint;
    v_slug text;
begin
    select *
    into v_candidate
    from staging.staging_admin_area_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging admin area candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging admin area candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    v_source_type_id := core.get_source_type_id_from_snapshot(v_candidate.source_snapshot_id);
    if v_source_type_id is null then
        raise exception 'no source_type_id found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    if v_candidate.parent_candidate_id is not null then
        select matched_core_admin_area_id
        into v_parent_core_id
        from staging.staging_admin_area_candidates
        where id = v_candidate.parent_candidate_id;
    else
        v_parent_core_id := null;
    end if;

    v_slug := core.make_slug(v_candidate.canonical_name);

    if v_candidate.matched_core_admin_area_id is not null then
        v_core_id := v_candidate.matched_core_admin_area_id;

        update core.core_admin_areas
        set parent_id = v_parent_core_id,
            admin_level_id = v_candidate.admin_level_id,
            canonical_name = v_candidate.canonical_name,
            slug = v_slug,
            geom = v_candidate.geom,
            centroid = coalesce(v_candidate.centroid, st_centroid(v_candidate.geom)),
            source_type_id = v_source_type_id,
            is_active = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_admin_areas (
            parent_id,
            admin_level_id,
            canonical_name,
            slug,
            geom,
            centroid,
            source_type_id,
            is_active
        )
        values (
            v_parent_core_id,
            v_candidate.admin_level_id,
            v_candidate.canonical_name,
            v_slug,
            v_candidate.geom,
            coalesce(v_candidate.centroid, st_centroid(v_candidate.geom)),
            v_source_type_id,
            true
        )
        returning id into v_core_id;
    end if;

    insert into core.core_admin_area_names (
        admin_area_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary,
        search_weight
    )
    select
        v_core_id,
        v_candidate.canonical_name,
        null,
        null,
        'primary',
        true,
        100
    where not exists (
        select 1
        from core.core_admin_area_names as n
        where n.admin_area_id = v_core_id
          and n.name = v_candidate.canonical_name
          and n.name_type = 'primary'
    );

    update staging.staging_admin_area_candidates
    set matched_core_admin_area_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;


--
-- Name: promote_bus_route_candidate(bigint); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.promote_bus_route_candidate(p_candidate_id bigint) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
declare
    v_candidate staging.staging_bus_route_candidates%rowtype;
    v_source_type_id bigint;
    v_core_id bigint;
    v_variant_id bigint;
    v_variant_code text;
begin
    select *
    into v_candidate
    from staging.staging_bus_route_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging bus route candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging bus route candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    v_source_type_id := core.get_source_type_id_from_snapshot(v_candidate.source_snapshot_id);
    if v_source_type_id is null then
        raise exception 'no source_type_id found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    v_core_id := v_candidate.matched_core_bus_route_id;
    v_variant_code := coalesce(nullif(v_candidate.external_id, ''), v_candidate.route_code || '_v1');

    if v_core_id is not null then
        update core.core_bus_routes
        set route_code = v_candidate.route_code,
            public_name = v_candidate.public_name,
            source_type_id = v_source_type_id,
            is_active = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_bus_routes (
            route_code,
            public_name,
            source_type_id,
            is_active
        )
        values (
            v_candidate.route_code,
            v_candidate.public_name,
            v_source_type_id,
            true
        )
        returning id into v_core_id;
    end if;

    select id
    into v_variant_id
    from core.core_bus_route_variants
    where route_id = v_core_id
      and variant_code = v_variant_code
    order by id desc
    limit 1;

    if v_variant_id is not null then
        update core.core_bus_route_variants
        set geom = v_candidate.geom,
            is_active = true
        where id = v_variant_id;
    else
        insert into core.core_bus_route_variants (
            route_id,
            variant_code,
            geom,
            distance_m,
            is_active
        )
        values (
            v_core_id,
            v_variant_code,
            v_candidate.geom,
            st_length(v_candidate.geom::geography),
            true
        )
        returning id into v_variant_id;
    end if;

    insert into core.core_bus_route_names (
        route_id,
        name,
        language_code,
        name_type,
        is_primary
    )
    select
        v_core_id,
        v_candidate.public_name,
        null,
        'primary',
        true
    where not exists (
        select 1
        from core.core_bus_route_names as n
        where n.route_id = v_core_id
          and n.name = v_candidate.public_name
          and n.name_type = 'primary'
    );

    update staging.staging_bus_route_candidates
    set matched_core_bus_route_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;


--
-- Name: promote_bus_stop_candidate(bigint); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.promote_bus_stop_candidate(p_candidate_id bigint) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
declare
    v_candidate staging.staging_bus_stop_candidates%rowtype;
    v_source_type_id bigint;
    v_core_id bigint;
    v_admin_area_id bigint;
begin
    select *
    into v_candidate
    from staging.staging_bus_stop_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging bus stop candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging bus stop candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    v_source_type_id := core.get_source_type_id_from_snapshot(v_candidate.source_snapshot_id);
    if v_source_type_id is null then
        raise exception 'no source_type_id found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    select a.matched_core_admin_area_id
    into v_admin_area_id
    from staging.staging_admin_area_candidates as a
    where a.id = v_candidate.admin_area_candidate_id;

    v_core_id := v_candidate.matched_core_bus_stop_id;

    if v_core_id is not null then
        update core.core_bus_stops
        set name = v_candidate.canonical_name,
            geom = v_candidate.point_geom,
            admin_area_id = v_admin_area_id,
            source_type_id = v_source_type_id,
            is_active = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_bus_stops (
            name,
            geom,
            admin_area_id,
            source_type_id,
            is_active
        )
        values (
            v_candidate.canonical_name,
            v_candidate.point_geom,
            v_admin_area_id,
            v_source_type_id,
            true
        )
        returning id into v_core_id;
    end if;

    insert into core.core_bus_stop_names (
        stop_id,
        name,
        language_code,
        name_type,
        is_primary
    )
    select
        v_core_id,
        v_candidate.canonical_name,
        null,
        'primary',
        true
    where not exists (
        select 1
        from core.core_bus_stop_names as n
        where n.stop_id = v_core_id
          and n.name = v_candidate.canonical_name
          and n.name_type = 'primary'
    );

    update staging.staging_bus_stop_candidates
    set matched_core_bus_stop_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;


--
-- Name: promote_place_candidate(bigint); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.promote_place_candidate(p_candidate_id bigint) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
declare
    v_candidate staging.staging_place_candidates%rowtype;
    v_source_registry system.system_source_registry%rowtype;
    v_source_snapshot system.system_source_snapshots%rowtype;
    v_core_id bigint;
    v_admin_area_id bigint;
    v_publish_status_id bigint;
    v_lat double precision;
    v_lng double precision;
    v_name_local text;
    v_version_no integer;
    v_version_id bigint;
    v_version_snapshot jsonb;
begin
    select *
    into v_candidate
    from staging.staging_place_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging place candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging place candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    select *
    into v_source_registry
    from core.get_source_registry_from_snapshot(v_candidate.source_snapshot_id);

    if v_source_registry.id is null then
        raise exception 'no source registry found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    select *
    into v_source_snapshot
    from core.get_source_snapshot_row(v_candidate.source_snapshot_id);

    v_publish_status_id := core.get_initial_publish_status_id();
    if v_publish_status_id is null then
        raise exception 'no initial publish status found in ref.ref_publish_statuses';
    end if;

    select a.matched_core_admin_area_id
    into v_admin_area_id
    from staging.staging_admin_area_candidates as a
    where a.id = v_candidate.admin_area_candidate_id;

    v_lat := st_y(v_candidate.point_geom);
    v_lng := st_x(v_candidate.point_geom);

    select pn.name
    into v_name_local
    from staging.staging_place_name_candidates as pn
    where pn.place_candidate_id = v_candidate.id
      and coalesce(pn.script_code, '') <> ''
      and lower(coalesce(pn.script_code, '')) <> 'latn'
    order by pn.is_primary desc, pn.id
    limit 1;

    if v_candidate.matched_core_place_id is not null then
        v_core_id := v_candidate.matched_core_place_id;

        update core.core_places
        set primary_name = v_candidate.canonical_name,
            name_local = coalesce(v_name_local, name_local),
            display_name = v_candidate.canonical_name,
            category_id = v_candidate.poi_category_id,
            admin_area_id = v_admin_area_id,
            point_geom = v_candidate.point_geom,
            lat = v_lat,
            lng = v_lng,
            confidence_score = coalesce(v_candidate.confidence_score, confidence_score),
            source_type_id = v_source_registry.source_type_id,
            publish_status_id = v_publish_status_id,
            is_public = true,
            is_verified = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_places (
            primary_name,
            name_local,
            display_name,
            category_id,
            admin_area_id,
            point_geom,
            lat,
            lng,
            confidence_score,
            is_public,
            is_verified,
            source_type_id,
            publish_status_id
        )
        values (
            v_candidate.canonical_name,
            v_name_local,
            v_candidate.canonical_name,
            v_candidate.poi_category_id,
            v_admin_area_id,
            v_candidate.point_geom,
            v_lat,
            v_lng,
            coalesce(v_candidate.confidence_score, 0),
            true,
            true,
            v_source_registry.source_type_id,
            v_publish_status_id
        )
        returning id into v_core_id;
    end if;

    insert into core.core_place_names (
        place_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary,
        search_weight
    )
    select
        v_core_id,
        pn.name,
        pn.language_code,
        pn.script_code,
        pn.name_type,
        pn.is_primary,
        coalesce(round(pn.search_weight)::integer, 0)
    from staging.staging_place_name_candidates as pn
    where pn.place_candidate_id = v_candidate.id
      and not exists (
          select 1
          from core.core_place_names as cpn
          where cpn.place_id = v_core_id
            and cpn.name = pn.name
            and coalesce(cpn.language_code, '') = coalesce(pn.language_code, '')
            and coalesce(cpn.script_code, '') = coalesce(pn.script_code, '')
            and cpn.name_type = pn.name_type
      );

    insert into core.core_place_names (
        place_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary,
        search_weight
    )
    select
        v_core_id,
        v_candidate.canonical_name,
        null,
        null,
        'primary',
        true,
        100
    where not exists (
        select 1
        from core.core_place_names as cpn
        where cpn.place_id = v_core_id
          and cpn.name = v_candidate.canonical_name
          and cpn.name_type = 'primary'
    );

    insert into core.core_place_sources (
        place_id,
        source_type_id,
        external_id,
        source_name,
        source_url,
        source_priority,
        captured_at,
        raw_payload
    )
    select
        v_core_id,
        v_source_registry.source_type_id,
        v_candidate.external_id,
        v_source_registry.source_name,
        v_source_registry.source_uri,
        0,
        v_source_snapshot.captured_at,
        jsonb_build_object(
            'staging_place_candidate_id', v_candidate.id,
            'source_snapshot_id', v_candidate.source_snapshot_id,
            'source_entity_type', v_candidate.source_entity_type,
            'normalized_data', v_candidate.normalized_data,
            'source_refs', v_candidate.source_refs
        )
    where not exists (
        select 1
        from core.core_place_sources as cps
        where cps.place_id = v_core_id
          and cps.source_type_id = v_source_registry.source_type_id
          and coalesce(cps.external_id, '') = coalesce(v_candidate.external_id, '')
          and cps.source_name = v_source_registry.source_name
    );

    select coalesce(max(version_no), 0) + 1
    into v_version_no
    from core.core_place_versions
    where place_id = v_core_id;

    select jsonb_build_object(
        'place_id', p.id,
        'public_id', p.public_id,
        'primary_name', p.primary_name,
        'secondary_name', p.secondary_name,
        'name_local', p.name_local,
        'display_name', p.display_name,
        'category_id', p.category_id,
        'admin_area_id', p.admin_area_id,
        'lat', p.lat,
        'lng', p.lng,
        'plus_code', p.plus_code,
        'importance_score', p.importance_score,
        'popularity_score', p.popularity_score,
        'confidence_score', p.confidence_score,
        'is_public', p.is_public,
        'is_verified', p.is_verified,
        'source_type_id', p.source_type_id,
        'publish_status_id', p.publish_status_id,
        'point_geom_wkt', st_astext(p.point_geom),
        'entry_geom_wkt', case when p.entry_geom is null then null else st_astext(p.entry_geom) end,
        'footprint_geom_wkt', case when p.footprint_geom is null then null else st_astext(p.footprint_geom) end,
        'staging_place_candidate_id', v_candidate.id,
        'source_snapshot_id', v_candidate.source_snapshot_id
    )
    into v_version_snapshot
    from core.core_places as p
    where p.id = v_core_id;

    insert into core.core_place_versions (
        place_id,
        version_no,
        snapshot_data,
        publish_status_id,
        created_by,
        created_at,
        published_at,
        approved_by
    )
    values (
        v_core_id,
        v_version_no,
        v_version_snapshot,
        v_publish_status_id,
        null,
        now(),
        null,
        null
    )
    returning id into v_version_id;

    update core.core_places
    set current_version_id = v_version_id,
        updated_at = now()
    where id = v_core_id;

    update staging.staging_place_candidates
    set matched_core_place_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;


--
-- Name: promote_road_candidate(bigint); Type: FUNCTION; Schema: core; Owner: -
--

CREATE OR REPLACE FUNCTION core.promote_road_candidate(p_candidate_id bigint) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
declare
    v_candidate staging.staging_road_candidates%rowtype;
    v_source_type_id bigint;
    v_core_id bigint;
begin
    select *
    into v_candidate
    from staging.staging_road_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging road candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging road candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    v_source_type_id := core.get_source_type_id_from_snapshot(v_candidate.source_snapshot_id);
    if v_source_type_id is null then
        raise exception 'no source_type_id found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    v_core_id := v_candidate.matched_core_edge_id;

    if v_core_id is not null then
        update core.core_streets
        set canonical_name = v_candidate.canonical_name,
            geom = v_candidate.geom,
            source_type_id = v_source_type_id,
            is_active = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_streets (
            canonical_name,
            geom,
            source_type_id,
            is_active
        )
        values (
            v_candidate.canonical_name,
            v_candidate.geom,
            v_source_type_id,
            true
        )
        returning id into v_core_id;
    end if;

    insert into core.core_street_names (
        street_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary
    )
    select
        v_core_id,
        v_candidate.canonical_name,
        null,
        null,
        'primary',
        true
    where not exists (
        select 1
        from core.core_street_names as n
        where n.street_id = v_core_id
          and n.name = v_candidate.canonical_name
          and n.name_type = 'primary'
    );

    update staging.staging_road_candidates
    set matched_core_edge_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;


--
-- Name: event_trigger_function_for_metadata(); Type: FUNCTION; Schema: ogr_system_tables; Owner: -
--

CREATE OR REPLACE FUNCTION ogr_system_tables.event_trigger_function_for_metadata() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    obj record;
BEGIN
  IF has_schema_privilege('ogr_system_tables', 'USAGE') THEN
   IF has_table_privilege('ogr_system_tables.metadata', 'DELETE') THEN
    FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
    LOOP
        IF obj.object_type = 'table' THEN
            DELETE FROM ogr_system_tables.metadata m WHERE m.schema_name = obj.schema_name AND m.table_name = obj.object_name;
        END IF;
    END LOOP;
   END IF;
  END IF;
END;
$$;


--
-- Name: get_admin_areas_tile(integer, integer, integer); Type: FUNCTION; Schema: tiles; Owner: -
--

CREATE OR REPLACE FUNCTION tiles.get_admin_areas_tile(z integer, x integer, y integer) RETURNS bytea
    LANGUAGE sql STABLE
    AS $$
with
bounds as (
    select ST_TileEnvelope(z, x, y) as tile_geom
),
mvtgeom as (
    select
        a.id,
        a.name,
        ST_AsMVTGeom(
            a.geom,
            b.tile_geom,
            4096,
            64,
            true
        ) as geom
    from tiles.v_admin_areas a
    cross join bounds b
    where a.geom && b.tile_geom
)
select ST_AsMVT(mvtgeom, 'admin_areas', 4096, 'geom')
from mvtgeom;
$$;


--
-- Name: get_places_tile(integer, integer, integer); Type: FUNCTION; Schema: tiles; Owner: -
--

CREATE OR REPLACE FUNCTION tiles.get_places_tile(z integer, x integer, y integer) RETURNS bytea
    LANGUAGE sql STABLE
    AS $$
with bounds as (
    select ST_TileEnvelope(z, x, y) as tile_geom
),
mvtgeom as (
    select
        p.id,
        p.name,
        ST_AsMVTGeom(p.geom, b.tile_geom, 4096, 64, true) as geom
    from tiles.v_places p
    cross join bounds b
    where p.geom && b.tile_geom
)
select ST_AsMVT(mvtgeom, 'places', 4096, 'geom')
from mvtgeom;
$$;


--
-- Name: get_streets_tile(integer, integer, integer); Type: FUNCTION; Schema: tiles; Owner: -
--

CREATE OR REPLACE FUNCTION tiles.get_streets_tile(z integer, x integer, y integer) RETURNS bytea
    LANGUAGE sql STABLE
    AS $$
with bounds as (
    select ST_TileEnvelope(z, x, y) as tile_geom
),
mvtgeom as (
    select
        s.id,
        s.name,
        ST_AsMVTGeom(s.geom, b.tile_geom, 4096, 64, true) as geom
    from tiles.v_streets s
    cross join bounds b
    where s.geom && b.tile_geom
)
select ST_AsMVT(mvtgeom, 'streets', 4096, 'geom')
from mvtgeom;
$$;


--
-- Name: auth_roles; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE IF NOT EXISTS app_auth.auth_roles (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    is_system boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_roles_code_chk CHECK ((btrim(code) <> ''::text)),
    CONSTRAINT auth_roles_description_chk CHECK (((description IS NULL) OR (btrim(description) <> ''::text))),
    CONSTRAINT auth_roles_name_chk CHECK ((btrim(name) <> ''::text))
);


--
-- Name: auth_roles_id_seq; Type: SEQUENCE; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE app_auth.auth_roles ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app_auth.auth_roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_user_roles; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE IF NOT EXISTS app_auth.auth_user_roles (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    role_id bigint NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_user_roles_id_seq; Type: SEQUENCE; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE app_auth.auth_user_roles ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app_auth.auth_user_roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_users; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE IF NOT EXISTS app_auth.auth_users (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_users_display_name_chk CHECK ((btrim(display_name) <> ''::text)),
    CONSTRAINT auth_users_email_chk CHECK (((btrim(email) <> ''::text) AND (email = lower(email)))),
    CONSTRAINT auth_users_password_hash_chk CHECK ((btrim(password_hash) <> ''::text))
);


--
-- Name: auth_users_id_seq; Type: SEQUENCE; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE app_auth.auth_users ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app_auth.auth_users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_address_components; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_address_components (
    id bigint NOT NULL,
    address_id bigint NOT NULL,
    component_type_id bigint NOT NULL,
    component_value text NOT NULL,
    sort_order integer NOT NULL,
    CONSTRAINT core_address_components_component_value_chk CHECK ((btrim(component_value) <> ''::text)),
    CONSTRAINT core_address_components_sort_order_chk CHECK ((sort_order >= 0))
);


--
-- Name: core_address_components_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_address_components ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_address_components_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_addresses; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_addresses (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_address text NOT NULL,
    house_number text,
    unit_number text,
    street_id bigint,
    admin_area_id bigint,
    point_geom public.geometry(Point,4326),
    entrance_geom public.geometry(Point,4326),
    postal_code text,
    source_type_id bigint NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT core_addresses_full_address_chk CHECK ((btrim(full_address) <> ''::text)),
    CONSTRAINT core_addresses_house_number_chk CHECK (((house_number IS NULL) OR (btrim(house_number) <> ''::text))),
    CONSTRAINT core_addresses_postal_code_chk CHECK (((postal_code IS NULL) OR (btrim(postal_code) <> ''::text))),
    CONSTRAINT core_addresses_unit_number_chk CHECK (((unit_number IS NULL) OR (btrim(unit_number) <> ''::text)))
);


--
-- Name: core_addresses_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_addresses ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_addresses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_area_names; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_admin_area_names (
    id bigint NOT NULL,
    admin_area_id bigint NOT NULL,
    name text NOT NULL,
    language_code text,
    script_code text,
    name_type text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    search_weight integer DEFAULT 0 NOT NULL,
    CONSTRAINT core_admin_area_names_language_code_chk CHECK (((language_code IS NULL) OR (btrim(language_code) <> ''::text))),
    CONSTRAINT core_admin_area_names_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT core_admin_area_names_name_type_chk CHECK ((btrim(name_type) <> ''::text)),
    CONSTRAINT core_admin_area_names_script_code_chk CHECK (((script_code IS NULL) OR (btrim(script_code) <> ''::text))),
    CONSTRAINT core_admin_area_names_search_weight_chk CHECK ((search_weight >= 0))
);


--
-- Name: core_admin_area_names_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_admin_area_names ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_admin_area_names_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_areas; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_admin_areas (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id bigint,
    admin_level_id bigint NOT NULL,
    canonical_name text NOT NULL,
    slug text NOT NULL,
    geom public.geometry(MultiPolygon,4326) NOT NULL,
    centroid public.geometry(Point,4326) NOT NULL,
    source_type_id bigint NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT core_admin_areas_canonical_name_chk CHECK ((btrim(canonical_name) <> ''::text)),
    CONSTRAINT core_admin_areas_parent_id_chk CHECK (((parent_id IS NULL) OR (parent_id <> id))),
    CONSTRAINT core_admin_areas_slug_chk CHECK ((btrim(slug) <> ''::text))
);


--
-- Name: core_admin_areas_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_admin_areas ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_admin_areas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_route_names; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_bus_route_names (
    id bigint NOT NULL,
    route_id bigint NOT NULL,
    name text NOT NULL,
    language_code text,
    name_type text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    CONSTRAINT core_bus_route_names_language_code_chk CHECK (((language_code IS NULL) OR (btrim(language_code) <> ''::text))),
    CONSTRAINT core_bus_route_names_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT core_bus_route_names_name_type_chk CHECK ((btrim(name_type) <> ''::text))
);


--
-- Name: core_bus_route_names_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_bus_route_names ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_bus_route_names_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_route_stops; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_bus_route_stops (
    route_variant_id bigint NOT NULL,
    stop_id bigint NOT NULL,
    stop_sequence integer NOT NULL,
    distance_from_start_m numeric,
    is_timing_point boolean DEFAULT false NOT NULL,
    CONSTRAINT core_bus_route_stops_distance_from_start_m_chk CHECK (((distance_from_start_m IS NULL) OR (distance_from_start_m >= (0)::numeric))),
    CONSTRAINT core_bus_route_stops_stop_sequence_chk CHECK ((stop_sequence > 0))
);


--
-- Name: core_bus_route_variants; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_bus_route_variants (
    id bigint NOT NULL,
    route_id bigint NOT NULL,
    variant_code text NOT NULL,
    direction_name text,
    origin_name text,
    destination_name text,
    geom public.geometry(LineString,4326) NOT NULL,
    distance_m numeric,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT core_bus_route_variants_destination_name_chk CHECK (((destination_name IS NULL) OR (btrim(destination_name) <> ''::text))),
    CONSTRAINT core_bus_route_variants_direction_name_chk CHECK (((direction_name IS NULL) OR (btrim(direction_name) <> ''::text))),
    CONSTRAINT core_bus_route_variants_distance_m_chk CHECK (((distance_m IS NULL) OR (distance_m >= (0)::numeric))),
    CONSTRAINT core_bus_route_variants_origin_name_chk CHECK (((origin_name IS NULL) OR (btrim(origin_name) <> ''::text))),
    CONSTRAINT core_bus_route_variants_variant_code_chk CHECK ((btrim(variant_code) <> ''::text))
);


--
-- Name: core_bus_route_variants_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_bus_route_variants ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_bus_route_variants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_routes; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_bus_routes (
    id bigint NOT NULL,
    route_code text NOT NULL,
    public_name text NOT NULL,
    operator_name text,
    route_type text,
    directionality text,
    is_active boolean DEFAULT true NOT NULL,
    source_type_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT core_bus_routes_directionality_chk CHECK (((directionality IS NULL) OR (btrim(directionality) <> ''::text))),
    CONSTRAINT core_bus_routes_operator_name_chk CHECK (((operator_name IS NULL) OR (btrim(operator_name) <> ''::text))),
    CONSTRAINT core_bus_routes_public_name_chk CHECK ((btrim(public_name) <> ''::text)),
    CONSTRAINT core_bus_routes_route_code_chk CHECK ((btrim(route_code) <> ''::text)),
    CONSTRAINT core_bus_routes_route_type_chk CHECK (((route_type IS NULL) OR (btrim(route_type) <> ''::text)))
);


--
-- Name: core_bus_routes_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_bus_routes ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_bus_routes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_stop_names; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_bus_stop_names (
    id bigint NOT NULL,
    stop_id bigint NOT NULL,
    name text NOT NULL,
    language_code text,
    name_type text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    CONSTRAINT core_bus_stop_names_language_code_chk CHECK (((language_code IS NULL) OR (btrim(language_code) <> ''::text))),
    CONSTRAINT core_bus_stop_names_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT core_bus_stop_names_name_type_chk CHECK ((btrim(name_type) <> ''::text))
);


--
-- Name: core_bus_stop_names_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_bus_stop_names ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_bus_stop_names_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_stops; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_bus_stops (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    name_local text,
    stop_code text,
    geom public.geometry(Point,4326) NOT NULL,
    admin_area_id bigint,
    source_type_id bigint NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT core_bus_stops_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT core_bus_stops_name_local_chk CHECK (((name_local IS NULL) OR (btrim(name_local) <> ''::text))),
    CONSTRAINT core_bus_stops_stop_code_chk CHECK (((stop_code IS NULL) OR (btrim(stop_code) <> ''::text)))
);


--
-- Name: core_bus_stops_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_bus_stops ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_bus_stops_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_map_buildings; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_map_buildings (
    id bigint NOT NULL,
    source_staging_id bigint NOT NULL,
    external_id text NOT NULL,
    name text,
    class_code text NOT NULL,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    geom public.geometry(MultiPolygon,4326) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT core_map_buildings_class_code_chk CHECK ((btrim(class_code) <> ''::text)),
    CONSTRAINT core_map_buildings_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT core_map_buildings_name_chk CHECK (((name IS NULL) OR (btrim(name) <> ''::text)))
);


--
-- Name: core_map_buildings_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

CREATE SEQUENCE core.core_map_buildings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_map_buildings_id_seq; Type: SEQUENCE OWNED BY; Schema: core; Owner: -
--

ALTER SEQUENCE core.core_map_buildings_id_seq OWNED BY core.core_map_buildings.id;


--
-- Name: core_map_landuse; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_map_landuse (
    id bigint NOT NULL,
    source_staging_id bigint NOT NULL,
    external_id text NOT NULL,
    name text,
    class_code text NOT NULL,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    geom public.geometry(MultiPolygon,4326) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT core_map_landuse_class_code_chk CHECK ((btrim(class_code) <> ''::text)),
    CONSTRAINT core_map_landuse_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT core_map_landuse_name_chk CHECK (((name IS NULL) OR (btrim(name) <> ''::text)))
);


--
-- Name: core_map_landuse_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

CREATE SEQUENCE core.core_map_landuse_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_map_landuse_id_seq; Type: SEQUENCE OWNED BY; Schema: core; Owner: -
--

ALTER SEQUENCE core.core_map_landuse_id_seq OWNED BY core.core_map_landuse.id;


--
-- Name: core_map_water_lines; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_map_water_lines (
    id bigint NOT NULL,
    source_staging_id bigint NOT NULL,
    external_id text NOT NULL,
    name text,
    class_code text NOT NULL,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    geom public.geometry(MultiLineString,4326) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT core_map_water_lines_class_code_chk CHECK ((btrim(class_code) <> ''::text)),
    CONSTRAINT core_map_water_lines_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT core_map_water_lines_name_chk CHECK (((name IS NULL) OR (btrim(name) <> ''::text)))
);


--
-- Name: core_map_water_lines_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

CREATE SEQUENCE core.core_map_water_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_map_water_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: core; Owner: -
--

ALTER SEQUENCE core.core_map_water_lines_id_seq OWNED BY core.core_map_water_lines.id;


--
-- Name: core_map_water_polygons; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_map_water_polygons (
    id bigint NOT NULL,
    source_staging_id bigint NOT NULL,
    external_id text NOT NULL,
    name text,
    class_code text NOT NULL,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    geom public.geometry(MultiPolygon,4326) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT core_map_water_polygons_class_code_chk CHECK ((btrim(class_code) <> ''::text)),
    CONSTRAINT core_map_water_polygons_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT core_map_water_polygons_name_chk CHECK (((name IS NULL) OR (btrim(name) <> ''::text)))
);


--
-- Name: core_map_water_polygons_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

CREATE SEQUENCE core.core_map_water_polygons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_map_water_polygons_id_seq; Type: SEQUENCE OWNED BY; Schema: core; Owner: -
--

ALTER SEQUENCE core.core_map_water_polygons_id_seq OWNED BY core.core_map_water_polygons.id;


--
-- Name: core_place_addresses; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_place_addresses (
    place_id bigint NOT NULL,
    address_id bigint NOT NULL,
    relation_type text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    CONSTRAINT core_place_addresses_relation_type_chk CHECK ((btrim(relation_type) <> ''::text))
);


--
-- Name: core_place_contacts; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_place_contacts (
    id bigint NOT NULL,
    place_id bigint NOT NULL,
    phone text,
    website text,
    facebook_url text,
    opening_hours text,
    email text,
    CONSTRAINT core_place_contacts_email_chk CHECK (((email IS NULL) OR (btrim(email) <> ''::text))),
    CONSTRAINT core_place_contacts_facebook_url_chk CHECK (((facebook_url IS NULL) OR (btrim(facebook_url) <> ''::text))),
    CONSTRAINT core_place_contacts_opening_hours_chk CHECK (((opening_hours IS NULL) OR (btrim(opening_hours) <> ''::text))),
    CONSTRAINT core_place_contacts_phone_chk CHECK (((phone IS NULL) OR (btrim(phone) <> ''::text))),
    CONSTRAINT core_place_contacts_website_chk CHECK (((website IS NULL) OR (btrim(website) <> ''::text)))
);


--
-- Name: core_place_contacts_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_place_contacts ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_place_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_names; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_place_names (
    id bigint NOT NULL,
    place_id bigint NOT NULL,
    name text NOT NULL,
    language_code text,
    script_code text,
    name_type text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    search_weight integer DEFAULT 0 NOT NULL,
    CONSTRAINT core_place_names_language_code_chk CHECK (((language_code IS NULL) OR (btrim(language_code) <> ''::text))),
    CONSTRAINT core_place_names_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT core_place_names_name_type_chk CHECK ((btrim(name_type) <> ''::text)),
    CONSTRAINT core_place_names_script_code_chk CHECK (((script_code IS NULL) OR (btrim(script_code) <> ''::text))),
    CONSTRAINT core_place_names_search_weight_chk CHECK ((search_weight >= 0))
);


--
-- Name: core_place_names_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_place_names ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_place_names_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_sources; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_place_sources (
    id bigint NOT NULL,
    place_id bigint NOT NULL,
    source_type_id bigint NOT NULL,
    external_id text,
    source_name text NOT NULL,
    source_url text,
    source_priority integer DEFAULT 0 NOT NULL,
    captured_at timestamp with time zone,
    raw_payload jsonb,
    CONSTRAINT core_place_sources_external_id_chk CHECK (((external_id IS NULL) OR (btrim(external_id) <> ''::text))),
    CONSTRAINT core_place_sources_source_name_chk CHECK ((btrim(source_name) <> ''::text)),
    CONSTRAINT core_place_sources_source_priority_chk CHECK ((source_priority >= 0)),
    CONSTRAINT core_place_sources_source_url_chk CHECK (((source_url IS NULL) OR (btrim(source_url) <> ''::text)))
);


--
-- Name: core_place_sources_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_place_sources ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_place_sources_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_versions; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_place_versions (
    id bigint NOT NULL,
    place_id bigint NOT NULL,
    version_no integer NOT NULL,
    snapshot_data jsonb NOT NULL,
    publish_status_id bigint,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    approved_by bigint,
    CONSTRAINT core_place_versions_published_at_chk CHECK (((published_at IS NULL) OR (published_at >= created_at))),
    CONSTRAINT core_place_versions_version_no_chk CHECK ((version_no > 0))
);


--
-- Name: core_place_versions_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_place_versions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_place_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_places; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_places (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    primary_name text NOT NULL,
    secondary_name text,
    name_local text,
    display_name text NOT NULL,
    category_id bigint NOT NULL,
    admin_area_id bigint,
    point_geom public.geometry(Point,4326) NOT NULL,
    entry_geom public.geometry(Point,4326),
    footprint_geom public.geometry(MultiPolygon,4326),
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    plus_code text,
    importance_score numeric DEFAULT 0 NOT NULL,
    popularity_score numeric DEFAULT 0 NOT NULL,
    confidence_score numeric DEFAULT 0 NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    source_type_id bigint NOT NULL,
    publish_status_id bigint,
    current_version_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT core_places_confidence_score_chk CHECK ((confidence_score >= (0)::numeric)),
    CONSTRAINT core_places_display_name_chk CHECK ((btrim(display_name) <> ''::text)),
    CONSTRAINT core_places_importance_score_chk CHECK ((importance_score >= (0)::numeric)),
    CONSTRAINT core_places_lat_chk CHECK (((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision))),
    CONSTRAINT core_places_lng_chk CHECK (((lng >= ('-180'::integer)::double precision) AND (lng <= (180)::double precision))),
    CONSTRAINT core_places_name_local_chk CHECK (((name_local IS NULL) OR (btrim(name_local) <> ''::text))),
    CONSTRAINT core_places_plus_code_chk CHECK (((plus_code IS NULL) OR (btrim(plus_code) <> ''::text))),
    CONSTRAINT core_places_popularity_score_chk CHECK ((popularity_score >= (0)::numeric)),
    CONSTRAINT core_places_primary_name_chk CHECK ((btrim(primary_name) <> ''::text)),
    CONSTRAINT core_places_secondary_name_chk CHECK (((secondary_name IS NULL) OR (btrim(secondary_name) <> ''::text)))
);


--
-- Name: core_places_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_places ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_places_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_street_names; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_street_names (
    id bigint NOT NULL,
    street_id bigint NOT NULL,
    name text NOT NULL,
    language_code text,
    script_code text,
    name_type text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    CONSTRAINT core_street_names_language_code_chk CHECK (((language_code IS NULL) OR (btrim(language_code) <> ''::text))),
    CONSTRAINT core_street_names_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT core_street_names_name_type_chk CHECK ((btrim(name_type) <> ''::text)),
    CONSTRAINT core_street_names_script_code_chk CHECK (((script_code IS NULL) OR (btrim(script_code) <> ''::text)))
);


--
-- Name: core_street_names_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_street_names ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_street_names_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_streets; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE IF NOT EXISTS core.core_streets (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_name text NOT NULL,
    geom public.geometry(LineString,4326) NOT NULL,
    admin_area_id bigint,
    source_type_id bigint NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT core_streets_canonical_name_chk CHECK ((btrim(canonical_name) <> ''::text))
);


--
-- Name: core_streets_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE core.core_streets ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.core_streets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: metadata; Type: TABLE; Schema: ogr_system_tables; Owner: -
--

CREATE TABLE IF NOT EXISTS ogr_system_tables.metadata (
    id integer NOT NULL,
    schema_name text NOT NULL,
    table_name text NOT NULL,
    metadata text
);


--
-- Name: metadata_id_seq; Type: SEQUENCE; Schema: ogr_system_tables; Owner: -
--

CREATE SEQUENCE ogr_system_tables.metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: ogr_system_tables; Owner: -
--

ALTER SEQUENCE ogr_system_tables.metadata_id_seq OWNED BY ogr_system_tables.metadata.id;


--
-- Name: osm2pgsql_properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.osm2pgsql_properties (
    property text NOT NULL,
    value text NOT NULL
);


--
-- Name: kyauktan_boundary; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE IF NOT EXISTS raw.kyauktan_boundary (
    osm_id text,
    tags jsonb,
    geom public.geometry(MultiPolygon,4326)
);


--
-- Name: raw_osm_lines; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE IF NOT EXISTS raw.raw_osm_lines (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    osm_feature_type text NOT NULL,
    osm_id text NOT NULL,
    geom public.geometry(MultiLineString,4326) NOT NULL,
    tags jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT raw_osm_lines_osm_feature_type_chk CHECK ((btrim(osm_feature_type) <> ''::text)),
    CONSTRAINT raw_osm_lines_osm_id_chk CHECK ((btrim(osm_id) <> ''::text))
);


--
-- Name: raw_osm_lines_id_seq; Type: SEQUENCE; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE raw.raw_osm_lines ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME raw.raw_osm_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_points; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE IF NOT EXISTS raw.raw_osm_points (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    osm_feature_type text NOT NULL,
    osm_id text NOT NULL,
    geom public.geometry(Point,4326) NOT NULL,
    tags jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT raw_osm_points_osm_feature_type_chk CHECK ((btrim(osm_feature_type) <> ''::text)),
    CONSTRAINT raw_osm_points_osm_id_chk CHECK ((btrim(osm_id) <> ''::text))
);


--
-- Name: raw_osm_points_id_seq; Type: SEQUENCE; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE raw.raw_osm_points ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME raw.raw_osm_points_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_polygons; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE IF NOT EXISTS raw.raw_osm_polygons (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    osm_feature_type text NOT NULL,
    osm_id text NOT NULL,
    geom public.geometry(MultiPolygon,4326) NOT NULL,
    tags jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT raw_osm_polygons_osm_feature_type_chk CHECK ((btrim(osm_feature_type) <> ''::text)),
    CONSTRAINT raw_osm_polygons_osm_id_chk CHECK ((btrim(osm_id) <> ''::text))
);


--
-- Name: raw_osm_polygons_id_seq; Type: SEQUENCE; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE raw.raw_osm_polygons ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME raw.raw_osm_polygons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: v2_kyauktan_custom_boundary; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE IF NOT EXISTS raw.v2_kyauktan_custom_boundary (
    ogc_fid integer NOT NULL,
    wkb_geometry public.geometry(Polygon,4326),
    fid integer,
    "text/string" character varying
);


--
-- Name: v2_kyauktan_custom_boundary_ogc_fid_seq; Type: SEQUENCE; Schema: raw; Owner: -
--

CREATE SEQUENCE raw.v2_kyauktan_custom_boundary_ogc_fid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: v2_kyauktan_custom_boundary_ogc_fid_seq; Type: SEQUENCE OWNED BY; Schema: raw; Owner: -
--

ALTER SEQUENCE raw.v2_kyauktan_custom_boundary_ogc_fid_seq OWNED BY raw.v2_kyauktan_custom_boundary.ogc_fid;


--
-- Name: ref_address_component_types; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_address_component_types (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    rank integer NOT NULL
);


--
-- Name: ref_address_component_types_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_address_component_types ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_address_component_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_admin_levels; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_admin_levels (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    rank integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ref_admin_levels_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_admin_levels ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_admin_levels_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_place_classes; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_place_classes (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL
);


--
-- Name: ref_place_classes_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_place_classes ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_place_classes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_poi_categories; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_poi_categories (
    id bigint NOT NULL,
    parent_id bigint,
    code text NOT NULL,
    name text NOT NULL,
    sort_order integer NOT NULL,
    is_searchable boolean DEFAULT true NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ref_poi_categories_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_poi_categories ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_poi_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_publish_statuses; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_publish_statuses (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ref_publish_statuses_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_publish_statuses ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_publish_statuses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_report_statuses; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_report_statuses (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ref_report_statuses_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_report_statuses ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_report_statuses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_report_types; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_report_types (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ref_report_types_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_report_types ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_report_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_road_classes; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_road_classes (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL
);


--
-- Name: ref_road_classes_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_road_classes ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_road_classes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_source_types; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_source_types (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL
);


--
-- Name: ref_source_types_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_source_types ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_source_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_validation_statuses; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_validation_statuses (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ref_validation_statuses_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_validation_statuses ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_validation_statuses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_validation_task_types; Type: TABLE; Schema: ref; Owner: -
--

CREATE TABLE IF NOT EXISTS ref.ref_validation_task_types (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ref_validation_task_types_id_seq; Type: SEQUENCE; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ref.ref_validation_task_types ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME ref.ref_validation_task_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_admin_area_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_admin_area_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    external_id text NOT NULL,
    canonical_name text NOT NULL,
    admin_level_id bigint NOT NULL,
    parent_candidate_id bigint,
    geom public.geometry(MultiPolygon,4326) NOT NULL,
    centroid public.geometry(Point,4326),
    confidence_score numeric(5,4),
    match_status text NOT NULL,
    matched_core_admin_area_id bigint,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staging_admin_area_candidates_canonical_name_chk CHECK ((btrim(canonical_name) <> ''::text)),
    CONSTRAINT staging_admin_area_candidates_confidence_score_chk CHECK (((confidence_score IS NULL) OR ((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric)))),
    CONSTRAINT staging_admin_area_candidates_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT staging_admin_area_candidates_match_status_chk CHECK ((btrim(match_status) <> ''::text)),
    CONSTRAINT staging_admin_area_candidates_parent_self_ref_chk CHECK (((parent_candidate_id IS NULL) OR (parent_candidate_id <> id)))
);


--
-- Name: staging_admin_area_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE staging.staging_admin_area_candidates ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME staging.staging_admin_area_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_building_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_building_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    raw_id bigint NOT NULL,
    external_id text NOT NULL,
    canonical_name text,
    class_code text NOT NULL,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence_score numeric DEFAULT 0.7 NOT NULL,
    match_status text DEFAULT 'new'::text NOT NULL,
    geom public.geometry(MultiPolygon,4326) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staging_building_candidates_canonical_name_chk CHECK (((canonical_name IS NULL) OR (btrim(canonical_name) <> ''::text))),
    CONSTRAINT staging_building_candidates_class_code_chk CHECK ((btrim(class_code) <> ''::text)),
    CONSTRAINT staging_building_candidates_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT staging_building_candidates_match_status_chk CHECK ((btrim(match_status) <> ''::text))
);


--
-- Name: staging_building_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.staging_building_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staging_building_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.staging_building_candidates_id_seq OWNED BY staging.staging_building_candidates.id;


--
-- Name: staging_bus_route_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_bus_route_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    external_id text NOT NULL,
    route_code text NOT NULL,
    public_name text NOT NULL,
    geom public.geometry(LineString,4326) NOT NULL,
    confidence_score numeric(5,4),
    match_status text NOT NULL,
    matched_core_bus_route_id bigint,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staging_bus_route_candidates_confidence_score_chk CHECK (((confidence_score IS NULL) OR ((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric)))),
    CONSTRAINT staging_bus_route_candidates_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT staging_bus_route_candidates_match_status_chk CHECK ((btrim(match_status) <> ''::text)),
    CONSTRAINT staging_bus_route_candidates_public_name_chk CHECK ((btrim(public_name) <> ''::text)),
    CONSTRAINT staging_bus_route_candidates_route_code_chk CHECK ((btrim(route_code) <> ''::text))
);


--
-- Name: staging_bus_route_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE staging.staging_bus_route_candidates ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME staging.staging_bus_route_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_bus_stop_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_bus_stop_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    external_id text NOT NULL,
    canonical_name text NOT NULL,
    point_geom public.geometry(Point,4326) NOT NULL,
    admin_area_candidate_id bigint,
    confidence_score numeric(5,4),
    match_status text NOT NULL,
    matched_core_bus_stop_id bigint,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staging_bus_stop_candidates_canonical_name_chk CHECK ((btrim(canonical_name) <> ''::text)),
    CONSTRAINT staging_bus_stop_candidates_confidence_score_chk CHECK (((confidence_score IS NULL) OR ((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric)))),
    CONSTRAINT staging_bus_stop_candidates_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT staging_bus_stop_candidates_match_status_chk CHECK ((btrim(match_status) <> ''::text))
);


--
-- Name: staging_bus_stop_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE staging.staging_bus_stop_candidates ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME staging.staging_bus_stop_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_landuse_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_landuse_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    raw_id bigint NOT NULL,
    external_id text NOT NULL,
    canonical_name text,
    class_code text NOT NULL,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence_score numeric DEFAULT 0.7 NOT NULL,
    match_status text DEFAULT 'new'::text NOT NULL,
    geom public.geometry(MultiPolygon,4326) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staging_landuse_candidates_canonical_name_chk CHECK (((canonical_name IS NULL) OR (btrim(canonical_name) <> ''::text))),
    CONSTRAINT staging_landuse_candidates_class_code_chk CHECK ((btrim(class_code) <> ''::text)),
    CONSTRAINT staging_landuse_candidates_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT staging_landuse_candidates_match_status_chk CHECK ((btrim(match_status) <> ''::text))
);


--
-- Name: staging_landuse_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.staging_landuse_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staging_landuse_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.staging_landuse_candidates_id_seq OWNED BY staging.staging_landuse_candidates.id;


--
-- Name: staging_place_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_place_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    source_entity_type text NOT NULL,
    external_id text NOT NULL,
    canonical_name text NOT NULL,
    place_class_id bigint NOT NULL,
    poi_category_id bigint,
    admin_area_candidate_id bigint,
    point_geom public.geometry(Point,4326) NOT NULL,
    confidence_score numeric(5,4),
    match_status text NOT NULL,
    matched_core_place_id bigint,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staging_place_candidates_canonical_name_chk CHECK ((btrim(canonical_name) <> ''::text)),
    CONSTRAINT staging_place_candidates_confidence_score_chk CHECK (((confidence_score IS NULL) OR ((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric)))),
    CONSTRAINT staging_place_candidates_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT staging_place_candidates_match_status_chk CHECK ((btrim(match_status) <> ''::text)),
    CONSTRAINT staging_place_candidates_source_entity_type_chk CHECK ((btrim(source_entity_type) <> ''::text))
);


--
-- Name: staging_place_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE staging.staging_place_candidates ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME staging.staging_place_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_place_name_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_place_name_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    place_candidate_id bigint NOT NULL,
    name text NOT NULL,
    language_code text,
    script_code text,
    name_type text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    search_weight numeric(6,3),
    CONSTRAINT staging_place_name_candidates_language_code_chk CHECK (((language_code IS NULL) OR (btrim(language_code) <> ''::text))),
    CONSTRAINT staging_place_name_candidates_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT staging_place_name_candidates_name_type_chk CHECK ((btrim(name_type) <> ''::text)),
    CONSTRAINT staging_place_name_candidates_script_code_chk CHECK (((script_code IS NULL) OR (btrim(script_code) <> ''::text))),
    CONSTRAINT staging_place_name_candidates_search_weight_chk CHECK (((search_weight IS NULL) OR (search_weight >= (0)::numeric)))
);


--
-- Name: staging_place_name_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE staging.staging_place_name_candidates ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME staging.staging_place_name_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_road_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_road_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    external_id text NOT NULL,
    canonical_name text NOT NULL,
    road_class_id bigint,
    geom public.geometry(MultiLineString,4326) NOT NULL,
    is_oneway boolean,
    length_m numeric,
    confidence_score numeric(5,4),
    match_status text NOT NULL,
    matched_core_edge_id bigint,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staging_road_candidates_canonical_name_chk CHECK ((btrim(canonical_name) <> ''::text)),
    CONSTRAINT staging_road_candidates_confidence_score_chk CHECK (((confidence_score IS NULL) OR ((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric)))),
    CONSTRAINT staging_road_candidates_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT staging_road_candidates_length_m_chk CHECK (((length_m IS NULL) OR (length_m >= (0)::numeric))),
    CONSTRAINT staging_road_candidates_match_status_chk CHECK ((btrim(match_status) <> ''::text))
);


--
-- Name: staging_road_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE staging.staging_road_candidates ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME staging.staging_road_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_water_line_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_water_line_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    raw_id bigint NOT NULL,
    external_id text NOT NULL,
    canonical_name text,
    class_code text NOT NULL,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence_score numeric DEFAULT 0.7 NOT NULL,
    match_status text DEFAULT 'new'::text NOT NULL,
    geom public.geometry(MultiLineString,4326) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staging_water_line_candidates_canonical_name_chk CHECK (((canonical_name IS NULL) OR (btrim(canonical_name) <> ''::text))),
    CONSTRAINT staging_water_line_candidates_class_code_chk CHECK ((btrim(class_code) <> ''::text)),
    CONSTRAINT staging_water_line_candidates_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT staging_water_line_candidates_match_status_chk CHECK ((btrim(match_status) <> ''::text))
);


--
-- Name: staging_water_line_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.staging_water_line_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staging_water_line_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.staging_water_line_candidates_id_seq OWNED BY staging.staging_water_line_candidates.id;


--
-- Name: staging_water_polygon_candidates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE IF NOT EXISTS staging.staging_water_polygon_candidates (
    id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    raw_id bigint NOT NULL,
    external_id text NOT NULL,
    canonical_name text,
    class_code text NOT NULL,
    normalized_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence_score numeric DEFAULT 0.7 NOT NULL,
    match_status text DEFAULT 'new'::text NOT NULL,
    geom public.geometry(MultiPolygon,4326) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staging_water_polygon_candidates_canonical_name_chk CHECK (((canonical_name IS NULL) OR (btrim(canonical_name) <> ''::text))),
    CONSTRAINT staging_water_polygon_candidates_class_code_chk CHECK ((btrim(class_code) <> ''::text)),
    CONSTRAINT staging_water_polygon_candidates_external_id_chk CHECK ((btrim(external_id) <> ''::text)),
    CONSTRAINT staging_water_polygon_candidates_match_status_chk CHECK ((btrim(match_status) <> ''::text))
);


--
-- Name: staging_water_polygon_candidates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.staging_water_polygon_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staging_water_polygon_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.staging_water_polygon_candidates_id_seq OWNED BY staging.staging_water_polygon_candidates.id;


--
-- Name: system_conflict_queue; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_conflict_queue (
    id bigint NOT NULL,
    diff_item_id bigint NOT NULL,
    conflict_type text NOT NULL,
    resolution_status text NOT NULL,
    assigned_to bigint,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT system_conflict_queue_conflict_type_chk CHECK ((btrim(conflict_type) <> ''::text)),
    CONSTRAINT system_conflict_queue_resolution_status_chk CHECK ((btrim(resolution_status) <> ''::text)),
    CONSTRAINT system_conflict_queue_resolved_at_chk CHECK (((resolved_at IS NULL) OR (resolved_at >= created_at)))
);


--
-- Name: system_conflict_queue_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_conflict_queue ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_conflict_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_diff_items; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_diff_items (
    id bigint NOT NULL,
    diff_run_id bigint NOT NULL,
    entity_family text NOT NULL,
    diff_type text NOT NULL,
    external_id text,
    local_entity_id bigint,
    before_data jsonb,
    after_data jsonb,
    confidence_score numeric(5,4),
    auto_action text,
    review_status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_diff_items_auto_action_chk CHECK (((auto_action IS NULL) OR (btrim(auto_action) <> ''::text))),
    CONSTRAINT system_diff_items_confidence_score_chk CHECK (((confidence_score IS NULL) OR ((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric)))),
    CONSTRAINT system_diff_items_diff_type_chk CHECK ((btrim(diff_type) <> ''::text)),
    CONSTRAINT system_diff_items_entity_family_chk CHECK ((btrim(entity_family) <> ''::text)),
    CONSTRAINT system_diff_items_external_id_chk CHECK (((external_id IS NULL) OR (btrim(external_id) <> ''::text))),
    CONSTRAINT system_diff_items_payload_presence_chk CHECK (((before_data IS NOT NULL) OR (after_data IS NOT NULL))),
    CONSTRAINT system_diff_items_review_status_chk CHECK ((btrim(review_status) <> ''::text))
);


--
-- Name: system_diff_items_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_diff_items ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_diff_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_diff_runs; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_diff_runs (
    id bigint NOT NULL,
    previous_snapshot_id bigint,
    current_snapshot_id bigint NOT NULL,
    entity_family text NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT system_diff_runs_entity_family_chk CHECK ((btrim(entity_family) <> ''::text)),
    CONSTRAINT system_diff_runs_finished_at_chk CHECK (((finished_at IS NULL) OR (finished_at >= started_at))),
    CONSTRAINT system_diff_runs_snapshot_pair_chk CHECK (((previous_snapshot_id IS NULL) OR (previous_snapshot_id <> current_snapshot_id))),
    CONSTRAINT system_diff_runs_status_chk CHECK ((btrim(status) <> ''::text))
);


--
-- Name: system_diff_runs_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_diff_runs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_diff_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_import_batches; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_import_batches (
    id bigint NOT NULL,
    source_registry_id bigint NOT NULL,
    batch_name text NOT NULL,
    trigger_type text NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    note text,
    CONSTRAINT system_import_batches_batch_name_chk CHECK ((btrim(batch_name) <> ''::text)),
    CONSTRAINT system_import_batches_finished_at_chk CHECK (((finished_at IS NULL) OR (finished_at >= started_at))),
    CONSTRAINT system_import_batches_status_chk CHECK ((btrim(status) <> ''::text)),
    CONSTRAINT system_import_batches_trigger_type_chk CHECK ((btrim(trigger_type) <> ''::text))
);


--
-- Name: system_import_batches_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_import_batches ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_import_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_publish_batches; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_publish_batches (
    id bigint NOT NULL,
    batch_name text NOT NULL,
    created_by bigint,
    approved_by bigint,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    note text,
    CONSTRAINT system_publish_batches_batch_name_chk CHECK ((btrim(batch_name) <> ''::text)),
    CONSTRAINT system_publish_batches_published_at_chk CHECK (((published_at IS NULL) OR (published_at >= created_at))),
    CONSTRAINT system_publish_batches_status_chk CHECK ((btrim(status) <> ''::text))
);


--
-- Name: system_publish_batches_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_publish_batches ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_publish_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_publish_items; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_publish_items (
    id bigint NOT NULL,
    publish_batch_id bigint NOT NULL,
    entity_family text NOT NULL,
    entity_id bigint NOT NULL,
    version_id bigint,
    publish_action text NOT NULL,
    publish_status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_publish_items_entity_family_chk CHECK ((btrim(entity_family) <> ''::text)),
    CONSTRAINT system_publish_items_publish_action_chk CHECK ((btrim(publish_action) <> ''::text)),
    CONSTRAINT system_publish_items_publish_status_chk CHECK ((btrim(publish_status) <> ''::text))
);


--
-- Name: system_publish_items_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_publish_items ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_publish_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_review_logs; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_review_logs (
    id bigint NOT NULL,
    entity_family text NOT NULL,
    entity_id bigint NOT NULL,
    reviewer_user_id bigint,
    action_type text NOT NULL,
    before_snapshot jsonb,
    after_snapshot jsonb,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_review_logs_action_type_chk CHECK ((btrim(action_type) <> ''::text)),
    CONSTRAINT system_review_logs_entity_family_chk CHECK ((btrim(entity_family) <> ''::text)),
    CONSTRAINT system_review_logs_snapshot_presence_chk CHECK (((before_snapshot IS NOT NULL) OR (after_snapshot IS NOT NULL) OR (reason IS NOT NULL)))
);


--
-- Name: system_review_logs_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_review_logs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_review_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_review_tasks; Type: TABLE; Schema: system; Owner: -
--

CREATE TABLE IF NOT EXISTS system.system_review_tasks (
    id bigint NOT NULL,
    task_type_id bigint NOT NULL,
    status_id bigint NOT NULL,
    entity_family text NOT NULL,
    entity_id bigint NOT NULL,
    assigned_to bigint,
    priority integer NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT system_review_tasks_entity_family_chk CHECK ((btrim(entity_family) <> ''::text)),
    CONSTRAINT system_review_tasks_priority_chk CHECK ((priority >= 0)),
    CONSTRAINT system_review_tasks_resolved_at_chk CHECK (((resolved_at IS NULL) OR (resolved_at >= created_at)))
);


--
-- Name: system_review_tasks_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_review_tasks ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_review_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_source_registry_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_source_registry ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_source_registry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_source_snapshots_id_seq; Type: SEQUENCE; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE system.system_source_snapshots ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME system.system_source_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: tiles_admin_areas_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_admin_areas_v AS
 SELECT id,
    canonical_name AS name,
    (public.st_setsrid(geom, 4326))::public.geometry(MultiPolygon,4326) AS geom
   FROM core.core_admin_areas
  WHERE (is_active = true);


--
-- Name: tiles_admin_boundaries_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_admin_boundaries_v AS
 SELECT id,
    canonical_name AS name,
    admin_level_id,
    geom
   FROM core.core_admin_areas a
  WHERE (is_active = true);


--
-- Name: tiles_buildings_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_buildings_v AS
 SELECT id,
    name,
    class_code AS building_type,
    geom
   FROM core.core_map_buildings b;


--
-- Name: tiles_bus_routes_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_bus_routes_v AS
 SELECT v.id,
    r.id AS route_id,
    r.route_code,
    r.public_name,
    v.variant_code,
    v.geom
   FROM (core.core_bus_route_variants v
     JOIN core.core_bus_routes r ON ((r.id = v.route_id)))
  WHERE ((r.is_active = true) AND (v.is_active = true));


--
-- Name: tiles_bus_stops_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_bus_stops_v AS
 SELECT id,
    public_id,
    name,
    stop_code,
    geom
   FROM core.core_bus_stops s
  WHERE (is_active = true);


--
-- Name: tiles_landuse_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_landuse_v AS
 SELECT id,
    name,
    class_code AS landuse_class,
    geom
   FROM core.core_map_landuse l;


--
-- Name: tiles_places_legacy_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_places_legacy_v AS
 SELECT id,
    primary_name AS name,
    (public.st_setsrid(point_geom, 4326))::public.geometry(Point,4326) AS geom
   FROM core.core_places
  WHERE (is_public = true);


--
-- Name: tiles_places_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_places_v AS
 SELECT id,
    display_name AS name,
    importance_score,
    point_geom AS geom
   FROM core.core_places p
  WHERE ((deleted_at IS NULL) AND (is_public = true));


--
-- Name: tiles_poi_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_poi_v AS
 SELECT p.id,
    p.public_id,
    p.display_name AS name,
    c.code AS category_code,
    p.importance_score,
    p.point_geom AS geom
   FROM (core.core_places p
     JOIN ref.ref_poi_categories c ON ((c.id = p.category_id)))
  WHERE ((p.is_public = true) AND (p.deleted_at IS NULL) AND (p.publish_status_id = ( SELECT ref_publish_statuses.id
           FROM ref.ref_publish_statuses
          WHERE (ref_publish_statuses.code = 'published'::text))));


--
-- Name: tiles_road_labels_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_road_labels_v AS
 SELECT id,
    canonical_name AS name,
    geom,
    'road_label'::text AS layer_type
   FROM core.core_streets s
  WHERE (canonical_name IS NOT NULL);


--
-- Name: tiles_roads_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_roads_v AS
 SELECT id,
    canonical_name AS name,
    geom,
    'road'::text AS layer_type
   FROM core.core_streets s;


--
-- Name: tiles_streets_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_streets_v AS
 SELECT id,
    canonical_name AS name,
    (public.st_setsrid(geom, 4326))::public.geometry(MultiLineString,4326) AS geom
   FROM core.core_streets
  WHERE (is_active = true);


--
-- Name: tiles_water_lines_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_water_lines_v AS
 SELECT id,
    name,
    class_code AS waterway_class,
    geom
   FROM core.core_map_water_lines w;


--
-- Name: tiles_water_polygons_v; Type: VIEW; Schema: tiles; Owner: -
--

CREATE OR REPLACE VIEW tiles.tiles_water_polygons_v AS
 SELECT id,
    name,
    class_code AS water_class,
    geom
   FROM core.core_map_water_polygons w;


--
-- Name: osm_lines; Type: TABLE; Schema: tmp_import; Owner: -
--

CREATE TABLE IF NOT EXISTS tmp_import.osm_lines (
    osm_feature_type character(1) NOT NULL,
    osm_id bigint NOT NULL,
    tags jsonb,
    geom public.geometry(MultiLineString,4326)
);


--
-- Name: osm_points; Type: TABLE; Schema: tmp_import; Owner: -
--

CREATE TABLE IF NOT EXISTS tmp_import.osm_points (
    osm_feature_type character(1) NOT NULL,
    osm_id bigint NOT NULL,
    tags jsonb,
    geom public.geometry(Point,4326)
);


--
-- Name: osm_polygons; Type: TABLE; Schema: tmp_import; Owner: -
--

CREATE TABLE IF NOT EXISTS tmp_import.osm_polygons (
    osm_feature_type character(1) NOT NULL,
    osm_id bigint NOT NULL,
    tags jsonb,
    geom public.geometry(MultiPolygon,4326)
);


--
-- Name: core_map_buildings id; Type: DEFAULT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_map_buildings ALTER COLUMN id SET DEFAULT nextval('core.core_map_buildings_id_seq'::regclass);


--
-- Name: core_map_landuse id; Type: DEFAULT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.core_map_landuse ALTER COLUMN id SET DEFAULT nextval('core.core_map_landuse_id_seq'::regclass);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_map_water_lines id; Type: DEFAULT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_map_water_lines ALTER COLUMN id SET DEFAULT nextval('core.core_map_water_lines_id_seq'::regclass);


--
-- Name: core_map_water_polygons id; Type: DEFAULT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.core_map_water_polygons ALTER COLUMN id SET DEFAULT nextval('core.core_map_water_polygons_id_seq'::regclass);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: metadata id; Type: DEFAULT; Schema: ogr_system_tables; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ogr_system_tables.metadata ALTER COLUMN id SET DEFAULT nextval('ogr_system_tables.metadata_id_seq'::regclass);


--
-- Name: v2_kyauktan_custom_boundary ogc_fid; Type: DEFAULT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.v2_kyauktan_custom_boundary ALTER COLUMN ogc_fid SET DEFAULT nextval('raw.v2_kyauktan_custom_boundary_ogc_fid_seq'::regclass);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_building_candidates id; Type: DEFAULT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_building_candidates ALTER COLUMN id SET DEFAULT nextval('staging.staging_building_candidates_id_seq'::regclass);


--
-- Name: staging_landuse_candidates id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.staging_landuse_candidates ALTER COLUMN id SET DEFAULT nextval('staging.staging_landuse_candidates_id_seq'::regclass);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_water_line_candidates id; Type: DEFAULT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_water_line_candidates ALTER COLUMN id SET DEFAULT nextval('staging.staging_water_line_candidates_id_seq'::regclass);


--
-- Name: staging_water_polygon_candidates id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.staging_water_polygon_candidates ALTER COLUMN id SET DEFAULT nextval('staging.staging_water_polygon_candidates_id_seq'::regclass);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_roles auth_roles_code_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_roles
    ADD CONSTRAINT auth_roles_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_roles auth_roles_name_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_roles
    ADD CONSTRAINT auth_roles_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_roles auth_roles_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_roles
    ADD CONSTRAINT auth_roles_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_user_roles auth_user_roles_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_user_roles
    ADD CONSTRAINT auth_user_roles_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_user_roles auth_user_roles_user_id_role_id_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_user_roles
    ADD CONSTRAINT auth_user_roles_user_id_role_id_key UNIQUE (user_id, role_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_users auth_users_email_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_users
    ADD CONSTRAINT auth_users_email_key UNIQUE (email);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_users auth_users_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_users
    ADD CONSTRAINT auth_users_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_users auth_users_public_id_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_users
    ADD CONSTRAINT auth_users_public_id_key UNIQUE (public_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_address_components core_address_components_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_address_components
    ADD CONSTRAINT core_address_components_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_addresses core_addresses_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_addresses
    ADD CONSTRAINT core_addresses_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_addresses core_addresses_public_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_addresses
    ADD CONSTRAINT core_addresses_public_id_key UNIQUE (public_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_area_names core_admin_area_names_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_admin_area_names
    ADD CONSTRAINT core_admin_area_names_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_areas core_admin_areas_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_admin_areas
    ADD CONSTRAINT core_admin_areas_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_areas core_admin_areas_public_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_admin_areas
    ADD CONSTRAINT core_admin_areas_public_id_key UNIQUE (public_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_areas core_admin_areas_slug_key; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_admin_areas
    ADD CONSTRAINT core_admin_areas_slug_key UNIQUE (slug);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_route_names core_bus_route_names_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_route_names
    ADD CONSTRAINT core_bus_route_names_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_route_stops core_bus_route_stops_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_route_stops
    ADD CONSTRAINT core_bus_route_stops_pkey PRIMARY KEY (route_variant_id, stop_id, stop_sequence);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_route_variants core_bus_route_variants_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_route_variants
    ADD CONSTRAINT core_bus_route_variants_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_routes core_bus_routes_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_routes
    ADD CONSTRAINT core_bus_routes_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_routes core_bus_routes_route_code_key; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_routes
    ADD CONSTRAINT core_bus_routes_route_code_key UNIQUE (route_code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_stop_names core_bus_stop_names_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_stop_names
    ADD CONSTRAINT core_bus_stop_names_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_stops core_bus_stops_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_stops
    ADD CONSTRAINT core_bus_stops_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_stops core_bus_stops_public_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_stops
    ADD CONSTRAINT core_bus_stops_public_id_key UNIQUE (public_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_map_buildings core_map_buildings_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_map_buildings
    ADD CONSTRAINT core_map_buildings_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_map_landuse core_map_landuse_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_map_landuse
    ADD CONSTRAINT core_map_landuse_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_map_water_lines core_map_water_lines_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_map_water_lines
    ADD CONSTRAINT core_map_water_lines_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_map_water_polygons core_map_water_polygons_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_map_water_polygons
    ADD CONSTRAINT core_map_water_polygons_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_addresses core_place_addresses_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_addresses
    ADD CONSTRAINT core_place_addresses_pkey PRIMARY KEY (place_id, address_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_contacts core_place_contacts_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_contacts
    ADD CONSTRAINT core_place_contacts_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_contacts core_place_contacts_place_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_contacts
    ADD CONSTRAINT core_place_contacts_place_id_key UNIQUE (place_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_names core_place_names_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_names
    ADD CONSTRAINT core_place_names_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_sources core_place_sources_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_sources
    ADD CONSTRAINT core_place_sources_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_versions core_place_versions_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_versions
    ADD CONSTRAINT core_place_versions_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_versions core_place_versions_place_id_version_no_key; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_versions
    ADD CONSTRAINT core_place_versions_place_id_version_no_key UNIQUE (place_id, version_no);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_places core_places_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_places
    ADD CONSTRAINT core_places_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_places core_places_public_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_places
    ADD CONSTRAINT core_places_public_id_key UNIQUE (public_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_street_names core_street_names_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_street_names
    ADD CONSTRAINT core_street_names_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_streets core_streets_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_streets
    ADD CONSTRAINT core_streets_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_streets core_streets_public_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_streets
    ADD CONSTRAINT core_streets_public_id_key UNIQUE (public_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: metadata metadata_schema_name_table_name_key; Type: CONSTRAINT; Schema: ogr_system_tables; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ogr_system_tables.metadata
    ADD CONSTRAINT metadata_schema_name_table_name_key UNIQUE (schema_name, table_name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: osm2pgsql_properties osm2pgsql_properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY public.osm2pgsql_properties
    ADD CONSTRAINT osm2pgsql_properties_pkey PRIMARY KEY (property);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_lines raw_osm_lines_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.raw_osm_lines
    ADD CONSTRAINT raw_osm_lines_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_lines raw_osm_lines_source_snapshot_id_osm_feature_type_osm_id_key; Type: CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.raw_osm_lines
    ADD CONSTRAINT raw_osm_lines_source_snapshot_id_osm_feature_type_osm_id_key UNIQUE (source_snapshot_id, osm_feature_type, osm_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_points raw_osm_points_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.raw_osm_points
    ADD CONSTRAINT raw_osm_points_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_points raw_osm_points_source_snapshot_id_osm_feature_type_osm_id_key; Type: CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.raw_osm_points
    ADD CONSTRAINT raw_osm_points_source_snapshot_id_osm_feature_type_osm_id_key UNIQUE (source_snapshot_id, osm_feature_type, osm_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_polygons raw_osm_polygons_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.raw_osm_polygons
    ADD CONSTRAINT raw_osm_polygons_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_polygons raw_osm_polygons_source_snapshot_id_osm_feature_type_osm_id_key; Type: CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.raw_osm_polygons
    ADD CONSTRAINT raw_osm_polygons_source_snapshot_id_osm_feature_type_osm_id_key UNIQUE (source_snapshot_id, osm_feature_type, osm_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: v2_kyauktan_custom_boundary v2_kyauktan_custom_boundary_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.v2_kyauktan_custom_boundary
    ADD CONSTRAINT v2_kyauktan_custom_boundary_pkey PRIMARY KEY (ogc_fid);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_address_component_types ref_address_component_types_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_address_component_types
    ADD CONSTRAINT ref_address_component_types_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_address_component_types ref_address_component_types_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_address_component_types
    ADD CONSTRAINT ref_address_component_types_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_address_component_types ref_address_component_types_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_address_component_types
    ADD CONSTRAINT ref_address_component_types_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_address_component_types ref_address_component_types_rank_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_address_component_types
    ADD CONSTRAINT ref_address_component_types_rank_key UNIQUE (rank);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_admin_levels ref_admin_levels_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_admin_levels
    ADD CONSTRAINT ref_admin_levels_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_admin_levels ref_admin_levels_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_admin_levels
    ADD CONSTRAINT ref_admin_levels_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_admin_levels ref_admin_levels_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_admin_levels
    ADD CONSTRAINT ref_admin_levels_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_admin_levels ref_admin_levels_rank_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_admin_levels
    ADD CONSTRAINT ref_admin_levels_rank_key UNIQUE (rank);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_place_classes ref_place_classes_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_place_classes
    ADD CONSTRAINT ref_place_classes_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_place_classes ref_place_classes_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_place_classes
    ADD CONSTRAINT ref_place_classes_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_place_classes ref_place_classes_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_place_classes
    ADD CONSTRAINT ref_place_classes_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_poi_categories ref_poi_categories_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_poi_categories
    ADD CONSTRAINT ref_poi_categories_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_poi_categories ref_poi_categories_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_poi_categories
    ADD CONSTRAINT ref_poi_categories_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_poi_categories ref_poi_categories_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_poi_categories
    ADD CONSTRAINT ref_poi_categories_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_publish_statuses ref_publish_statuses_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_publish_statuses
    ADD CONSTRAINT ref_publish_statuses_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_publish_statuses ref_publish_statuses_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_publish_statuses
    ADD CONSTRAINT ref_publish_statuses_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_publish_statuses ref_publish_statuses_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_publish_statuses
    ADD CONSTRAINT ref_publish_statuses_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_report_statuses ref_report_statuses_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_report_statuses
    ADD CONSTRAINT ref_report_statuses_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_report_statuses ref_report_statuses_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_report_statuses
    ADD CONSTRAINT ref_report_statuses_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_report_statuses ref_report_statuses_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_report_statuses
    ADD CONSTRAINT ref_report_statuses_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_report_types ref_report_types_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_report_types
    ADD CONSTRAINT ref_report_types_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_report_types ref_report_types_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_report_types
    ADD CONSTRAINT ref_report_types_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_report_types ref_report_types_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_report_types
    ADD CONSTRAINT ref_report_types_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_road_classes ref_road_classes_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_road_classes
    ADD CONSTRAINT ref_road_classes_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_road_classes ref_road_classes_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_road_classes
    ADD CONSTRAINT ref_road_classes_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_road_classes ref_road_classes_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_road_classes
    ADD CONSTRAINT ref_road_classes_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_source_types ref_source_types_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_source_types
    ADD CONSTRAINT ref_source_types_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_source_types ref_source_types_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_source_types
    ADD CONSTRAINT ref_source_types_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_source_types ref_source_types_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_source_types
    ADD CONSTRAINT ref_source_types_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_validation_statuses ref_validation_statuses_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_validation_statuses
    ADD CONSTRAINT ref_validation_statuses_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_validation_statuses ref_validation_statuses_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_validation_statuses
    ADD CONSTRAINT ref_validation_statuses_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_validation_statuses ref_validation_statuses_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_validation_statuses
    ADD CONSTRAINT ref_validation_statuses_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_validation_task_types ref_validation_task_types_code_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_validation_task_types
    ADD CONSTRAINT ref_validation_task_types_code_key UNIQUE (code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_validation_task_types ref_validation_task_types_name_key; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_validation_task_types
    ADD CONSTRAINT ref_validation_task_types_name_key UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_validation_task_types ref_validation_task_types_pkey; Type: CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_validation_task_types
    ADD CONSTRAINT ref_validation_task_types_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_admin_area_candidates staging_admin_area_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_admin_area_candidates
    ADD CONSTRAINT staging_admin_area_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_building_candidates staging_building_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_building_candidates
    ADD CONSTRAINT staging_building_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_bus_route_candidates staging_bus_route_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_bus_route_candidates
    ADD CONSTRAINT staging_bus_route_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_bus_stop_candidates staging_bus_stop_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_bus_stop_candidates
    ADD CONSTRAINT staging_bus_stop_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_landuse_candidates staging_landuse_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_landuse_candidates
    ADD CONSTRAINT staging_landuse_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_place_candidates staging_place_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_place_candidates
    ADD CONSTRAINT staging_place_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_place_name_candidates staging_place_name_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_place_name_candidates
    ADD CONSTRAINT staging_place_name_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_road_candidates staging_road_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_road_candidates
    ADD CONSTRAINT staging_road_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_water_line_candidates staging_water_line_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_water_line_candidates
    ADD CONSTRAINT staging_water_line_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_water_polygon_candidates staging_water_polygon_candidates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_water_polygon_candidates
    ADD CONSTRAINT staging_water_polygon_candidates_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_conflict_queue system_conflict_queue_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_conflict_queue
    ADD CONSTRAINT system_conflict_queue_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_diff_items system_diff_items_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_diff_items
    ADD CONSTRAINT system_diff_items_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_diff_runs system_diff_runs_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_diff_runs
    ADD CONSTRAINT system_diff_runs_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_import_batches system_import_batches_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_import_batches
    ADD CONSTRAINT system_import_batches_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_publish_batches system_publish_batches_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_publish_batches
    ADD CONSTRAINT system_publish_batches_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_publish_items system_publish_items_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_publish_items
    ADD CONSTRAINT system_publish_items_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_publish_items system_publish_items_publish_batch_id_entity_family_entity_id_p; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_publish_items
    ADD CONSTRAINT system_publish_items_publish_batch_id_entity_family_entity_id_p UNIQUE (publish_batch_id, entity_family, entity_id, publish_action);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_review_logs system_review_logs_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_review_logs
    ADD CONSTRAINT system_review_logs_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_review_tasks system_review_tasks_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_review_tasks
    ADD CONSTRAINT system_review_tasks_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_source_registry system_source_registry_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_source_registry
    ADD CONSTRAINT system_source_registry_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_source_registry system_source_registry_source_code_key; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_source_registry
    ADD CONSTRAINT system_source_registry_source_code_key UNIQUE (source_code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_source_snapshots system_source_snapshots_pkey; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_source_snapshots
    ADD CONSTRAINT system_source_snapshots_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_source_snapshots system_source_snapshots_source_registry_id_snapshot_ref_key; Type: CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_source_snapshots
    ADD CONSTRAINT system_source_snapshots_source_registry_id_snapshot_ref_key UNIQUE (source_registry_id, snapshot_ref);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_user_roles_role_id_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX IF NOT EXISTS auth_user_roles_role_id_idx ON app_auth.auth_user_roles USING btree (role_id);


--
-- Name: auth_user_roles_user_id_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX IF NOT EXISTS auth_user_roles_user_id_idx ON app_auth.auth_user_roles USING btree (user_id);


--
-- Name: auth_users_is_active_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX IF NOT EXISTS auth_users_is_active_idx ON app_auth.auth_users USING btree (is_active);


--
-- Name: core_address_components_address_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_address_components_address_id_idx ON core.core_address_components USING btree (address_id);


--
-- Name: core_address_components_component_type_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_address_components_component_type_id_idx ON core.core_address_components USING btree (component_type_id);


--
-- Name: core_addresses_admin_area_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_addresses_admin_area_id_idx ON core.core_addresses USING btree (admin_area_id);


--
-- Name: core_addresses_entrance_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_addresses_entrance_geom_gix ON core.core_addresses USING gist (entrance_geom);


--
-- Name: core_addresses_point_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_addresses_point_geom_gix ON core.core_addresses USING gist (point_geom);


--
-- Name: core_addresses_source_type_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_addresses_source_type_id_idx ON core.core_addresses USING btree (source_type_id);


--
-- Name: core_addresses_street_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_addresses_street_id_idx ON core.core_addresses USING btree (street_id);


--
-- Name: core_admin_area_names_admin_area_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_admin_area_names_admin_area_id_idx ON core.core_admin_area_names USING btree (admin_area_id);


--
-- Name: core_admin_areas_admin_level_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_admin_areas_admin_level_id_idx ON core.core_admin_areas USING btree (admin_level_id);


--
-- Name: core_admin_areas_centroid_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_admin_areas_centroid_gix ON core.core_admin_areas USING gist (centroid);


--
-- Name: core_admin_areas_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_admin_areas_geom_gix ON core.core_admin_areas USING gist (geom);


--
-- Name: core_admin_areas_parent_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_admin_areas_parent_id_idx ON core.core_admin_areas USING btree (parent_id);


--
-- Name: core_admin_areas_source_type_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_admin_areas_source_type_id_idx ON core.core_admin_areas USING btree (source_type_id);


--
-- Name: core_bus_route_names_route_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_bus_route_names_route_id_idx ON core.core_bus_route_names USING btree (route_id);


--
-- Name: core_bus_route_stops_stop_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_bus_route_stops_stop_id_idx ON core.core_bus_route_stops USING btree (stop_id);


--
-- Name: core_bus_route_variants_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_bus_route_variants_geom_gix ON core.core_bus_route_variants USING gist (geom);


--
-- Name: core_bus_route_variants_route_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_bus_route_variants_route_id_idx ON core.core_bus_route_variants USING btree (route_id);


--
-- Name: core_bus_routes_source_type_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_bus_routes_source_type_id_idx ON core.core_bus_routes USING btree (source_type_id);


--
-- Name: core_bus_stop_names_stop_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_bus_stop_names_stop_id_idx ON core.core_bus_stop_names USING btree (stop_id);


--
-- Name: core_bus_stops_admin_area_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_bus_stops_admin_area_id_idx ON core.core_bus_stops USING btree (admin_area_id);


--
-- Name: core_bus_stops_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_bus_stops_geom_gix ON core.core_bus_stops USING gist (geom);


--
-- Name: core_bus_stops_source_type_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_bus_stops_source_type_id_idx ON core.core_bus_stops USING btree (source_type_id);


--
-- Name: core_map_buildings_class_code_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_buildings_class_code_idx ON core.core_map_buildings USING btree (class_code);


--
-- Name: core_map_buildings_external_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_buildings_external_id_idx ON core.core_map_buildings USING btree (external_id);


--
-- Name: core_map_buildings_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_buildings_geom_gix ON core.core_map_buildings USING gist (geom);


--
-- Name: core_map_buildings_is_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_buildings_is_active_idx ON core.core_map_buildings USING btree (is_active);


--
-- Name: core_map_landuse_class_code_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_landuse_class_code_idx ON core.core_map_landuse USING btree (class_code);


--
-- Name: core_map_landuse_external_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_landuse_external_id_idx ON core.core_map_landuse USING btree (external_id);


--
-- Name: core_map_landuse_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_landuse_geom_gix ON core.core_map_landuse USING gist (geom);


--
-- Name: core_map_landuse_is_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_landuse_is_active_idx ON core.core_map_landuse USING btree (is_active);


--
-- Name: core_map_water_lines_class_code_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_water_lines_class_code_idx ON core.core_map_water_lines USING btree (class_code);


--
-- Name: core_map_water_lines_external_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_water_lines_external_id_idx ON core.core_map_water_lines USING btree (external_id);


--
-- Name: core_map_water_lines_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_water_lines_geom_gix ON core.core_map_water_lines USING gist (geom);


--
-- Name: core_map_water_lines_is_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_water_lines_is_active_idx ON core.core_map_water_lines USING btree (is_active);


--
-- Name: core_map_water_polygons_class_code_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_water_polygons_class_code_idx ON core.core_map_water_polygons USING btree (class_code);


--
-- Name: core_map_water_polygons_external_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_water_polygons_external_id_idx ON core.core_map_water_polygons USING btree (external_id);


--
-- Name: core_map_water_polygons_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_water_polygons_geom_gix ON core.core_map_water_polygons USING gist (geom);


--
-- Name: core_map_water_polygons_is_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_map_water_polygons_is_active_idx ON core.core_map_water_polygons USING btree (is_active);


--
-- Name: core_place_addresses_address_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_place_addresses_address_id_idx ON core.core_place_addresses USING btree (address_id);


--
-- Name: core_place_names_place_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_place_names_place_id_idx ON core.core_place_names USING btree (place_id);


--
-- Name: core_place_sources_place_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_place_sources_place_id_idx ON core.core_place_sources USING btree (place_id);


--
-- Name: core_place_sources_source_type_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_place_sources_source_type_id_idx ON core.core_place_sources USING btree (source_type_id);


--
-- Name: core_place_versions_publish_status_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_place_versions_publish_status_id_idx ON core.core_place_versions USING btree (publish_status_id);


--
-- Name: core_places_admin_area_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_places_admin_area_id_idx ON core.core_places USING btree (admin_area_id);


--
-- Name: core_places_category_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_places_category_id_idx ON core.core_places USING btree (category_id);


--
-- Name: core_places_current_version_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_places_current_version_id_idx ON core.core_places USING btree (current_version_id);


--
-- Name: core_places_entry_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_places_entry_geom_gix ON core.core_places USING gist (entry_geom);


--
-- Name: core_places_footprint_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_places_footprint_geom_gix ON core.core_places USING gist (footprint_geom);


--
-- Name: core_places_point_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_places_point_geom_gix ON core.core_places USING gist (point_geom);


--
-- Name: core_places_publish_status_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_places_publish_status_id_idx ON core.core_places USING btree (publish_status_id);


--
-- Name: core_places_source_type_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_places_source_type_id_idx ON core.core_places USING btree (source_type_id);


--
-- Name: core_street_names_street_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_street_names_street_id_idx ON core.core_street_names USING btree (street_id);


--
-- Name: core_streets_admin_area_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_streets_admin_area_id_idx ON core.core_streets USING btree (admin_area_id);


--
-- Name: core_streets_geom_gix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_streets_geom_gix ON core.core_streets USING gist (geom);


--
-- Name: core_streets_source_type_id_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX IF NOT EXISTS core_streets_source_type_id_idx ON core.core_streets USING btree (source_type_id);


--
-- Name: raw_osm_lines_geom_gix; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_lines_geom_gix ON raw.raw_osm_lines USING gist (geom);


--
-- Name: raw_osm_lines_osm_id_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_lines_osm_id_idx ON raw.raw_osm_lines USING btree (osm_id);


--
-- Name: raw_osm_lines_source_snapshot_id_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_lines_source_snapshot_id_idx ON raw.raw_osm_lines USING btree (source_snapshot_id);


--
-- Name: raw_osm_lines_tags_gin_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_lines_tags_gin_idx ON raw.raw_osm_lines USING gin (tags);


--
-- Name: raw_osm_points_geom_gix; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_points_geom_gix ON raw.raw_osm_points USING gist (geom);


--
-- Name: raw_osm_points_osm_id_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_points_osm_id_idx ON raw.raw_osm_points USING btree (osm_id);


--
-- Name: raw_osm_points_source_snapshot_id_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_points_source_snapshot_id_idx ON raw.raw_osm_points USING btree (source_snapshot_id);


--
-- Name: raw_osm_points_tags_gin_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_points_tags_gin_idx ON raw.raw_osm_points USING gin (tags);


--
-- Name: raw_osm_polygons_geom_gix; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_polygons_geom_gix ON raw.raw_osm_polygons USING gist (geom);


--
-- Name: raw_osm_polygons_osm_id_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_polygons_osm_id_idx ON raw.raw_osm_polygons USING btree (osm_id);


--
-- Name: raw_osm_polygons_source_snapshot_id_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_polygons_source_snapshot_id_idx ON raw.raw_osm_polygons USING btree (source_snapshot_id);


--
-- Name: raw_osm_polygons_tags_gin_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS raw_osm_polygons_tags_gin_idx ON raw.raw_osm_polygons USING gin (tags);


--
-- Name: v2_kyauktan_custom_boundary_wkb_geometry_geom_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX IF NOT EXISTS v2_kyauktan_custom_boundary_wkb_geometry_geom_idx ON raw.v2_kyauktan_custom_boundary USING gist (wkb_geometry);


--
-- Name: staging_admin_area_candidates_admin_level_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_admin_area_candidates_admin_level_id_idx ON staging.staging_admin_area_candidates USING btree (admin_level_id);


--
-- Name: staging_admin_area_candidates_centroid_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_admin_area_candidates_centroid_gix ON staging.staging_admin_area_candidates USING gist (centroid);


--
-- Name: staging_admin_area_candidates_geom_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_admin_area_candidates_geom_gix ON staging.staging_admin_area_candidates USING gist (geom);


--
-- Name: staging_admin_area_candidates_match_status_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_admin_area_candidates_match_status_idx ON staging.staging_admin_area_candidates USING btree (match_status);


--
-- Name: staging_admin_area_candidates_parent_candidate_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_admin_area_candidates_parent_candidate_id_idx ON staging.staging_admin_area_candidates USING btree (parent_candidate_id);


--
-- Name: staging_admin_area_candidates_source_snapshot_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_admin_area_candidates_source_snapshot_id_idx ON staging.staging_admin_area_candidates USING btree (source_snapshot_id);


--
-- Name: staging_building_candidates_class_code_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_building_candidates_class_code_idx ON staging.staging_building_candidates USING btree (class_code);


--
-- Name: staging_building_candidates_external_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_building_candidates_external_id_idx ON staging.staging_building_candidates USING btree (external_id);


--
-- Name: staging_building_candidates_geom_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_building_candidates_geom_gix ON staging.staging_building_candidates USING gist (geom);


--
-- Name: staging_building_candidates_match_status_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_building_candidates_match_status_idx ON staging.staging_building_candidates USING btree (match_status);


--
-- Name: staging_bus_route_candidates_geom_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_bus_route_candidates_geom_gix ON staging.staging_bus_route_candidates USING gist (geom);


--
-- Name: staging_bus_route_candidates_match_status_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_bus_route_candidates_match_status_idx ON staging.staging_bus_route_candidates USING btree (match_status);


--
-- Name: staging_bus_route_candidates_route_code_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_bus_route_candidates_route_code_idx ON staging.staging_bus_route_candidates USING btree (route_code);


--
-- Name: staging_bus_route_candidates_source_snapshot_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_bus_route_candidates_source_snapshot_id_idx ON staging.staging_bus_route_candidates USING btree (source_snapshot_id);


--
-- Name: staging_bus_stop_candidates_admin_area_candidate_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_bus_stop_candidates_admin_area_candidate_id_idx ON staging.staging_bus_stop_candidates USING btree (admin_area_candidate_id);


--
-- Name: staging_bus_stop_candidates_match_status_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_bus_stop_candidates_match_status_idx ON staging.staging_bus_stop_candidates USING btree (match_status);


--
-- Name: staging_bus_stop_candidates_point_geom_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_bus_stop_candidates_point_geom_gix ON staging.staging_bus_stop_candidates USING gist (point_geom);


--
-- Name: staging_bus_stop_candidates_source_snapshot_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_bus_stop_candidates_source_snapshot_id_idx ON staging.staging_bus_stop_candidates USING btree (source_snapshot_id);


--
-- Name: staging_landuse_candidates_class_code_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_landuse_candidates_class_code_idx ON staging.staging_landuse_candidates USING btree (class_code);


--
-- Name: staging_landuse_candidates_external_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_landuse_candidates_external_id_idx ON staging.staging_landuse_candidates USING btree (external_id);


--
-- Name: staging_landuse_candidates_geom_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_landuse_candidates_geom_gix ON staging.staging_landuse_candidates USING gist (geom);


--
-- Name: staging_landuse_candidates_match_status_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_landuse_candidates_match_status_idx ON staging.staging_landuse_candidates USING btree (match_status);


--
-- Name: staging_place_candidates_admin_area_candidate_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_place_candidates_admin_area_candidate_id_idx ON staging.staging_place_candidates USING btree (admin_area_candidate_id);


--
-- Name: staging_place_candidates_match_status_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_place_candidates_match_status_idx ON staging.staging_place_candidates USING btree (match_status);


--
-- Name: staging_place_candidates_place_class_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_place_candidates_place_class_id_idx ON staging.staging_place_candidates USING btree (place_class_id);


--
-- Name: staging_place_candidates_poi_category_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_place_candidates_poi_category_id_idx ON staging.staging_place_candidates USING btree (poi_category_id);


--
-- Name: staging_place_candidates_point_geom_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_place_candidates_point_geom_gix ON staging.staging_place_candidates USING gist (point_geom);


--
-- Name: staging_place_candidates_source_snapshot_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_place_candidates_source_snapshot_id_idx ON staging.staging_place_candidates USING btree (source_snapshot_id);


--
-- Name: staging_place_name_candidates_language_code_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_place_name_candidates_language_code_idx ON staging.staging_place_name_candidates USING btree (language_code);


--
-- Name: staging_place_name_candidates_place_candidate_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_place_name_candidates_place_candidate_id_idx ON staging.staging_place_name_candidates USING btree (place_candidate_id);


--
-- Name: staging_place_name_candidates_source_snapshot_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_place_name_candidates_source_snapshot_id_idx ON staging.staging_place_name_candidates USING btree (source_snapshot_id);


--
-- Name: staging_road_candidates_geom_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_road_candidates_geom_gix ON staging.staging_road_candidates USING gist (geom);


--
-- Name: staging_road_candidates_match_status_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_road_candidates_match_status_idx ON staging.staging_road_candidates USING btree (match_status);


--
-- Name: staging_road_candidates_road_class_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_road_candidates_road_class_id_idx ON staging.staging_road_candidates USING btree (road_class_id);


--
-- Name: staging_road_candidates_source_snapshot_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_road_candidates_source_snapshot_id_idx ON staging.staging_road_candidates USING btree (source_snapshot_id);


--
-- Name: staging_water_line_candidates_class_code_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_water_line_candidates_class_code_idx ON staging.staging_water_line_candidates USING btree (class_code);


--
-- Name: staging_water_line_candidates_external_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_water_line_candidates_external_id_idx ON staging.staging_water_line_candidates USING btree (external_id);


--
-- Name: staging_water_line_candidates_geom_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_water_line_candidates_geom_gix ON staging.staging_water_line_candidates USING gist (geom);


--
-- Name: staging_water_line_candidates_match_status_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_water_line_candidates_match_status_idx ON staging.staging_water_line_candidates USING btree (match_status);


--
-- Name: staging_water_polygon_candidates_class_code_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_water_polygon_candidates_class_code_idx ON staging.staging_water_polygon_candidates USING btree (class_code);


--
-- Name: staging_water_polygon_candidates_external_id_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_water_polygon_candidates_external_id_idx ON staging.staging_water_polygon_candidates USING btree (external_id);


--
-- Name: staging_water_polygon_candidates_geom_gix; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_water_polygon_candidates_geom_gix ON staging.staging_water_polygon_candidates USING gist (geom);


--
-- Name: staging_water_polygon_candidates_match_status_idx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX IF NOT EXISTS staging_water_polygon_candidates_match_status_idx ON staging.staging_water_polygon_candidates USING btree (match_status);


--
-- Name: system_conflict_queue_diff_item_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_conflict_queue_diff_item_id_idx ON system.system_conflict_queue USING btree (diff_item_id);


--
-- Name: system_conflict_queue_resolution_status_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_conflict_queue_resolution_status_idx ON system.system_conflict_queue USING btree (resolution_status);


--
-- Name: system_diff_items_diff_run_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_diff_items_diff_run_id_idx ON system.system_diff_items USING btree (diff_run_id);


--
-- Name: system_diff_items_entity_family_external_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_diff_items_entity_family_external_id_idx ON system.system_diff_items USING btree (entity_family, external_id);


--
-- Name: system_diff_items_review_status_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_diff_items_review_status_idx ON system.system_diff_items USING btree (review_status);


--
-- Name: system_diff_runs_current_snapshot_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_diff_runs_current_snapshot_id_idx ON system.system_diff_runs USING btree (current_snapshot_id);


--
-- Name: system_diff_runs_previous_snapshot_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_diff_runs_previous_snapshot_id_idx ON system.system_diff_runs USING btree (previous_snapshot_id);


--
-- Name: system_diff_runs_status_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_diff_runs_status_idx ON system.system_diff_runs USING btree (status);


--
-- Name: system_import_batches_source_registry_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_import_batches_source_registry_id_idx ON system.system_import_batches USING btree (source_registry_id);


--
-- Name: system_import_batches_status_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_import_batches_status_idx ON system.system_import_batches USING btree (status);


--
-- Name: system_publish_batches_status_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_publish_batches_status_idx ON system.system_publish_batches USING btree (status);


--
-- Name: system_publish_items_entity_family_entity_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_publish_items_entity_family_entity_id_idx ON system.system_publish_items USING btree (entity_family, entity_id);


--
-- Name: system_review_logs_entity_family_entity_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_review_logs_entity_family_entity_id_idx ON system.system_review_logs USING btree (entity_family, entity_id);


--
-- Name: system_review_tasks_assigned_to_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_review_tasks_assigned_to_idx ON system.system_review_tasks USING btree (assigned_to);


--
-- Name: system_review_tasks_entity_family_entity_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_review_tasks_entity_family_entity_id_idx ON system.system_review_tasks USING btree (entity_family, entity_id);


--
-- Name: system_review_tasks_status_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_review_tasks_status_id_idx ON system.system_review_tasks USING btree (status_id);


--
-- Name: system_review_tasks_task_type_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_review_tasks_task_type_id_idx ON system.system_review_tasks USING btree (task_type_id);


--
-- Name: system_source_registry_source_type_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_source_registry_source_type_id_idx ON system.system_source_registry USING btree (source_type_id);


--
-- Name: system_source_snapshots_import_batch_id_idx; Type: INDEX; Schema: system; Owner: -
--

CREATE INDEX IF NOT EXISTS system_source_snapshots_import_batch_id_idx ON system.system_source_snapshots USING btree (import_batch_id);


--
-- Name: osm_lines_geom_idx; Type: INDEX; Schema: tmp_import; Owner: -
--

CREATE INDEX IF NOT EXISTS osm_lines_geom_idx ON tmp_import.osm_lines USING gist (geom) WITH (fillfactor='100');


--
-- Name: osm_points_geom_idx; Type: INDEX; Schema: tmp_import; Owner: -
--

CREATE INDEX IF NOT EXISTS osm_points_geom_idx ON tmp_import.osm_points USING gist (geom) WITH (fillfactor='100');


--
-- Name: osm_polygons_geom_idx; Type: INDEX; Schema: tmp_import; Owner: -
--

CREATE INDEX IF NOT EXISTS osm_polygons_geom_idx ON tmp_import.osm_polygons USING gist (geom) WITH (fillfactor='100');


--
-- Name: auth_user_roles auth_user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_user_roles
    ADD CONSTRAINT auth_user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES app_auth.auth_roles(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: auth_user_roles auth_user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY app_auth.auth_user_roles
    ADD CONSTRAINT auth_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_address_components core_address_components_address_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_address_components
    ADD CONSTRAINT core_address_components_address_id_fkey FOREIGN KEY (address_id) REFERENCES core.core_addresses(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_address_components core_address_components_component_type_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_address_components
    ADD CONSTRAINT core_address_components_component_type_id_fkey FOREIGN KEY (component_type_id) REFERENCES ref.ref_address_component_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_addresses core_addresses_admin_area_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_addresses
    ADD CONSTRAINT core_addresses_admin_area_id_fkey FOREIGN KEY (admin_area_id) REFERENCES core.core_admin_areas(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_addresses core_addresses_source_type_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_addresses
    ADD CONSTRAINT core_addresses_source_type_id_fkey FOREIGN KEY (source_type_id) REFERENCES ref.ref_source_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_addresses core_addresses_street_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_addresses
    ADD CONSTRAINT core_addresses_street_id_fkey FOREIGN KEY (street_id) REFERENCES core.core_streets(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_area_names core_admin_area_names_admin_area_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_admin_area_names
    ADD CONSTRAINT core_admin_area_names_admin_area_id_fkey FOREIGN KEY (admin_area_id) REFERENCES core.core_admin_areas(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_areas core_admin_areas_admin_level_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_admin_areas
    ADD CONSTRAINT core_admin_areas_admin_level_id_fkey FOREIGN KEY (admin_level_id) REFERENCES ref.ref_admin_levels(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_areas core_admin_areas_parent_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_admin_areas
    ADD CONSTRAINT core_admin_areas_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES core.core_admin_areas(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_admin_areas core_admin_areas_source_type_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_admin_areas
    ADD CONSTRAINT core_admin_areas_source_type_id_fkey FOREIGN KEY (source_type_id) REFERENCES ref.ref_source_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_route_names core_bus_route_names_route_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_route_names
    ADD CONSTRAINT core_bus_route_names_route_id_fkey FOREIGN KEY (route_id) REFERENCES core.core_bus_routes(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_route_stops core_bus_route_stops_route_variant_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_route_stops
    ADD CONSTRAINT core_bus_route_stops_route_variant_id_fkey FOREIGN KEY (route_variant_id) REFERENCES core.core_bus_route_variants(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_route_stops core_bus_route_stops_stop_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_route_stops
    ADD CONSTRAINT core_bus_route_stops_stop_id_fkey FOREIGN KEY (stop_id) REFERENCES core.core_bus_stops(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_route_variants core_bus_route_variants_route_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_route_variants
    ADD CONSTRAINT core_bus_route_variants_route_id_fkey FOREIGN KEY (route_id) REFERENCES core.core_bus_routes(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_routes core_bus_routes_source_type_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_routes
    ADD CONSTRAINT core_bus_routes_source_type_id_fkey FOREIGN KEY (source_type_id) REFERENCES ref.ref_source_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_stop_names core_bus_stop_names_stop_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_stop_names
    ADD CONSTRAINT core_bus_stop_names_stop_id_fkey FOREIGN KEY (stop_id) REFERENCES core.core_bus_stops(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_stops core_bus_stops_admin_area_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_stops
    ADD CONSTRAINT core_bus_stops_admin_area_id_fkey FOREIGN KEY (admin_area_id) REFERENCES core.core_admin_areas(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_bus_stops core_bus_stops_source_type_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_bus_stops
    ADD CONSTRAINT core_bus_stops_source_type_id_fkey FOREIGN KEY (source_type_id) REFERENCES ref.ref_source_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_addresses core_place_addresses_address_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_addresses
    ADD CONSTRAINT core_place_addresses_address_id_fkey FOREIGN KEY (address_id) REFERENCES core.core_addresses(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_addresses core_place_addresses_place_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_addresses
    ADD CONSTRAINT core_place_addresses_place_id_fkey FOREIGN KEY (place_id) REFERENCES core.core_places(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_contacts core_place_contacts_place_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_contacts
    ADD CONSTRAINT core_place_contacts_place_id_fkey FOREIGN KEY (place_id) REFERENCES core.core_places(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_names core_place_names_place_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_names
    ADD CONSTRAINT core_place_names_place_id_fkey FOREIGN KEY (place_id) REFERENCES core.core_places(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_sources core_place_sources_place_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_sources
    ADD CONSTRAINT core_place_sources_place_id_fkey FOREIGN KEY (place_id) REFERENCES core.core_places(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_sources core_place_sources_source_type_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_sources
    ADD CONSTRAINT core_place_sources_source_type_id_fkey FOREIGN KEY (source_type_id) REFERENCES ref.ref_source_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_versions core_place_versions_place_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_versions
    ADD CONSTRAINT core_place_versions_place_id_fkey FOREIGN KEY (place_id) REFERENCES core.core_places(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_place_versions core_place_versions_publish_status_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_place_versions
    ADD CONSTRAINT core_place_versions_publish_status_id_fkey FOREIGN KEY (publish_status_id) REFERENCES ref.ref_publish_statuses(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_places core_places_admin_area_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_places
    ADD CONSTRAINT core_places_admin_area_id_fkey FOREIGN KEY (admin_area_id) REFERENCES core.core_admin_areas(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_places core_places_category_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_places
    ADD CONSTRAINT core_places_category_id_fkey FOREIGN KEY (category_id) REFERENCES ref.ref_poi_categories(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_places core_places_current_version_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_places
    ADD CONSTRAINT core_places_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES core.core_place_versions(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_places core_places_publish_status_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_places
    ADD CONSTRAINT core_places_publish_status_id_fkey FOREIGN KEY (publish_status_id) REFERENCES ref.ref_publish_statuses(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_places core_places_source_type_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_places
    ADD CONSTRAINT core_places_source_type_id_fkey FOREIGN KEY (source_type_id) REFERENCES ref.ref_source_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_street_names core_street_names_street_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_street_names
    ADD CONSTRAINT core_street_names_street_id_fkey FOREIGN KEY (street_id) REFERENCES core.core_streets(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_streets core_streets_admin_area_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_streets
    ADD CONSTRAINT core_streets_admin_area_id_fkey FOREIGN KEY (admin_area_id) REFERENCES core.core_admin_areas(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: core_streets core_streets_source_type_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY core.core_streets
    ADD CONSTRAINT core_streets_source_type_id_fkey FOREIGN KEY (source_type_id) REFERENCES ref.ref_source_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_lines raw_osm_lines_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.raw_osm_lines
    ADD CONSTRAINT raw_osm_lines_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_points raw_osm_points_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.raw_osm_points
    ADD CONSTRAINT raw_osm_points_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: raw_osm_polygons raw_osm_polygons_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: raw; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY raw.raw_osm_polygons
    ADD CONSTRAINT raw_osm_polygons_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ref_poi_categories ref_poi_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: ref; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY ref.ref_poi_categories
    ADD CONSTRAINT ref_poi_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES ref.ref_poi_categories(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_admin_area_candidates staging_admin_area_candidates_admin_level_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_admin_area_candidates
    ADD CONSTRAINT staging_admin_area_candidates_admin_level_id_fkey FOREIGN KEY (admin_level_id) REFERENCES ref.ref_admin_levels(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_admin_area_candidates staging_admin_area_candidates_parent_candidate_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_admin_area_candidates
    ADD CONSTRAINT staging_admin_area_candidates_parent_candidate_id_fkey FOREIGN KEY (parent_candidate_id) REFERENCES staging.staging_admin_area_candidates(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_admin_area_candidates staging_admin_area_candidates_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_admin_area_candidates
    ADD CONSTRAINT staging_admin_area_candidates_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_bus_route_candidates staging_bus_route_candidates_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_bus_route_candidates
    ADD CONSTRAINT staging_bus_route_candidates_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_bus_stop_candidates staging_bus_stop_candidates_admin_area_candidate_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_bus_stop_candidates
    ADD CONSTRAINT staging_bus_stop_candidates_admin_area_candidate_id_fkey FOREIGN KEY (admin_area_candidate_id) REFERENCES staging.staging_admin_area_candidates(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_bus_stop_candidates staging_bus_stop_candidates_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_bus_stop_candidates
    ADD CONSTRAINT staging_bus_stop_candidates_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_place_candidates staging_place_candidates_admin_area_candidate_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_place_candidates
    ADD CONSTRAINT staging_place_candidates_admin_area_candidate_id_fkey FOREIGN KEY (admin_area_candidate_id) REFERENCES staging.staging_admin_area_candidates(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_place_candidates staging_place_candidates_place_class_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_place_candidates
    ADD CONSTRAINT staging_place_candidates_place_class_id_fkey FOREIGN KEY (place_class_id) REFERENCES ref.ref_place_classes(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_place_candidates staging_place_candidates_poi_category_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_place_candidates
    ADD CONSTRAINT staging_place_candidates_poi_category_id_fkey FOREIGN KEY (poi_category_id) REFERENCES ref.ref_poi_categories(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_place_candidates staging_place_candidates_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_place_candidates
    ADD CONSTRAINT staging_place_candidates_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_place_name_candidates staging_place_name_candidates_place_candidate_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_place_name_candidates
    ADD CONSTRAINT staging_place_name_candidates_place_candidate_id_fkey FOREIGN KEY (place_candidate_id) REFERENCES staging.staging_place_candidates(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_place_name_candidates staging_place_name_candidates_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_place_name_candidates
    ADD CONSTRAINT staging_place_name_candidates_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_road_candidates staging_road_candidates_road_class_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_road_candidates
    ADD CONSTRAINT staging_road_candidates_road_class_id_fkey FOREIGN KEY (road_class_id) REFERENCES ref.ref_road_classes(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: staging_road_candidates staging_road_candidates_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY staging.staging_road_candidates
    ADD CONSTRAINT staging_road_candidates_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_conflict_queue system_conflict_queue_diff_item_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_conflict_queue
    ADD CONSTRAINT system_conflict_queue_diff_item_id_fkey FOREIGN KEY (diff_item_id) REFERENCES system.system_diff_items(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_diff_items system_diff_items_diff_run_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_diff_items
    ADD CONSTRAINT system_diff_items_diff_run_id_fkey FOREIGN KEY (diff_run_id) REFERENCES system.system_diff_runs(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_diff_runs system_diff_runs_current_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_diff_runs
    ADD CONSTRAINT system_diff_runs_current_snapshot_id_fkey FOREIGN KEY (current_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_diff_runs system_diff_runs_previous_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_diff_runs
    ADD CONSTRAINT system_diff_runs_previous_snapshot_id_fkey FOREIGN KEY (previous_snapshot_id) REFERENCES system.system_source_snapshots(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_import_batches system_import_batches_source_registry_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_import_batches
    ADD CONSTRAINT system_import_batches_source_registry_id_fkey FOREIGN KEY (source_registry_id) REFERENCES system.system_source_registry(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_publish_items system_publish_items_publish_batch_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_publish_items
    ADD CONSTRAINT system_publish_items_publish_batch_id_fkey FOREIGN KEY (publish_batch_id) REFERENCES system.system_publish_batches(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_review_tasks system_review_tasks_status_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_review_tasks
    ADD CONSTRAINT system_review_tasks_status_id_fkey FOREIGN KEY (status_id) REFERENCES ref.ref_validation_statuses(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_review_tasks system_review_tasks_task_type_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_review_tasks
    ADD CONSTRAINT system_review_tasks_task_type_id_fkey FOREIGN KEY (task_type_id) REFERENCES ref.ref_validation_task_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_source_registry system_source_registry_source_type_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_source_registry
    ADD CONSTRAINT system_source_registry_source_type_id_fkey FOREIGN KEY (source_type_id) REFERENCES ref.ref_source_types(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_source_snapshots system_source_snapshots_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_source_snapshots
    ADD CONSTRAINT system_source_snapshots_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES system.system_import_batches(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: system_source_snapshots system_source_snapshots_source_registry_id_fkey; Type: FK CONSTRAINT; Schema: system; Owner: -
--

DO $baseline$ BEGIN
ALTER TABLE ONLY system.system_source_snapshots
    ADD CONSTRAINT system_source_snapshots_source_registry_id_fkey FOREIGN KEY (source_registry_id) REFERENCES system.system_source_registry(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $baseline$;



--
-- Name: ogr_system_tables_event_trigger_for_metadata; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER ogr_system_tables_event_trigger_for_metadata ON sql_drop
   EXECUTE FUNCTION ogr_system_tables.event_trigger_function_for_metadata();


--
-- PostgreSQL database dump complete
--


