import type { Building, ImportReviewGeoJson, PlaceDetail } from "@/src/lib/api";

import type {
    CoreReviewAddressRow,
    CoreReviewAdminAreaRow,
    CoreReviewBuildingRow,
    CoreReviewBusRouteVariantRow,
    CoreReviewLanduseRow,
    CoreReviewMapFeatureRow,
    CoreReviewPlaceRow,
} from "./types";
import { boolOrNull, geometryOrNull, numOrNull, strOrNull } from "./detailListRowUtils";

function pointGeometryFromLatLng(
    lat: number | null | undefined,
    lng: number | null | undefined,
    fallback: ImportReviewGeoJson | null,
): ImportReviewGeoJson | null {
    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        return { type: "Point", coordinates: [lng, lat] };
    }
    return fallback;
}

/** Maps building edit detail onto a core-review list row. */
export function applyBuildingDetailToListRow(
    row: CoreReviewBuildingRow,
    detail: unknown,
): CoreReviewBuildingRow {
    const d = detail as Building &
        Partial<CoreReviewBuildingRow> & {
            building_type?: { id?: string; code?: string; name_en?: string | null } | null;
            admin_area?: { id?: string; canonical_name?: string | null } | null;
        };

    return {
        ...row,
        id: strOrNull(d.id) ?? row.id,
        publicId: strOrNull(d.publicId ?? d.public_id) ?? row.publicId,
        externalId: strOrNull(d.externalId ?? d.external_id) ?? row.externalId,
        name: strOrNull(d.name) ?? row.name,
        nameMm: strOrNull(d.nameMm ?? d.name_mm) ?? row.nameMm,
        nameEn: strOrNull(d.nameEn ?? d.name_en) ?? row.nameEn,
        buildingTypeId:
            strOrNull(d.buildingTypeId ?? d.building_type_id ?? d.building_type?.id) ??
            row.buildingTypeId,
        buildingTypeCode:
            strOrNull(d.buildingTypeCode ?? d.building_type_code ?? d.building_type?.code) ??
            row.buildingTypeCode,
        buildingTypeName:
            strOrNull(d.buildingTypeName ?? d.building_type_name ?? d.building_type?.name_en) ??
            row.buildingTypeName,
        adminAreaId:
            strOrNull(d.adminAreaId ?? d.admin_area_id ?? d.admin_area?.id) ?? row.adminAreaId,
        adminAreaName:
            strOrNull(d.adminAreaName ?? d.admin_area?.canonical_name) ?? row.adminAreaName,
        areaM2: numOrNull(d.areaM2 ?? d.area_m2) ?? row.areaM2,
        levels: numOrNull(d.levels) ?? row.levels,
        confidenceScore: numOrNull(d.confidenceScore ?? d.confidence_score) ?? row.confidenceScore,
        isVerified: boolOrNull(d.isVerified ?? d.is_verified) ?? row.isVerified,
        isActive: boolOrNull(d.isActive ?? d.is_active) ?? row.isActive,
        deletedAt: strOrNull(d.deletedAt ?? d.deleted_at) ?? row.deletedAt,
        createdAt: strOrNull(d.createdAt ?? d.created_at) ?? row.createdAt,
        updatedAt: strOrNull(d.updatedAt ?? d.updated_at) ?? row.updatedAt,
        geometry: geometryOrNull(d.geometry) ?? row.geometry,
    };
}

