-- =============================================================================
-- transport-fast-publish — osm2pgsql flex extraction (LOCAL ONLY)
--
-- Runs ONLY against LOCAL_DATABASE_URL via osm2pgsql. Writes tmp tables in
-- the local-only schema tmp_transport_import:
--   * osm_transport_points            (geometry Point, 4326)        [Phase 2]
--   * osm_transport_lines             (geometry LineString, 4326)   [Phase 2]
--   * osm_transport_relations         (no geometry; route metadata) [Phase 6]
--   * osm_transport_relation_members  (no geometry; member refs)    [Phase 6]
--
-- This is raw OSM extraction for local processing. It does NOT touch Supabase
-- and does NOT create raw/staging tables.
--
-- Relations: only public-transport route relations are extracted. We store the
-- relation METADATA (route + route_master) plus its ordered member references.
-- For best-effort route-path building (Phase 8) we ALSO stage the geometry of
-- way members of accepted route relations into osm_transport_lines, even when
-- those ways are plain highways (transport_kind='route_member_way'). This uses
-- select_relation_members to mark the member ways for the two-stage pass, so
-- osm2pgsql must run with --slim. No path/stop ordering is materialized in Lua;
-- the merge into a LineString happens later in PostGIS.
--
-- external_id convention:
--   node     = osm:N:<id>
--   way      = osm:W:<id>
--   relation = osm:R:<id>
--
-- Full OSM tags are preserved verbatim in the `tags` jsonb column.
-- The schema tmp_transport_import is created by sql/local/00_prepare_local_transport_import.sql
-- before this runs.
-- =============================================================================

local SCHEMA = 'tmp_transport_import'

local tables = {}

-- Way ids that are members of accepted route relations. Populated during the
-- relation pre-pass (osm2pgsql.select_relation_members) and consulted in
-- process_way so the geometry of plain (e.g. highway) member ways is captured
-- into osm_transport_lines for best-effort route-path building.
local route_member_way_ids = {}

-- Way ids already emitted into a geometry table. osm2pgsql reprocesses marked
-- route-member ways in stage 2, but our tmp tables have no id column, so it
-- cannot replace the stage-1 row (see the "doesn't have an id column" warning).
-- Without this guard, a way that is BOTH a classified line (e.g. railway=rail)
-- AND a member of a route relation gets inserted twice, producing duplicate
-- external_ids that fail local validation. The Lua state persists across both
-- stages, so a simple set is sufficient.
local emitted_way_ids = {}

tables.points = osm2pgsql.define_table({
    name = 'osm_transport_points',
    schema = SCHEMA,
    -- No `ids` block on purpose: we store osm_id / osm_feature_type as plain
    -- text ('node'/'way') and a string external_id, per the pipeline contract.
    columns = {
        { column = 'osm_id',           type = 'text', not_null = true },
        { column = 'osm_feature_type', type = 'text', not_null = true },
        { column = 'external_id',      type = 'text', not_null = true },
        { column = 'transport_kind',   type = 'text' },
        { column = 'mode',             type = 'text' },
        { column = 'tags',             type = 'jsonb' },
        { column = 'geom',             type = 'point', projection = 4326 },
    },
})

tables.lines = osm2pgsql.define_table({
    name = 'osm_transport_lines',
    schema = SCHEMA,
    columns = {
        { column = 'osm_id',           type = 'text', not_null = true },
        { column = 'osm_feature_type', type = 'text', not_null = true },
        { column = 'external_id',      type = 'text', not_null = true },
        { column = 'transport_kind',   type = 'text' },
        { column = 'mode',             type = 'text' },
        { column = 'line_type',        type = 'text' },
        { column = 'tags',             type = 'jsonb' },
        { column = 'geom',             type = 'linestring', projection = 4326 },
    },
})

-- Route relation metadata (no geometry). One row per extracted route relation.
tables.relations = osm2pgsql.define_table({
    name = 'osm_transport_relations',
    schema = SCHEMA,
    columns = {
        { column = 'osm_id',           type = 'text', not_null = true },
        { column = 'osm_feature_type', type = 'text', not_null = true },
        { column = 'external_id',      type = 'text', not_null = true },
        { column = 'relation_type',    type = 'text' },  -- route | route_master
        { column = 'mode',             type = 'text' },  -- normalized: bus | train | ferry
        { column = 'route_kind',       type = 'text' },  -- raw OSM route/route_master value
        { column = 'tags',             type = 'jsonb' },
    },
})

-- Ordered member references for each extracted route relation (no geometry).
tables.relation_members = osm2pgsql.define_table({
    name = 'osm_transport_relation_members',
    schema = SCHEMA,
    columns = {
        { column = 'relation_external_id', type = 'text', not_null = true },
        { column = 'relation_osm_id',      type = 'text', not_null = true },
        { column = 'member_sequence',      type = 'int4' },
        { column = 'member_type',          type = 'text' },  -- node | way | relation
        { column = 'member_ref',           type = 'text' },
        { column = 'member_external_id',   type = 'text' },  -- osm:N|W|R:<ref>
        { column = 'member_role',          type = 'text' },
    },
})

