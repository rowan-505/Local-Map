-- osm2pgsql flex: OSM highway ways only -> tmp_road_import.osm_road_lines
--
-- Ways: any tag highway=* (motorway … busway, path, construction, proposed, etc.).
-- Nodes, polygons, relations: ignored.
-- tags jsonb: full OSM tag set (name, name:my, name:en, highway, surface, maxspeed,
-- oneway, bridge, tunnel, layer, access, motor_vehicle, motorcycle, foot, bicycle,
-- service, tracktype, smoothness, width, lanes, …).

local tables = {}

tables.osm_road_lines = osm2pgsql.define_table({
    name = 'osm_road_lines',
    schema = 'tmp_road_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'linestring', projection = 4326 }
    }
})

local function is_road_way(tags)
    return tags.highway ~= nil
end

function osm2pgsql.process_node(object)
end

function osm2pgsql.process_way(object)
    if not is_road_way(object.tags) then
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
end