/** Maps landuse edit detail onto a core-review list row. */
export function applyLanduseDetailToListRow(
    row: CoreReviewLanduseRow,
    detail: unknown,
): CoreReviewLanduseRow {
    const d = detail as CoreReviewLanduseRow &
        Partial<Record<"name_mm" | "name_en" | "class_code" | "landuse_class_id", string | null>>;

    return {
        ...row,
        id: strOrNull(d.id) ?? row.id,
        publicId: strOrNull(d.publicId) ?? row.publicId,
        externalId: strOrNull(d.externalId) ?? row.externalId,
        name: strOrNull(d.name) ?? row.name,
        nameMm: strOrNull(d.nameMm ?? d.name_mm) ?? row.nameMm,
        nameEn: strOrNull(d.nameEn ?? d.name_en) ?? row.nameEn,
        nameUnd: strOrNull(d.nameUnd) ?? row.nameUnd,
        classCode: strOrNull(d.classCode ?? d.class_code) ?? row.classCode,
        landuseClassId: strOrNull(d.landuseClassId ?? d.landuse_class_id) ?? row.landuseClassId,
        landuseClassCode: strOrNull(d.landuseClassCode) ?? row.landuseClassCode,
        landuseClassNameEn: strOrNull(d.landuseClassNameEn) ?? row.landuseClassNameEn,
        landuseClassNameMm: strOrNull(d.landuseClassNameMm) ?? row.landuseClassNameMm,
        adminAreaId: strOrNull(d.adminAreaId) ?? row.adminAreaId,
        adminAreaName: strOrNull(d.adminAreaName) ?? row.adminAreaName,
        detailLevel: strOrNull(d.detailLevel) ?? row.detailLevel,
        cropCode: strOrNull(d.cropCode) ?? row.cropCode,
        irrigated: d.irrigated === null ? null : boolOrNull(d.irrigated) ?? row.irrigated,
        seasonality: strOrNull(d.seasonality) ?? row.seasonality,
        areaM2: numOrNull(d.areaM2) ?? row.areaM2,
        confidenceScore: numOrNull(d.confidenceScore) ?? row.confidenceScore,
        manualOverride: boolOrNull(d.manualOverride) ?? row.manualOverride,
        isVerified: boolOrNull(d.isVerified) ?? row.isVerified,
        isActive: boolOrNull(d.isActive) ?? row.isActive,
        deletedAt: strOrNull(d.deletedAt) ?? row.deletedAt,
        createdAt: strOrNull(d.createdAt) ?? row.createdAt,
        updatedAt: strOrNull(d.updatedAt) ?? row.updatedAt,
        geometry: geometryOrNull(d.geometry) ?? row.geometry,
        centroid: geometryOrNull(d.centroid) ?? row.centroid,
    };
}

/** Maps water line/polygon edit detail onto a core-review list row. */
export function applyMapFeatureDetailToListRow(
    row: CoreReviewMapFeatureRow,
    detail: unknown,
): CoreReviewMapFeatureRow {
    const d = detail as CoreReviewMapFeatureRow & {
        class_code?: string | null;
        is_active?: boolean;
        is_verified?: boolean;
        external_id?: string | null;
        deleted_at?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
    };

    return {
        ...row,
        id: strOrNull(d.id) ?? row.id,
        externalId: strOrNull(d.externalId ?? d.external_id) ?? row.externalId,
        name: strOrNull(d.name) ?? row.name,
        classCode: strOrNull(d.classCode ?? d.class_code) ?? row.classCode,
        isActive: boolOrNull(d.isActive ?? d.is_active) ?? row.isActive,
        isVerified: boolOrNull(d.isVerified ?? d.is_verified) ?? row.isVerified,
        deletedAt: strOrNull(d.deletedAt ?? d.deleted_at) ?? row.deletedAt,
        createdAt: strOrNull(d.createdAt ?? d.created_at) ?? row.createdAt,
        updatedAt: strOrNull(d.updatedAt ?? d.updated_at) ?? row.updatedAt,
        geometry: geometryOrNull(d.geometry) ?? row.geometry,
    };
}

