export const CORE_VERIFICATION_STATUSES = [
    "unverified",
    "verified",
    "needs_fix",
    "questionable",
    "rejected_after_core_review",
] as const;

export type CoreVerificationStatus = (typeof CORE_VERIFICATION_STATUSES)[number];

export const CORE_VERIFICATION_FAMILIES = [
    "buildings",
    "places",
    "roads",
    "landuse",
    "water_lines",
    "water_polygons",
    "bus_stops",
    "admin_areas",
    "routing_barriers",
    "bus_routes",
    "bus_route_variants",
    "bus_route_stops",
] as const;

export type CoreVerificationFamily = (typeof CORE_VERIFICATION_FAMILIES)[number];

export type CoreVerificationEntityConfig = {
    family: CoreVerificationFamily;
    label: string;
    table: string;
    path: string;
    idColumns: readonly string[];
    geometryColumn?: string;
    displayColumns: readonly string[];
    searchColumns: readonly string[];
    safeEditableFields: readonly string[];
    nameTable?: {
        table: string;
        ownerColumn: string;
        targetColumn: string;
    };
};

const CONFIGS: Record<CoreVerificationFamily, CoreVerificationEntityConfig> = {
    buildings: {
        family: "buildings",
        label: "Buildings",
        table: "core.core_map_buildings",
        path: "buildings",
        idColumns: ["id"],
        geometryColumn: "geom",
        displayColumns: ["name", "external_id"],
        searchColumns: ["name", "external_id"],
        safeEditableFields: ["name", "admin_area_id", "building_type_id", "levels", "height_m", "confidence_score"],
    },
    places: {
        family: "places",
        label: "Places",
        table: "core.core_places",
        path: "places",
        idColumns: ["id"],
        geometryColumn: "point_geom",
        displayColumns: ["primary_name", "display_name", "external_id"],
        searchColumns: ["primary_name", "display_name", "external_id"],
        safeEditableFields: ["primary_name", "display_name", "admin_area_id", "importance_score", "popularity_score", "confidence_score"],
    },
    roads: {
        family: "roads",
        label: "Roads",
        table: "core.core_streets",
        path: "roads",
        idColumns: ["id"],
        geometryColumn: "geom",
        displayColumns: ["canonical_name", "external_id"],
        searchColumns: ["canonical_name", "external_id", "road_class", "surface"],
        safeEditableFields: ["canonical_name", "admin_area_id", "road_class_id", "road_class", "surface", "is_oneway"],
    },
    landuse: {
        family: "landuse",
        label: "Landuse",
        table: "core.core_map_landuse",
        path: "landuse",
        idColumns: ["id"],
        geometryColumn: "geom",
        displayColumns: ["name", "class_code", "external_id"],
        searchColumns: ["name", "class_code", "external_id"],
        safeEditableFields: ["name", "landuse_class_id", "admin_area_id", "class_code", "confidence_score", "detail_level"],
    },
    water_lines: {
        family: "water_lines",
        label: "Water lines",
        table: "core.core_map_water_lines",
        path: "water-lines",
        idColumns: ["id"],
        geometryColumn: "geom",
        displayColumns: ["name", "class_code", "external_id"],
        searchColumns: ["name", "class_code", "external_id"],
        safeEditableFields: ["name", "class_code"],
    },
    water_polygons: {
        family: "water_polygons",
        label: "Water polygons",
        table: "core.core_map_water_polygons",
        path: "water-polygons",
        idColumns: ["id"],
        geometryColumn: "geom",
        displayColumns: ["name", "class_code", "external_id"],
        searchColumns: ["name", "class_code", "external_id"],
        safeEditableFields: ["name", "class_code"],
    },
    bus_stops: {
        family: "bus_stops",
        label: "Bus stops",
        table: "core.core_bus_stops",
        path: "bus-stops",
        idColumns: ["id"],
        geometryColumn: "geom",
        displayColumns: ["name", "name_local", "stop_code", "external_id"],
        searchColumns: ["name", "name_local", "stop_code", "external_id"],
        safeEditableFields: ["name", "name_local", "stop_code", "admin_area_id"],
        nameTable: { table: "core.core_bus_stop_names", ownerColumn: "stop_id", targetColumn: "id" },
    },
    admin_areas: {
        family: "admin_areas",
        label: "Admin areas",
        table: "core.core_admin_areas",
        path: "admin-areas",
        idColumns: ["id"],
        geometryColumn: "geom",
        displayColumns: ["canonical_name", "slug", "external_id"],
        searchColumns: ["canonical_name", "slug", "external_id"],
        safeEditableFields: ["canonical_name", "slug", "parent_id", "boundary_status", "boundary_note"],
        nameTable: { table: "core.core_admin_area_names", ownerColumn: "admin_area_id", targetColumn: "id" },
    },
    routing_barriers: {
        family: "routing_barriers",
        label: "Routing barriers",
        table: "routing.routing_barriers",
        path: "routing-barriers",
        idColumns: ["id"],
        geometryColumn: "geom",
        displayColumns: ["barrier_type", "core_street_id"],
        searchColumns: ["barrier_type"],
        safeEditableFields: ["barrier_type", "core_street_id"],
    },
    bus_routes: {
        family: "bus_routes",
        label: "Bus routes",
        table: "core.core_bus_routes",
        path: "bus-routes",
        idColumns: ["id"],
        displayColumns: ["public_name", "route_code", "external_id"],
        searchColumns: ["public_name", "route_code", "external_id", "operator_name"],
        safeEditableFields: ["route_code", "public_name", "operator_name", "route_type", "directionality"],
        nameTable: { table: "core.core_bus_route_names", ownerColumn: "route_id", targetColumn: "id" },
    },
    bus_route_variants: {
        family: "bus_route_variants",
        label: "Bus route variants",
        table: "core.core_bus_route_variants",
        path: "bus-route-variants",
        idColumns: ["id"],
        geometryColumn: "geom",
        displayColumns: ["variant_code", "direction_name", "origin_name", "destination_name"],
        searchColumns: ["variant_code", "direction_name", "origin_name", "destination_name"],
        safeEditableFields: ["variant_code", "direction_name", "origin_name", "destination_name", "distance_m"],
    },
    bus_route_stops: {
        family: "bus_route_stops",
        label: "Bus route stops",
        table: "core.core_bus_route_stops",
        path: "bus-route-stops",
        idColumns: ["route_variant_id", "stop_id", "stop_sequence"],
        displayColumns: ["route_variant_id", "stop_id", "stop_sequence"],
        searchColumns: [],
        safeEditableFields: ["distance_from_start_m", "is_timing_point"],
    },
};

export function getCoreVerificationEntityConfig(
    family: string
): CoreVerificationEntityConfig | null {
    return (CONFIGS as Record<string, CoreVerificationEntityConfig>)[family] ?? null;
}

export function listCoreVerificationEntityConfigs(): readonly CoreVerificationEntityConfig[] {
    return CORE_VERIFICATION_FAMILIES.map((family) => CONFIGS[family]);
}

export function isCoreVerificationStatus(status: string): status is CoreVerificationStatus {
    return (CORE_VERIFICATION_STATUSES as readonly string[]).includes(status);
}
