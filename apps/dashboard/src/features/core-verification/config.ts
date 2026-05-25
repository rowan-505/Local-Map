export const CORE_VERIFICATION_FAMILIES = [
    { family: "buildings", path: "buildings", label: "Buildings" },
    { family: "places", path: "places", label: "Places" },
    { family: "roads", path: "roads", label: "Roads" },
    { family: "landuse", path: "landuse", label: "Landuse" },
    { family: "water_lines", path: "water-lines", label: "Water lines" },
    { family: "water_polygons", path: "water-polygons", label: "Water polygons" },
    { family: "bus_stops", path: "bus-stops", label: "Bus stops" },
    { family: "admin_areas", path: "admin-areas", label: "Admin areas" },
    { family: "routing_barriers", path: "routing-barriers", label: "Routing barriers" },
    { family: "bus_routes", path: "bus-routes", label: "Bus routes" },
    { family: "bus_route_variants", path: "bus-route-variants", label: "Bus route variants" },
    { family: "bus_route_stops", path: "bus-route-stops", label: "Bus route stops" },
] as const;

export type CoreVerificationPath = (typeof CORE_VERIFICATION_FAMILIES)[number]["path"];

export function familyFromCoreVerificationPath(path: string): string | null {
    return CORE_VERIFICATION_FAMILIES.find((item) => item.path === path)?.family ?? null;
}

export function coreVerificationLabel(family: string): string {
    return CORE_VERIFICATION_FAMILIES.find((item) => item.family === family)?.label ?? family;
}