/** Maps place edit detail onto a core-review list row. */
export function applyPlaceDetailToListRow(
    row: CoreReviewPlaceRow,
    detail: unknown,
): CoreReviewPlaceRow {
    const d = detail as PlaceDetail &
        Partial<CoreReviewPlaceRow> & {
            category_id?: string;
            category_name?: string | null;
            admin_area_id?: string | null;
            admin_area_name?: string | null;
            is_public?: boolean;
            is_verified?: boolean;
            importance_score?: number | null;
            popularity_score?: number | null;
            confidence_score?: number | null;
            plus_code?: string | null;
            deleted_at?: string | null;
            created_at?: string | null;
            updated_at?: string | null;
            myanmar_name?: string | null;
            english_name?: string | null;
        };

    const lat = numOrNull(d.lat) ?? row.lat;
    const lng = numOrNull(d.lng) ?? row.lng;

    return {
        ...row,
        id: strOrNull(d.id) ?? row.id,
        publicId: strOrNull(d.publicId ?? d.public_id) ?? row.publicId,
        displayName: strOrNull(d.displayName ?? d.display_name) ?? row.displayName,
        primaryName: strOrNull(d.primaryName ?? d.primary_name) ?? row.primaryName,
        categoryId: strOrNull(d.categoryId ?? d.category_id) ?? row.categoryId,
        categoryName: strOrNull(d.categoryName ?? d.category_name) ?? row.categoryName,
        adminAreaId: strOrNull(d.adminAreaId ?? d.admin_area_id) ?? row.adminAreaId,
        adminAreaName: strOrNull(d.adminAreaName ?? d.admin_area_name) ?? row.adminAreaName,
        lat,
        lng,
        geometry:
            geometryOrNull(d.geometry) ?? pointGeometryFromLatLng(lat, lng, row.geometry),
        importanceScore:
            numOrNull(d.importanceScore ?? d.importance_score) ?? row.importanceScore,
        popularityScore:
            numOrNull(d.popularityScore ?? d.popularity_score) ?? row.popularityScore,
        confidenceScore:
            numOrNull(d.confidenceScore ?? d.confidence_score) ?? row.confidenceScore,
        isPublic: boolOrNull(d.isPublic ?? d.is_public) ?? row.isPublic,
        isVerified: boolOrNull(d.isVerified ?? d.is_verified) ?? row.isVerified,
        plusCode: strOrNull(d.plusCode ?? d.plus_code) ?? row.plusCode,
        myanmarName:
            strOrNull(d.myanmarName ?? d.myanmar_name ?? d.nameMm ?? d.name_mm) ?? row.myanmarName,
        englishName:
            strOrNull(d.englishName ?? d.english_name ?? d.nameEn ?? d.name_en) ?? row.englishName,
        names: Array.isArray(d.names) ? d.names : row.names,
        deletedAt: strOrNull(d.deletedAt ?? d.deleted_at) ?? row.deletedAt,
        createdAt: strOrNull(d.createdAt ?? d.created_at) ?? row.createdAt,
        updatedAt: strOrNull(d.updatedAt ?? d.updated_at) ?? row.updatedAt,
    };
}

