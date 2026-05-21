import type { CoreReviewEntitySlug } from "./core-review.types.js";

export type CoreReviewIdKind = "public_id" | "numeric_id";

export type CoreReviewEntityDefinition = {
    slug: CoreReviewEntitySlug;
    /** Route segment (kebab-case). */
    path: string;
    idKind: CoreReviewIdKind;
    supportsIsVerified: boolean;
    supportsAdminAreaId: boolean;
    supportsCategoryId: boolean;
    supportsBuildingTypeId: boolean;
    supportsRoadClassId: boolean;
    supportsIsPublic: boolean;
    supportsIncludeDeleted: boolean;
    supportsRouteId: boolean;
    defaultSortBy: string;
    allowedSortBy: readonly string[];
};

const ENTITY_DEFINITIONS: readonly CoreReviewEntityDefinition[] = [
    {
        slug: "buildings",
        path: "buildings",
        idKind: "public_id",
        supportsIsVerified: true,
        supportsAdminAreaId: true,
        supportsCategoryId: false,
        supportsBuildingTypeId: true,
        supportsRoadClassId: false,
        supportsIsPublic: false,
        supportsIncludeDeleted: false,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "building_type", "admin_area", "created", "updated", "updated_at"],
    },
    {
        slug: "places",
        path: "places",
        idKind: "public_id",
        supportsIsVerified: true,
        supportsAdminAreaId: true,
        supportsCategoryId: true,
        supportsBuildingTypeId: false,
        supportsRoadClassId: false,
        supportsIsPublic: true,
        supportsIncludeDeleted: false,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "category", "admin_area", "created", "updated", "updated_at"],
    },
    {
        slug: "streets",
        path: "streets",
        idKind: "public_id",
        supportsIsVerified: true,
        supportsAdminAreaId: true,
        supportsCategoryId: false,
        supportsBuildingTypeId: false,
        supportsRoadClassId: true,
        supportsIsPublic: false,
        supportsIncludeDeleted: true,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "admin_area", "created", "updated", "updated_at"],
    },
    {
        slug: "bus-stops",
        path: "bus-stops",
        idKind: "public_id",
        supportsIsVerified: true,
        supportsAdminAreaId: true,
        supportsCategoryId: false,
        supportsBuildingTypeId: false,
        supportsRoadClassId: false,
        supportsIsPublic: false,
        supportsIncludeDeleted: false,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "admin_area", "created", "updated", "updated_at"],
    },
    {
        slug: "bus-routes",
        path: "bus-routes",
        idKind: "numeric_id",
        supportsIsVerified: true,
        supportsAdminAreaId: false,
        supportsCategoryId: false,
        supportsBuildingTypeId: false,
        supportsRoadClassId: false,
        supportsIsPublic: false,
        supportsIncludeDeleted: false,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "created", "updated", "updated_at"],
    },
    {
        slug: "bus-route-variants",
        path: "bus-route-variants",
        idKind: "numeric_id",
        supportsIsVerified: true,
        supportsAdminAreaId: false,
        supportsCategoryId: false,
        supportsBuildingTypeId: false,
        supportsRoadClassId: false,
        supportsIsPublic: false,
        supportsIncludeDeleted: false,
        supportsRouteId: true,
        defaultSortBy: "id",
        allowedSortBy: ["name", "id", "route_id"],
    },
    {
        slug: "landuse",
        path: "landuse",
        idKind: "numeric_id",
        supportsIsVerified: true,
        supportsAdminAreaId: false,
        supportsCategoryId: false,
        supportsBuildingTypeId: false,
        supportsRoadClassId: false,
        supportsIsPublic: false,
        supportsIncludeDeleted: false,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "class_code", "created", "updated", "updated_at"],
    },
    {
        slug: "water-lines",
        path: "water-lines",
        idKind: "numeric_id",
        supportsIsVerified: true,
        supportsAdminAreaId: false,
        supportsCategoryId: false,
        supportsBuildingTypeId: false,
        supportsRoadClassId: false,
        supportsIsPublic: false,
        supportsIncludeDeleted: false,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "class_code", "created", "updated", "updated_at"],
    },
    {
        slug: "water-polygons",
        path: "water-polygons",
        idKind: "numeric_id",
        supportsIsVerified: true,
        supportsAdminAreaId: false,
        supportsCategoryId: false,
        supportsBuildingTypeId: false,
        supportsRoadClassId: false,
        supportsIsPublic: false,
        supportsIncludeDeleted: false,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "class_code", "created", "updated", "updated_at"],
    },
    {
        slug: "addresses",
        path: "addresses",
        idKind: "public_id",
        supportsIsVerified: true,
        supportsAdminAreaId: true,
        supportsCategoryId: false,
        supportsBuildingTypeId: false,
        supportsRoadClassId: false,
        supportsIsPublic: true,
        supportsIncludeDeleted: false,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "admin_area", "created", "updated", "updated_at"],
    },
    {
        slug: "admin-areas",
        path: "admin-areas",
        idKind: "public_id",
        supportsIsVerified: true,
        supportsAdminAreaId: true,
        supportsCategoryId: false,
        supportsBuildingTypeId: false,
        supportsRoadClassId: false,
        supportsIsPublic: false,
        supportsIncludeDeleted: false,
        supportsRouteId: false,
        defaultSortBy: "updated_at",
        allowedSortBy: ["name", "created", "updated", "updated_at"],
    },
];

const BY_PATH = new Map(ENTITY_DEFINITIONS.map((d) => [d.path, d]));

export function getCoreReviewEntityByPath(path: string): CoreReviewEntityDefinition | null {
    return BY_PATH.get(path.trim().toLowerCase()) ?? null;
}

export function listCoreReviewEntityPaths(): string[] {
    return ENTITY_DEFINITIONS.map((d) => d.path);
}

export function resolveCoreReviewSortBy(
    def: CoreReviewEntityDefinition,
    sortBy: string | undefined
): string {
    const raw = sortBy?.trim() || def.defaultSortBy;
    return def.allowedSortBy.includes(raw) ? raw : def.defaultSortBy;
}
