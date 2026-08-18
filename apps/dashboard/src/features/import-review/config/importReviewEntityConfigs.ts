import {
    addressesImportReviewEntityConfig,
    adminAreasImportReviewEntityConfig,
    buildingsImportReviewEntityConfig,
    landAreasImportReviewEntityConfig,
    placesImportReviewEntityConfig,
    roadsImportReviewEntityConfig,
    routingBarriersImportReviewEntityConfig,
    waterLinesImportReviewEntityConfig,
    waterPolygonsImportReviewEntityConfig,
} from "./entities";
import type { ImportReviewEntityConfig, ImportReviewEntitySlug } from "./types";
import { isDeprecatedImportReviewBusSlug } from "../utils/deprecatedCoreBusPromotion";

const IMPORT_REVIEW_ENTITY_CONFIG_LIST: readonly ImportReviewEntityConfig[] = [
    buildingsImportReviewEntityConfig,
    placesImportReviewEntityConfig,
    roadsImportReviewEntityConfig,
    landAreasImportReviewEntityConfig,
    waterLinesImportReviewEntityConfig,
    waterPolygonsImportReviewEntityConfig,
    addressesImportReviewEntityConfig,
    adminAreasImportReviewEntityConfig,
    routingBarriersImportReviewEntityConfig,
];

const CONFIG_BY_SLUG = new Map<string, ImportReviewEntityConfig>(
    IMPORT_REVIEW_ENTITY_CONFIG_LIST.map((c) => [c.slug, c])
);

const CONFIG_BY_API_FAMILY = new Map<string, ImportReviewEntityConfig>(
    IMPORT_REVIEW_ENTITY_CONFIG_LIST.map((c) => [c.apiFamily, c])
);

function normalizeSlug(slug: string): string {
    return slug.trim().toLowerCase();
}

function normalizeApiFamily(apiFamily: string): string {
    return apiFamily.trim().toLowerCase().replace(/-/g, "_");
}

export function listImportReviewEntityConfigs(): readonly ImportReviewEntityConfig[] {
    return IMPORT_REVIEW_ENTITY_CONFIG_LIST;
}

/** Active import-review nav/overview entities (excludes deprecated bus/transport slugs). */
export function listImportReviewNavEntityConfigs(): readonly ImportReviewEntityConfig[] {
    return IMPORT_REVIEW_ENTITY_CONFIG_LIST.filter((config) => !isDeprecatedImportReviewBusSlug(config.slug));
}

export function isKnownImportReviewEntitySlug(slug: string): boolean {
    return CONFIG_BY_SLUG.has(normalizeSlug(slug));
}

export function getImportReviewEntityConfigBySlug(slug: string): ImportReviewEntityConfig | null {
    return CONFIG_BY_SLUG.get(normalizeSlug(slug)) ?? null;
}

export function getImportReviewEntityConfigByApiFamily(apiFamily: string): ImportReviewEntityConfig | null {
    const key = normalizeApiFamily(apiFamily);
    return CONFIG_BY_API_FAMILY.get(key) ?? null;
}

export function getImportReviewEntitySlugByApiFamily(apiFamily: string): ImportReviewEntitySlug | null {
    const config = getImportReviewEntityConfigByApiFamily(apiFamily);
    return config?.slug ?? null;
}