-- -----------------------------------------------------------------------------
-- Classification
-- -----------------------------------------------------------------------------

-- railway=* values that are linear infrastructure (not point stops).
local RAILWAY_LINE_TYPES = {
    rail         = 'rail',
    light_rail   = 'light_rail',
    subway       = 'subway',
    tram         = 'tram',
    narrow_gauge = 'narrow_gauge',
    monorail     = 'monorail',
    construction = 'construction',
    disused      = 'disused',
    abandoned    = 'abandoned',
}

-- Returns transport_kind, mode for a point-like transport feature, else nil.
-- Safe against missing tags: indexing an absent key just yields nil.
local function classify_point(tags)
    local highway = tags.highway
    local pt      = tags.public_transport
    local amenity = tags.amenity
    local railway = tags.railway
    local aeroway = tags.aeroway

    -- Bus
    if highway == 'bus_stop' then
        return 'bus_stop', 'bus'
    end
    if pt == 'platform' and tags.bus == 'yes' then
        return 'bus_platform', 'bus'
    end
    if pt == 'stop_position' and tags.bus == 'yes' then
        return 'bus_stop_position', 'bus'
    end
    if amenity == 'bus_station' then
        return 'bus_station', 'bus'
    end
    if pt == 'station' and tags.bus == 'yes' then
        return 'bus_station_pt', 'bus'
    end

    -- Rail (point stops / access)
    if railway == 'station' then
        return 'railway_station', 'train'
    end
    if railway == 'halt' then
        return 'railway_halt', 'train'
    end
    if railway == 'platform' then
        return 'railway_platform', 'train'
    end
    if railway == 'tram_stop' then
        return 'tram_stop', 'train'
    end
    if railway == 'subway_entrance' then
        return 'subway_entrance', 'train'
    end

    -- Ferry
    if amenity == 'ferry_terminal' then
        return 'ferry_terminal', 'ferry'
    end
    if pt == 'platform' and tags.ferry == 'yes' then
        return 'ferry_platform', 'ferry'
    end

    -- Air
    if aeroway == 'aerodrome' then
        return 'aerodrome', 'air'
    end
    if aeroway == 'terminal' then
        return 'airport_terminal', 'air'
    end
    if aeroway == 'helipad' then
        return 'helipad', 'air'
    end

    return nil
end

-- Public-transport route relation values we accept, mapped to a normalized mode.
-- trolleybus rides with buses; tram/subway/light_rail ride with train.
local ROUTE_MODE = {
    bus        = 'bus',
    trolleybus = 'bus',
    train      = 'train',
    tram       = 'train',
    subway     = 'train',
    light_rail = 'train',
    ferry      = 'ferry',
}

-- Returns relation_type, mode, route_kind for an accepted route relation, else nil.
-- Handles both type=route (route=*) and type=route_master (route_master=*).
local function classify_relation(tags)
    local rtype = tags.type
    if rtype ~= 'route' and rtype ~= 'route_master' then
        return nil
    end
    local route_kind = (rtype == 'route') and tags.route or tags.route_master
    if route_kind == nil then
        return nil
    end
    local mode = ROUTE_MODE[route_kind]
    if mode == nil then
        return nil
    end
    return rtype, mode, route_kind
end

-- Returns transport_kind, mode, line_type for a linear feature, else nil.
local function classify_line(tags)
    local railway = tags.railway
    if railway ~= nil then
        local line_type = RAILWAY_LINE_TYPES[railway]
        if line_type ~= nil then
            return 'railway_' .. railway, 'train', line_type
        end
    end

    if tags.route == 'ferry' then
        return 'ferry_route', 'ferry', 'ferry'
    end
    if tags.ferry == 'yes' then
        return 'ferry_way', 'ferry', 'ferry'
    end

    return nil
end

-- -----------------------------------------------------------------------------
-- Geometry helpers (defensive: never crash on degenerate / missing geometry)
-- -----------------------------------------------------------------------------
local function is_usable(geom)
    return geom ~= nil and not geom:is_null()
end

-- Representative point for a way (closed -> polygon centroid, open -> line centroid).
local function way_representative_point(object)
    if object.is_closed then
        local ok, g = pcall(function() return object:as_polygon():centroid() end)
        if ok and is_usable(g) then
            return g
        end
    end
    local ok, g = pcall(function() return object:as_linestring():centroid() end)
    if ok and is_usable(g) then
        return g
    end
    return nil
end

