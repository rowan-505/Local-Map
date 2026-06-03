-- osm2pgsql flex: OSM administrative boundaries only -> tmp_admin_import.osm_admin_polygons
--
-- Includes: boundary=administrative, admin_level in {2,4,5,6,7,8,9,10}.
-- Ways: closed polygons only. Relations: type boundary or multipolygon.
-- tags jsonb: whitelisted keys only (name, name:my, name:en, official_name, alt_name,
-- short_name, boundary, admin_level, place, population, wikidata, wikipedia, source).
-- Nodes and all non-admin features are ignored.

local tables = {}

tables.osm_admin_polygons = osm2pgsql.define_table({
    name = 'osm_admin_polygons',
    schema = 'tmp_admin_import',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_feature_type' },
    columns = {
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'multipolygon', projection = 4326 }
    }
})

local ALLOWED_ADMIN_LEVELS = {
    ['2'] = true,
    ['4'] = true,
    ['5'] = true,
    ['6'] = true,
    ['7'] = true,
    ['8'] = true,
    ['9'] = true,
    ['10'] = true
}

local TAG_KEYS = {
    'name',
    'name:my',
    'name:en',
    'official_name',
    'alt_name',
    'short_name',
    'boundary',
    'admin_level',
    'place',
    'population',
    'wikidata',
    'wikipedia',
    'source'
}

local function trim(value)
    return (value:gsub('^%s+', ''):gsub('%s+$', ''))
end

local function filter_tags(tags)
    local filtered = {}
    for _, key in ipairs(TAG_KEYS) do
        local value = tags[key]
        if value ~= nil and value ~= '' then
            filtered[key] = value
        end
    end
    return filtered
end

local function admin_level_allowed(tags)
    local level = tags.admin_level
    if level == nil or level == '' then
        return false
    end

    if ALLOWED_ADMIN_LEVELS[level] then
        return true
    end

    for part in string.gmatch(level, '[^;]+') do
        if ALLOWED_ADMIN_LEVELS[trim(part)] then
            return true
        end
    end

    return false
end

local function is_admin_boundary(tags)
    return tags.boundary == 'administrative' and admin_level_allowed(tags)
end

-- osm2pgsql flex returns a null-geometry object (not Lua nil) when assembly fails.
local function geom_is_usable(geom)
    if geom == nil then
        return false
    end
    return not geom:is_null()
end

local function insert_admin_polygon(object, feature_type, geom)
    if not geom_is_usable(geom) then
        return
    end

    tables.osm_admin_polygons:insert({
        osm_id = tostring(object.id),
        osm_feature_type = feature_type,
        tags = filter_tags(object.tags),
        geom = geom
    })
end

function osm2pgsql.process_node(object)
end

function osm2pgsql.process_way(object)
    if not is_admin_boundary(object.tags) then
        return
    end

    if not object.is_closed then
        return
    end

    insert_admin_polygon(object, 'way', object:as_polygon())
end

function osm2pgsql.process_relation(object)
    if not is_admin_boundary(object.tags) then
        return
    end

    local relation_type = object.tags.type
    if relation_type ~= 'boundary' and relation_type ~= 'multipolygon' then
        return
    end

    insert_admin_polygon(object, 'relation', object:as_multipolygon())
end
