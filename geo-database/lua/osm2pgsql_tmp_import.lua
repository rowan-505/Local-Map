local tables = {}

-- =========================
-- POINTS
-- =========================
tables.osm_points = osm2pgsql.define_table({
    name = 'osm_points',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'point', projection = 4326 }
    }
})

-- =========================
-- LINES
-- =========================
tables.osm_lines = osm2pgsql.define_table({
    name = 'osm_lines',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'multilinestring', projection = 4326 }
    }
})

-- =========================
-- POLYGONS
-- =========================
tables.osm_polygons = osm2pgsql.define_table({
    name = 'osm_polygons',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'multipolygon', projection = 4326 }
    }
})

-- =========================
-- HELPERS
-- =========================

local function has_tags(tags)
    return next(tags) ~= nil
end

local polygon_keys = {
    building = true,
    landuse = true,
    natural = true,
    amenity = true,
    leisure = true,
    boundary = true,
    place = true,
    shop = true,
    tourism = true
}

-- =========================
-- NODE → POINT
-- =========================
function osm2pgsql.process_node(object)
    if not has_tags(object.tags) then
        return
    end

    tables.osm_points:insert({
        osm_id = tostring(object.id),
        osm_feature_type = 'node',
        tags = object.tags,
        geom = object:as_point()
    })
end

-- =========================
-- WAY → LINE or POLYGON
-- =========================
function osm2pgsql.process_way(object)
    if not has_tags(object.tags) then
        return
    end

    local is_polygon = false
    for key, _ in pairs(polygon_keys) do
        if object.tags[key] then
            is_polygon = true
            break
        end
    end

    if is_polygon and object.is_closed then
        tables.osm_polygons:insert({
            osm_id = tostring(object.id),
            osm_feature_type = 'way',
            tags = object.tags,
            geom = object:as_polygon()
        })
    else
        tables.osm_lines:insert({
            osm_id = tostring(object.id),
            osm_feature_type = 'way',
            tags = object.tags,
            geom = object:as_linestring()
        })
    end
end

-- =========================
-- RELATION → POLYGON / LINE
-- =========================
function osm2pgsql.process_relation(object)
    if not has_tags(object.tags) then
        return
    end

    if object.tags.type == 'multipolygon' or object.tags.boundary then
        tables.osm_polygons:insert({
            osm_id = tostring(object.id),
            osm_feature_type = 'relation',
            tags = object.tags,
            geom = object:as_multipolygon()
        })
    elseif object.tags.type == 'route' then
        tables.osm_lines:insert({
            osm_id = tostring(object.id),
            osm_feature_type = 'relation',
            tags = object.tags,
            geom = object:as_multilinestring()
        })
    end
end