/** Maps address edit detail onto a core-review list row. */
export function applyAddressDetailToListRow(
    row: CoreReviewAddressRow,
    detail: unknown,
): CoreReviewAddressRow {
    const d = detail as CoreReviewAddressRow & {
        full_address?: string | null;
        house_number?: string | null;
        unit_number?: string | null;
        postal_code?: string | null;
        street_id?: string | null;
        street_name_en?: string | null;
        street_name_my?: string | null;
        admin_area_id?: string | null;
        admin_area_name?: string | null;
        generated_full_address_en?: string | null;
        generated_full_address_my?: string | null;
        display_full_address?: string | null;
        cached_full_address?: string | null;
        is_public?: boolean;
        is_verified?: boolean;
        entrance_geometry?: ImportReviewGeoJson | null;
        deleted_at?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
    };

    return {
        ...row,
        id: strOrNull(d.id) ?? row.id,
        publicId: strOrNull(d.publicId) ?? row.publicId,
        cachedFullAddress: strOrNull(d.cachedFullAddress ?? d.cached_full_address) ?? row.cachedFullAddress,
        fullAddress: strOrNull(d.fullAddress ?? d.full_address) ?? row.fullAddress,
        generatedFullAddressEn:
            strOrNull(d.generatedFullAddressEn ?? d.generated_full_address_en) ??
            row.generatedFullAddressEn,
        generatedFullAddressMy:
            strOrNull(d.generatedFullAddressMy ?? d.generated_full_address_my) ??
            row.generatedFullAddressMy,
        displayFullAddress:
            strOrNull(d.displayFullAddress ?? d.display_full_address) ?? row.displayFullAddress,
        myanmarName: strOrNull(d.myanmarName) ?? row.myanmarName,
        englishName: strOrNull(d.englishName) ?? row.englishName,
        houseNumber: strOrNull(d.houseNumber ?? d.house_number) ?? row.houseNumber,
        unitNumber: strOrNull(d.unitNumber ?? d.unit_number) ?? row.unitNumber,
        postalCode: strOrNull(d.postalCode ?? d.postal_code) ?? row.postalCode,
        streetId: strOrNull(d.streetId ?? d.street_id) ?? row.streetId,
        streetNameEn: strOrNull(d.streetNameEn ?? d.street_name_en) ?? row.streetNameEn,
        streetNameMy: strOrNull(d.streetNameMy ?? d.street_name_my) ?? row.streetNameMy,
        adminAreaId: strOrNull(d.adminAreaId ?? d.admin_area_id) ?? row.adminAreaId,
        adminAreaName: strOrNull(d.adminAreaName ?? d.admin_area_name) ?? row.adminAreaName,
        isPublic: boolOrNull(d.isPublic ?? d.is_public) ?? row.isPublic,
        isVerified: boolOrNull(d.isVerified ?? d.is_verified) ?? row.isVerified,
        confidenceScore: numOrNull(d.confidenceScore) ?? row.confidenceScore,
        deletedAt: strOrNull(d.deletedAt ?? d.deleted_at) ?? row.deletedAt,
        createdAt: strOrNull(d.createdAt ?? d.created_at) ?? row.createdAt,
        updatedAt: strOrNull(d.updatedAt ?? d.updated_at) ?? row.updatedAt,
        geometry: geometryOrNull(d.geometry) ?? row.geometry,
        entranceGeometry:
            geometryOrNull(d.entranceGeometry ?? d.entrance_geometry) ?? row.entranceGeometry,
    };
}

