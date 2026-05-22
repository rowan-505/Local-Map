import type { CoreEntityConfig } from "./types";
import { BUILDINGS_ENTITY_CONFIG } from "./buildings";
import { LANDUSE_ENTITY_CONFIG } from "./landuse";
import { PLACES_ENTITY_CONFIG } from "./places";
import { STREETS_ENTITY_CONFIG } from "./streets";
import {
    ADMIN_AREAS_ENTITY_CONFIG,
    ADDRESSES_ENTITY_CONFIG,
    BUS_ROUTES_ENTITY_CONFIG,
    BUS_ROUTE_VARIANTS_ENTITY_CONFIG,
    BUS_STOPS_ENTITY_CONFIG,
    WATER_LINES_ENTITY_CONFIG,
    WATER_POLYGONS_ENTITY_CONFIG,
} from "./extendedEntities";

export type {
    CoreEntityConfig,
    CoreEntityFieldDef,
    CoreEntityFormMode,
    CoreEntityFormValues,
    CoreEntityKey,
} from "./types";
export { BUILDINGS_ENTITY_CONFIG } from "./buildings";
export { LANDUSE_ENTITY_CONFIG } from "./landuse";
export { PLACES_ENTITY_CONFIG } from "./places";
export { STREETS_ENTITY_CONFIG } from "./streets";
export {
    ADMIN_AREAS_ENTITY_CONFIG,
    ADDRESSES_ENTITY_CONFIG,
    BUS_ROUTES_ENTITY_CONFIG,
    BUS_ROUTE_VARIANTS_ENTITY_CONFIG,
    BUS_STOPS_ENTITY_CONFIG,
    WATER_LINES_ENTITY_CONFIG,
    WATER_POLYGONS_ENTITY_CONFIG,
} from "./extendedEntities";

export const CORE_ENTITY_CONFIGS = {
    buildings: BUILDINGS_ENTITY_CONFIG,
    places: PLACES_ENTITY_CONFIG,
    streets: STREETS_ENTITY_CONFIG,
    "bus-stops": BUS_STOPS_ENTITY_CONFIG,
    "bus-routes": BUS_ROUTES_ENTITY_CONFIG,
    "bus-route-variants": BUS_ROUTE_VARIANTS_ENTITY_CONFIG,
    landuse: LANDUSE_ENTITY_CONFIG,
    "water-lines": WATER_LINES_ENTITY_CONFIG,
    "water-polygons": WATER_POLYGONS_ENTITY_CONFIG,
    addresses: ADDRESSES_ENTITY_CONFIG,
    "admin-areas": ADMIN_AREAS_ENTITY_CONFIG,
} as const;

export function getCoreEntityConfig(entityKey: keyof typeof CORE_ENTITY_CONFIGS): CoreEntityConfig<unknown> {
    return CORE_ENTITY_CONFIGS[entityKey] as CoreEntityConfig<unknown>;
}