-- -----------------------------------------------------------------------------
-- Processing
-- -----------------------------------------------------------------------------
function osm2pgsql.process_node(object)
    local kind, mode = classify_point(object.tags)
    if kind == nil then
        return
    end

    local geom = object:as_point()
    if not is_usable(geom) then
        return
    end

    tables.points:insert({
        osm_id           = tostring(object.id),
        osm_feature_type = 'node',
        external_id      = 'osm:N:' .. object.id,
        transport_kind   = kind,
        mode             = mode,
        tags             = object.tags,
        geom             = geom,
    })
end

function osm2pgsql.process_way(object)
    -- Stage 2 reprocesses marked route-member ways; never emit a way twice.
    if emitted_way_ids[object.id] then
        return
    end

    -- Linear infrastructure first (rail lines, ferry ways).
    local lkind, lmode, ltype = classify_line(object.tags)
    if lkind ~= nil then
        local geom = object:as_linestring()
        if is_usable(geom) then
            emitted_way_ids[object.id] = true
            tables.lines:insert({
                osm_id           = tostring(object.id),
                osm_feature_type = 'way',
                external_id      = 'osm:W:' .. object.id,
                transport_kind   = lkind,
                mode             = lmode,
                line_type        = ltype,
                tags             = object.tags,
                geom             = geom,
            })
            return
        end
    end

    -- Otherwise, point-like features mapped as ways/areas (stations, bus_station,
    -- platforms, aerodromes, terminals) become a representative point.
    local pkind, pmode = classify_point(object.tags)
    if pkind ~= nil then
        local geom = way_representative_point(object)
        if is_usable(geom) then
            emitted_way_ids[object.id] = true
            tables.points:insert({
                osm_id           = tostring(object.id),
                osm_feature_type = 'way',
                external_id      = 'osm:W:' .. object.id,
                transport_kind   = pkind,
                mode             = pmode,
                tags             = object.tags,
                geom             = geom,
            })
            return
        end
    end

    -- Best-effort route-path support: keep the geometry of ways that are members
    -- of an accepted route relation (even plain highways), so PostGIS can merge
    -- them into a route path later. Skip ways already stored as lines/points above.
    if route_member_way_ids[object.id] then
        local geom = object:as_linestring()
        if is_usable(geom) then
            emitted_way_ids[object.id] = true
            tables.lines:insert({
                osm_id           = tostring(object.id),
                osm_feature_type = 'way',
                external_id      = 'osm:W:' .. object.id,
                transport_kind   = 'route_member_way',
                mode             = nil,
                line_type        = 'route_member',
                tags             = object.tags,
                geom             = geom,
            })
        end
    end
end

-- Pre-pass: mark the way members of accepted route relations so their geometry
-- is available to process_way. Requires osm2pgsql --slim. We also remember the
-- ids in a Lua set keyed by way id for the cheap membership test in process_way.
function osm2pgsql.select_relation_members(relation)
    if classify_relation(relation.tags) == nil then
        return nil
    end
    local ways = {}
    if relation.members ~= nil then
        for _, m in ipairs(relation.members) do
            if m.type == 'w' then
                ways[#ways + 1] = m.ref
                route_member_way_ids[m.ref] = true
            end
        end
    end
    if #ways > 0 then
        return { ways = ways }
    end
    return nil
end

-- Maps an osm2pgsql member type code to (word, external_id prefix).
local MEMBER_TYPE = {
    n = { 'node',     'osm:N:' },
    w = { 'way',      'osm:W:' },
    r = { 'relation', 'osm:R:' },
}

-- Route relations are extracted as metadata only (no geometry, no path/stop
-- ordering). We store the relation row plus its ordered member references.
function osm2pgsql.process_relation(object)
    local relation_type, mode, route_kind = classify_relation(object.tags)
    if relation_type == nil then
        return
    end

    local external_id = 'osm:R:' .. object.id
    local osm_id = tostring(object.id)

    tables.relations:insert({
        osm_id           = osm_id,
        osm_feature_type = 'relation',
        external_id      = external_id,
        relation_type    = relation_type,
        mode             = mode,
        route_kind       = route_kind,
        tags             = object.tags,
    })

    if object.members ~= nil then
        local seq = 0
        for _, m in ipairs(object.members) do
            seq = seq + 1
            local mapping = MEMBER_TYPE[m.type]
            local member_type, member_external_id
            if mapping ~= nil then
                member_type = mapping[1]
                member_external_id = mapping[2] .. m.ref
            else
                member_type = m.type
                member_external_id = nil
            end
            tables.relation_members:insert({
                relation_external_id = external_id,
                relation_osm_id      = osm_id,
                member_sequence      = seq,
                member_type          = member_type,
                member_ref           = tostring(m.ref),
                member_external_id   = member_external_id,
                member_role          = m.role,
            })
        end
    end
end
