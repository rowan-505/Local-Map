local tables = {}

tables.osm_admin_polygons = osm2pgsql.define_table({
    name = 'osm_admin_polygons',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'multipolygon', projection = 4326 }
    }
})

local function is_admin_boundary(tags)
    if tags.boundary ~= 'administrative' then
        return false
    end
    local admin_level = tags.admin_level
    return admin_level ~= nil and admin_level ~= ''
end

function osm2pgsql.process_node(object)
    return
end

function osm2pgsql.process_way(object)
    if not is_admin_boundary(object.tags) then
        return
    end

    if not object.is_closed then
        return
    end

    tables.osm_admin_polygons:insert({
        osm_id = tostring(object.id),
        osm_feature_type = 'way',
        tags = object.tags,
        geom = object:as_polygon()
    })
end

function osm2pgsql.process_relation(object)
    if not is_admin_boundary(object.tags) then
        return
    end

    if object.tags.type == 'boundary'
        or object.tags.type == 'multipolygon'
        or object.tags.boundary == 'administrative' then
        tables.osm_admin_polygons:insert({
            osm_id = tostring(object.id),
            osm_feature_type = 'relation',
            tags = object.tags,
            geom = object:as_multipolygon()
        })
    end
end
