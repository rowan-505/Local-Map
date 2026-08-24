local tables = {}

local SETTLEMENT_PLACE = {
    city = true,
    town = true,
    village = true,
    hamlet = true,
    suburb = true,
    quarter = true,
    neighbourhood = true,
    neighborhood = true,
    locality = true
}

tables.osm_points = osm2pgsql.define_table({
    name = 'osm_points',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'point', projection = 4326 }
    }
})

-- Defined so Stage 03/04 full-table expectations stay satisfied. Never inserted.
tables.osm_lines = osm2pgsql.define_table({
    name = 'osm_lines',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'multilinestring', projection = 4326 }
    }
})

tables.osm_polygons = osm2pgsql.define_table({
    name = 'osm_polygons',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'multipolygon', projection = 4326 }
    }
})

local function is_settlement(tags)
    if tags == nil or tags.place == nil or tags.place == '' then
        return false
    end
    return SETTLEMENT_PLACE[tags.place] == true
end

function osm2pgsql.process_node(object)
    if not is_settlement(object.tags) then
        return
    end

    tables.osm_points:insert({
        osm_id = tostring(object.id),
        osm_feature_type = 'node',
        tags = object.tags,
        geom = object:as_point()
    })
end

function osm2pgsql.process_way(object)
    if not is_settlement(object.tags) then
        return
    end

    if object.is_closed then
        tables.osm_polygons:insert({
            osm_id = tostring(object.id),
            osm_feature_type = 'way',
            tags = object.tags,
            geom = object:as_polygon()
        })
    end
end

function osm2pgsql.process_relation(object)
    if not is_settlement(object.tags) then
        return
    end

    if object.tags.type == 'multipolygon' or object.tags.type == 'boundary' then
        tables.osm_polygons:insert({
            osm_id = tostring(object.id),
            osm_feature_type = 'relation',
            tags = object.tags,
            geom = object:as_multipolygon()
        })
    end
end
