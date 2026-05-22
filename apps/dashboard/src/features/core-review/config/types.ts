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
    deletedAt?: string | null;
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
    deletedAt?: string | null;
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
    deletedAt?: string | null;
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
    deletedAt?: string | null;
    geometry: ImportReviewGeoJson | null;
};

export type CoreReviewMapFeatureRow = {
    id: string;
    externalId: string | null;
    name: string | null;
    classCode: string | null;
    isActive: boolean;
    isVerified: boolean;
    deletedAt?: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    geometry: ImportReviewGeoJson | null;
};

export type CoreReviewLanduseRow = {
    id: string;
    publicId: string;
    externalId: string | null;
    name: string | null;
    nameMm: string | null;
    nameEn: string | null;
    nameUnd: string | null;
    classCode: string | null;
    landuseClassId: string | null;
    landuseClassCode: string | null;
    landuseClassNameEn: string | null;
    landuseClassNameMm: string | null;
    adminAreaId: string | null;
    adminAreaName: string | null;
    detailLevel: string | null;
    cropCode: string | null;
    irrigated: boolean | null;
    seasonality: string | null;
    areaM2: number | null;
    confidenceScore: number | null;
    manualOverride: boolean;
    isActive: boolean;
    isVerified: boolean;
    deletedAt?: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    geometry: ImportReviewGeoJson | null;
    centroid?: ImportReviewGeoJson | null;
    sourceTags?: unknown;
    normalizedData?: unknown;
    sourceRefs?: unknown;
    sourceStagingId?: string | null;
};

export type CoreReviewWaterLineRow = CoreReviewMapFeatureRow;
export type CoreReviewWaterPolygonRow = CoreReviewMapFeatureRow;

export type CoreReviewAddressComponent = {
    id: string;
    componentTypeCode: string;
    componentValue: string;
    languageCode: string;
    sortOrder: number | null;
    confidenceScore: number | null;
    matchType: string | null;
    sourceAdminAreaId: string | null;
    boundaryStatus: string | null;
    addressUsage: string | null;
    sourceRefs?: unknown;
};

export type CoreReviewAddressRow = {
    id: string;
    publicId: string;
    cachedFullAddress?: string | null;
    fullAddress: string | null;
    generatedFullAddressEn: string | null;
    generatedFullAddressMy: string | null;
    displayFullAddress: string | null;
    myanmarName?: string | null;
    englishName?: string | null;
    houseNumber: string | null;
    unitNumber?: string | null;
    postalCode?: string | null;
    streetId?: string | null;
    streetPublicId?: string | null;
    streetNameEn?: string | null;
    streetNameMy?: string | null;
    adminAreaId: string | null;
    adminAreaName: string | null;
    adminAreaNameEn?: string | null;
    adminAreaNameMy?: string | null;
    isPublic: boolean;
    isVerified: boolean;
    confidenceScore?: number | null;
    deletedAt?: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    geometry: ImportReviewGeoJson | null;
    entranceGeometry?: ImportReviewGeoJson | null;
    compositionWarnings?: string[];
};

export type CoreReviewAddressDetail = CoreReviewAddressRow & {
    sourceTypeId?: string | null;
    sourceRefs?: unknown;
    normalizedData?: unknown;
    components?: CoreReviewAddressComponent[];
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
    boundaryStatus?: string | null;
    boundaryStatusLabelEn?: string | null;
    boundaryStatusLabelMm?: string | null;
    boundaryStatusHelperEn?: string | null;
    addressUsage?: string | null;
    addressUsageLabelEn?: string | null;
    addressUsageLabelMm?: string | null;
    addressUsageHelperEn?: string | null;
    isOfficialBoundary?: boolean | null;
    boundaryConfidenceScore?: number | null;
    boundaryNote?: string | null;
    deletedAt?: string | null;
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