/** Maps admin area edit detail onto a core-review list row. */
export function applyAdminAreaDetailToListRow(
    row: CoreReviewAdminAreaRow,
    detail: unknown,
): CoreReviewAdminAreaRow {
    const d = detail as CoreReviewAdminAreaRow & {
        canonical_name?: string | null;
        parent_id?: string | null;
        admin_level_id?: string | null;
        boundary_status?: string | null;
        boundary_status_label_en?: string | null;
        boundary_status_label_mm?: string | null;
        boundary_status_helper_en?: string | null;
        address_usage?: string | null;
        address_usage_label_en?: string | null;
        address_usage_label_mm?: string | null;
        address_usage_helper_en?: string | null;
        is_official_boundary?: boolean | null;
        boundary_confidence_score?: number | null;
        boundary_note?: string | null;
        is_active?: boolean;
        is_verified?: boolean;
        deleted_at?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
    };

    return {
        ...row,
        id: strOrNull(d.id) ?? row.id,
        publicId: strOrNull(d.publicId) ?? row.publicId,
        canonicalName: strOrNull(d.canonicalName ?? d.canonical_name) ?? row.canonicalName,
        slug: strOrNull(d.slug) ?? row.slug,
        parentId: strOrNull(d.parentId ?? d.parent_id) ?? row.parentId,
        adminLevelId: strOrNull(d.adminLevelId ?? d.admin_level_id) ?? row.adminLevelId,
        boundaryStatus: strOrNull(d.boundaryStatus ?? d.boundary_status) ?? row.boundaryStatus,
        boundaryStatusLabelEn:
            strOrNull(d.boundaryStatusLabelEn ?? d.boundary_status_label_en) ??
            row.boundaryStatusLabelEn,
        boundaryStatusLabelMm:
            strOrNull(d.boundaryStatusLabelMm ?? d.boundary_status_label_mm) ??
            row.boundaryStatusLabelMm,
        boundaryStatusHelperEn:
            strOrNull(d.boundaryStatusHelperEn ?? d.boundary_status_helper_en) ??
            row.boundaryStatusHelperEn,
        addressUsage: strOrNull(d.addressUsage ?? d.address_usage) ?? row.addressUsage,
        addressUsageLabelEn:
            strOrNull(d.addressUsageLabelEn ?? d.address_usage_label_en) ?? row.addressUsageLabelEn,
        addressUsageLabelMm:
            strOrNull(d.addressUsageLabelMm ?? d.address_usage_label_mm) ?? row.addressUsageLabelMm,
        addressUsageHelperEn:
            strOrNull(d.addressUsageHelperEn ?? d.address_usage_helper_en) ??
            row.addressUsageHelperEn,
        isOfficialBoundary:
            d.isOfficialBoundary === null || d.isOfficialBoundary === undefined
                ? d.is_official_boundary === null || d.is_official_boundary === undefined
                    ? row.isOfficialBoundary
                    : d.is_official_boundary
                : d.isOfficialBoundary,
        boundaryConfidenceScore:
            numOrNull(d.boundaryConfidenceScore ?? d.boundary_confidence_score) ??
            row.boundaryConfidenceScore,
        boundaryNote: strOrNull(d.boundaryNote ?? d.boundary_note) ?? row.boundaryNote,
        isActive: boolOrNull(d.isActive ?? d.is_active) ?? row.isActive,
        isVerified: boolOrNull(d.isVerified ?? d.is_verified) ?? row.isVerified,
        deletedAt: strOrNull(d.deletedAt ?? d.deleted_at) ?? row.deletedAt,
        createdAt: strOrNull(d.createdAt ?? d.created_at) ?? row.createdAt,
        updatedAt: strOrNull(d.updatedAt ?? d.updated_at) ?? row.updatedAt,
        geometry: geometryOrNull(d.geometry) ?? row.geometry,
        centroid: geometryOrNull(d.centroid) ?? row.centroid,
    };
}

/** Maps bus route variant edit detail onto a core-review list row. */
export function applyBusRouteVariantDetailToListRow(
    row: CoreReviewBusRouteVariantRow,
    detail: unknown,
): CoreReviewBusRouteVariantRow {
    const d = detail as CoreReviewBusRouteVariantRow & {
        route_id?: string;
        route_code?: string | null;
        route_public_name?: string | null;
        variant_code?: string | null;
        direction_name?: string | null;
        origin_name?: string | null;
        destination_name?: string | null;
        distance_m?: number | null;
        is_active?: boolean;
        is_verified?: boolean;
        deleted_at?: string | null;
    };

    return {
        ...row,
        id: strOrNull(d.id) ?? row.id,
        routeId: strOrNull(d.routeId ?? d.route_id) ?? row.routeId,
        routeCode: strOrNull(d.routeCode ?? d.route_code) ?? row.routeCode,
        routePublicName:
            strOrNull(d.routePublicName ?? d.route_public_name) ?? row.routePublicName,
        variantCode: strOrNull(d.variantCode ?? d.variant_code) ?? row.variantCode,
        directionName: strOrNull(d.directionName ?? d.direction_name) ?? row.directionName,
        originName: strOrNull(d.originName ?? d.origin_name) ?? row.originName,
        destinationName: strOrNull(d.destinationName ?? d.destination_name) ?? row.destinationName,
        distanceM: numOrNull(d.distanceM ?? d.distance_m) ?? row.distanceM,
        isActive: boolOrNull(d.isActive ?? d.is_active) ?? row.isActive,
        isVerified: boolOrNull(d.isVerified ?? d.is_verified) ?? row.isVerified,
        deletedAt: strOrNull(d.deletedAt ?? d.deleted_at) ?? row.deletedAt,
        geometry: geometryOrNull(d.geometry) ?? row.geometry,
    };
}
