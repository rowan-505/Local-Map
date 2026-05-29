import {
    routeStopsImportTransportEntityConfig,
    routesImportTransportEntityConfig,
    stopsImportTransportEntityConfig,
    variantsImportTransportEntityConfig,
} from "./entities";
import type { ImportTransportEntityConfig, ImportTransportEntitySlug } from "./types";

const IMPORT_TRANSPORT_ENTITY_CONFIG_LIST: readonly ImportTransportEntityConfig[] = [
    routesImportTransportEntityConfig,
    stopsImportTransportEntityConfig,
    variantsImportTransportEntityConfig,
    routeStopsImportTransportEntityConfig,
];

const CONFIG_BY_SLUG = new Map<string, ImportTransportEntityConfig>(
    IMPORT_TRANSPORT_ENTITY_CONFIG_LIST.map((c) => [c.slug, c])
);

const CONFIG_BY_API_FAMILY = new Map<string, ImportTransportEntityConfig>(
    IMPORT_TRANSPORT_ENTITY_CONFIG_LIST.map((c) => [c.apiFamily, c])
);

function normalizeSlug(slug: string): string {
    return slug.trim().toLowerCase();
}

function normalizeApiFamily(apiFamily: string): string {
    return apiFamily.trim().toLowerCase().replace(/-/g, "_");
}

export function listImportTransportEntityConfigs(): readonly ImportTransportEntityConfig[] {
    return IMPORT_TRANSPORT_ENTITY_CONFIG_LIST;
}

export function isKnownImportTransportEntitySlug(slug: string): boolean {
    return CONFIG_BY_SLUG.has(normalizeSlug(slug));
}

export function getImportTransportEntityConfigBySlug(
    slug: string
): ImportTransportEntityConfig | null {
    return CONFIG_BY_SLUG.get(normalizeSlug(slug)) ?? null;
}

export function getImportTransportEntityConfigByApiFamily(
    apiFamily: string
): ImportTransportEntityConfig | null {
    return CONFIG_BY_API_FAMILY.get(normalizeApiFamily(apiFamily)) ?? null;
}

export function getImportTransportEntitySlugByApiFamily(
    apiFamily: string
): ImportTransportEntitySlug | null {
    const config = getImportTransportEntityConfigByApiFamily(apiFamily);
    return config?.slug ?? null;
}
