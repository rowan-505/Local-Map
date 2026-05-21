import type { ImportReviewGeoJson } from "@/src/lib/api";
import type { CoreReviewEntitySlug } from "@/src/lib/api";

export type { CoreReviewEntitySlug };

export type CoreReviewNameDto = {
    id: string;
    name: string;
    languageCode: string | null;
    scriptCode: string | null;
    nameType: string;
    isPrimary: boolean;
    searchWeight?: number;
};

export type CoreReviewBuildingRow = {
    id: string;
    publicId: string;
    externalId: string | null;
    name: string | null;
    nameMm: string | null;
    nameEn: string | null;
    buildingTypeId: string | null;
    buildingTypeCode: string | null;
    buildingTypeName: string | null;
    adminAreaId: string | null;
    adminAreaName: string | null;
    areaM2: number | null;
    levels: number | null;
    confidenceScore: number | null;
    isVerified: boolean;
    isActive: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    geometry: ImportReviewGeoJson | null;
};

export type CoreReviewPlaceRow = {
    id: string;
    publicId: string;
    displayName: string;
    primaryName: string;
    categoryId: string;
    categoryName: string | null;
    adminAreaId: string | null;
    adminAreaName: string | null;
    lat: number;
    lng: number;
    geometry: ImportReviewGeoJson | null;
    importanceScore: number | null;
    popularityScore: number | null;
    confidenceScore: number | null;
    isPublic: boolean;
    isVerified: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    names: CoreReviewNameDto[];
    myanmarName: string | null;
    englishName: string | null;
    plusCode?: string | null;
    deletedAt?: string | null;
};

export type CoreReviewStreetRow = {
    publicId: string;
    canonicalName: string;
    adminAreaId: string | null;
    adminAreaName: string | null;
    roadClassId: string | null;
    roadClass: string | null;
    roadClassName: string | null;
    surface: string | null;
    isOneway: boolean | null;
    bridge: boolean | null;
    tunnel: boolean | null;
    isActive: boolean;
    isVerified: boolean;
    deletedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    geometry: ImportReviewGeoJson | null;
    myanmarName: string | null;
    englishName: string | null;
};

export type CoreReviewBusStopRow = {
    id: string;
    publicId: string;
    name: string | null;
    nameLocal: string | null;
    stopCode: string | null;
    adminAreaId: string | null;
    adminAreaName: string | null;
    isActive: boolean;
    isVerified: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    geometry: ImportReviewGeoJson | null;
};

export type CoreReviewBusRouteRow = {
    id: string;
    routeCode: string | null;
    publicName: string | null;
    operatorName: string | null;
    routeType: string | null;
    directionality: string | null;
    variantCount?: number;
    isActive: boolean;
    isVerified: boolean;
    createdAt: string | null;
    updatedAt: string | null;
};

export type CoreReviewBusRouteVariantRow = {
    id: string;
    routeId: string;
    routePublicName: string | null;
    routeCode: string | null;
    variantCode: string | null;
    directionName: string | null;
    originName: string | null;
    destinationName: string | null;
    distanceM: number | null;
    isActive: boolean;
    isVerified: boolean;
    geometry: ImportReviewGeoJson | null;
};

export type CoreReviewLanduseRow = {
    id: string;
    externalId: string | null;
    name: string | null;
    classCode: string | null;
    isActive: boolean;
    isVerified: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    geometry: ImportReviewGeoJson | null;
};

export type CoreReviewWaterLineRow = CoreReviewLanduseRow;
export type CoreReviewWaterPolygonRow = CoreReviewLanduseRow;

export type CoreReviewAddressRow = {
    id: string;
    publicId: string;
    fullAddress: string | null;
    houseNumber: string | null;
    adminAreaId: string | null;
    adminAreaName: string | null;
    isPublic: boolean;
    isVerified: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    geometry: ImportReviewGeoJson | null;
    entranceGeometry?: ImportReviewGeoJson | null;
};

export type CoreReviewAdminAreaRow = {
    id: string;
    publicId: string;
    canonicalName: string;
    slug: string | null;
    parentId: string | null;
    adminLevelId: string | null;
    isActive: boolean;
    isVerified: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    geometry: ImportReviewGeoJson | null;
    centroid: ImportReviewGeoJson | null;
};

export type CoreReviewRowBySlug = {
    buildings: CoreReviewBuildingRow;
    places: CoreReviewPlaceRow;
    streets: CoreReviewStreetRow;
    "bus-stops": CoreReviewBusStopRow;
    "bus-routes": CoreReviewBusRouteRow;
    "bus-route-variants": CoreReviewBusRouteVariantRow;
    landuse: CoreReviewLanduseRow;
    "water-lines": CoreReviewWaterLineRow;
    "water-polygons": CoreReviewWaterPolygonRow;
    addresses: CoreReviewAddressRow;
    "admin-areas": CoreReviewAdminAreaRow;
};
