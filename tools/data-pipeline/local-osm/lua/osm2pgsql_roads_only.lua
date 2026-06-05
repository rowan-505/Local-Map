local tables = {}

tables.osm_road_lines = osm2pgsql.define_table({
    name = 'osm_road_lines',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'multilinestring', projection = 4326 }
    }
})

local function has_highway(tags)
    return tags.highway ~= nil and tags.highway ~= ''
end

function osm2pgsql.process_node(object)
    return
end

function osm2pgsql.process_way(object)
    if not has_highway(object.tags) then
        return
    end

    tables.osm_road_lines:insert({
        osm_id = tostring(object.id),
        osm_feature_type = 'way',
        tags = object.tags,
        geom = object:as_linestring()
    })
end

function osm2pgsql.process_relation(object)
    if not has_highway(object.tags) then
        return
    end

    tables.osm_road_lines:insert({
        osm_id = tostring(object.id),
        osm_feature_type = 'relation',
        tags = object.tags,
        geom = object:as_multilinestring()
    })
end
