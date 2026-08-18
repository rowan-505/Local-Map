import type { CoreEntityConfig } from "./types";
import { BUILDINGS_ENTITY_CONFIG } from "./buildings";
import { LAND_AREAS_ENTITY_CONFIG } from "./land-areas";
import { PLACES_ENTITY_CONFIG } from "./places";
import { STREETS_ENTITY_CONFIG } from "./streets";
import {
    ADMIN_AREAS_ENTITY_CONFIG,
    ADDRESSES_ENTITY_CONFIG,
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
export { LAND_AREAS_ENTITY_CONFIG } from "./land-areas";
export { PLACES_ENTITY_CONFIG } from "./places";
export { STREETS_ENTITY_CONFIG } from "./streets";
export {
    ADMIN_AREAS_ENTITY_CONFIG,
    ADDRESSES_ENTITY_CONFIG,
    WATER_LINES_ENTITY_CONFIG,
    WATER_POLYGONS_ENTITY_CONFIG,
} from "./extendedEntities";

export const CORE_ENTITY_CONFIGS = {
    buildings: BUILDINGS_ENTITY_CONFIG,
    places: PLACES_ENTITY_CONFIG,
    streets: STREETS_ENTITY_CONFIG,
    "land-areas": LAND_AREAS_ENTITY_CONFIG,
    "water-lines": WATER_LINES_ENTITY_CONFIG,
    "water-polygons": WATER_POLYGONS_ENTITY_CONFIG,
    addresses: ADDRESSES_ENTITY_CONFIG,
    "admin-areas": ADMIN_AREAS_ENTITY_CONFIG,
} as const;

export function getCoreEntityConfig(entityKey: keyof typeof CORE_ENTITY_CONFIGS): CoreEntityConfig<unknown> {
    return CORE_ENTITY_CONFIGS[entityKey] as CoreEntityConfig<unknown>;
}
