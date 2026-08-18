-- Flex config for turn-restriction dry-run only.
-- Loads ALL nodes (via nodes are often untagged), member ways as lines,
-- and type=restriction relations with members JSON.

local tables = {}

tables.osm_points = osm2pgsql.define_table({
    name = 'osm_points',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'point', projection = 4326 }
    }
})

tables.osm_lines = osm2pgsql.define_table({
    name = 'osm_lines',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'multilinestring', projection = 4326 }
    }
})

-- Keep table present so Stage 03 full-mode checks stay happy.
tables.osm_polygons = osm2pgsql.define_table({
    name = 'osm_polygons',
    schema = 'tmp_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'multipolygon', projection = 4326 }
    }
})

tables.osm_restrictions = osm2pgsql.define_table({
    name = 'osm_restrictions',
    schema = 'tmp_import',
    ids = { type = 'relation', id_column = 'osm_id' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'members', type = 'jsonb' }
    }
})

local function is_restriction_relation(tags)
    if not tags then
        return false
    end
    local t = tags.type
    if t and string.sub(t, 1, 11) == 'restriction' then
        return true
    end
    if tags.restriction then
        return true
    end
    for k, _ in pairs(tags) do
        if string.sub(k, 1, 12) == 'restriction:' then
            return true
        end
    end
    return false
end

local function members_json(object)
    local out = {}
    for _, member in ipairs(object.members) do
        table.insert(out, {
            type = member.type,
            ref = member.ref,
            role = member.role
        })
    end
    return out
end

-- Via nodes are often untagged. osm2pgsql only calls process_node for tagged
-- nodes, so also define process_untagged_node (same insert).
local function insert_node(object)
    tables.osm_points:insert({
        osm_id = tostring(object.id),
        osm_feature_type = 'node',
        tags = object.tags or {},
        geom = object:as_point()
    })
end

osm2pgsql.process_node = insert_node
osm2pgsql.process_untagged_node = insert_node

function osm2pgsql.process_way(object)
    local ok, geom = pcall(function()
        return object:as_linestring()
    end)
    if not ok or geom == nil then
        return
    end
    tables.osm_lines:insert({
        osm_id = tostring(object.id),
        osm_feature_type = 'way',
        tags = object.tags or {},
        geom = geom
    })
end

function osm2pgsql.process_relation(object)
    if not is_restriction_relation(object.tags) then
        return
    end
    tables.osm_restrictions:insert({
        tags = object.tags or {},
        members = members_json(object)
    })
end
