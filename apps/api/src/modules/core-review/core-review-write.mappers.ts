import { pickAlias } from "./core-review-write.schema.js";

type PointGeometry = { type: "Point"; coordinates: [number, number] };

function extractLatLng(body: Record<string, unknown>): { lat?: number; lng?: number } {
    const directLat = body.lat as number | undefined;
    const directLng = body.lng as number | undefined;
    if (directLat !== undefined && directLng !== undefined) {
        return { lat: directLat, lng: directLng };
    }

    const geom =
        (body.geometry as PointGeometry | undefined) ??
        (body.pointGeom as PointGeometry | undefined) ??
        (body.point_geom as PointGeometry | undefined);
    if (geom?.type === "Point" && Array.isArray(geom.coordinates)) {
        const [lng, lat] = geom.coordinates;
        return { lat, lng };
    }
    return {};
}

export function mapCoreReviewBuildingCreate(body: Record<string, unknown>) {
    return {
        geometry: body.geometry,
        name: pickAlias<string | null>(body, "name", "name") ?? null,
        name_mm: pickAlias<string | null>(body, "nameMm", "name_mm") ?? null,
        name_en: pickAlias<string | null>(body, "nameEn", "name_en") ?? null,
        building_type_id: pickAlias<bigint | undefined>(body, "buildingTypeId", "building_type_id"),
        admin_area_id: pickAlias<bigint | null | undefined>(body, "adminAreaId", "admin_area_id"),
        levels: body.levels as number | undefined,
        height_m: pickAlias<number | undefined>(body, "heightM", "height_m"),
        confidence_score: pickAlias<number | undefined>(body, "confidenceScore", "confidence_score") ?? 80,
        is_verified: pickAlias<boolean | undefined>(body, "isVerified", "is_verified"),
    };
}

export function mapCoreReviewBuildingPatch(body: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    if (body.geometry !== undefined) out.geometry = body.geometry;
    if (pickAlias(body, "name", "name") !== undefined) {
        out.name = pickAlias(body, "name", "name") ?? null;
    }
    if (pickAlias(body, "nameMm", "name_mm") !== undefined) {
        out.name_mm = pickAlias(body, "nameMm", "name_mm") ?? null;
    }
    if (pickAlias(body, "nameEn", "name_en") !== undefined) {
        out.name_en = pickAlias(body, "nameEn", "name_en") ?? null;
    }
    if (pickAlias(body, "buildingTypeId", "building_type_id") !== undefined) {
        out.building_type_id = pickAlias(body, "buildingTypeId", "building_type_id");
    }
    if (pickAlias(body, "adminAreaId", "admin_area_id") !== undefined) {
        out.admin_area_id = pickAlias(body, "adminAreaId", "admin_area_id");
    }
    if (body.levels !== undefined) out.levels = body.levels;
    if (pickAlias(body, "heightM", "height_m") !== undefined) {
        out.height_m = pickAlias(body, "heightM", "height_m");
    }
    if (pickAlias(body, "confidenceScore", "confidence_score") !== undefined) {
        out.confidence_score = pickAlias(body, "confidenceScore", "confidence_score");
    }
    if (pickAlias(body, "isVerified", "is_verified") !== undefined) {
        out.is_verified = pickAlias(body, "isVerified", "is_verified");
    }
    return out;
}

export function mapCoreReviewPlaceCreate(body: Record<string, unknown>) {
    const { lat, lng } = extractLatLng(body);
    if (lat === undefined || lng === undefined) {
        throw new Error("lat and lng are required");
    }
    return {
        myanmarName: pickAlias<string | undefined>(body, "myanmarName", "myanmar_name"),
        englishName: pickAlias<string | undefined>(body, "englishName", "english_name"),
        categoryId: pickAlias<bigint>(body, "categoryId", "category_id"),
        adminAreaId: pickAlias<bigint | null | undefined>(body, "adminAreaId", "admin_area_id"),
        lat,
        lng,
        plusCode: pickAlias<string | null | undefined>(body, "plusCode", "plus_code"),
        importanceScore: pickAlias<number | undefined>(body, "importanceScore", "importance_score"),
        popularityScore: pickAlias<number | undefined>(body, "popularityScore", "popularity_score"),
        confidenceScore: pickAlias<number | undefined>(body, "confidenceScore", "confidence_score"),
        isPublic: pickAlias<boolean | undefined>(body, "isPublic", "is_public"),
        isVerified: pickAlias<boolean | undefined>(body, "isVerified", "is_verified"),
        sourceTypeId: pickAlias<bigint | null | undefined>(body, "sourceTypeId", "source_type_id"),
        publishStatusId: pickAlias<bigint | null | undefined>(body, "publishStatusId", "publish_status_id"),
    };
}

export function mapCoreReviewPlacePatch(body: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    if (pickAlias(body, "myanmarName", "myanmar_name") !== undefined) {
        out.myanmarName = pickAlias(body, "myanmarName", "myanmar_name");
    }
    if (pickAlias(body, "englishName", "english_name") !== undefined) {
        out.englishName = pickAlias(body, "englishName", "english_name");
    }
    if (pickAlias(body, "categoryId", "category_id") !== undefined) {
        out.categoryId = pickAlias(body, "categoryId", "category_id");
    }
    if (pickAlias(body, "adminAreaId", "admin_area_id") !== undefined) {
        out.adminAreaId = pickAlias(body, "adminAreaId", "admin_area_id");
    }
    const { lat, lng } = extractLatLng(body);
    if (lat !== undefined) out.lat = lat;
    if (lng !== undefined) out.lng = lng;
    if (pickAlias(body, "plusCode", "plus_code") !== undefined) {
        out.plusCode = pickAlias(body, "plusCode", "plus_code");
    }
    if (pickAlias(body, "importanceScore", "importance_score") !== undefined) {
        out.importanceScore = pickAlias(body, "importanceScore", "importance_score");
    }
    if (pickAlias(body, "popularityScore", "popularity_score") !== undefined) {
        out.popularityScore = pickAlias(body, "popularityScore", "popularity_score");
    }
    if (pickAlias(body, "confidenceScore", "confidence_score") !== undefined) {
        out.confidenceScore = pickAlias(body, "confidenceScore", "confidence_score");
    }
    if (pickAlias(body, "isPublic", "is_public") !== undefined) {
        out.isPublic = pickAlias(body, "isPublic", "is_public");
    }
    if (pickAlias(body, "isVerified", "is_verified") !== undefined) {
        out.isVerified = pickAlias(body, "isVerified", "is_verified");
    }
    if (pickAlias(body, "sourceTypeId", "source_type_id") !== undefined) {
        out.sourceTypeId = pickAlias(body, "sourceTypeId", "source_type_id");
    }
    if (pickAlias(body, "publishStatusId", "publish_status_id") !== undefined) {
        out.publishStatusId = pickAlias(body, "publishStatusId", "publish_status_id");
    }
    return out;
}

export function mapCoreReviewStreetCreate(body: Record<string, unknown>) {
    return {
        geometry: body.geometry,
        myanmarName: pickAlias<string | undefined>(body, "myanmarName", "myanmar_name"),
        englishName: pickAlias<string | undefined>(body, "englishName", "english_name"),
        road_class_id: pickAlias<bigint>(body, "roadClassId", "road_class_id"),
        admin_area_id: pickAlias<bigint | null | undefined>(body, "adminAreaId", "admin_area_id"),
        is_oneway: pickAlias<boolean | undefined>(body, "isOneway", "is_oneway") ?? false,
        surface: pickAlias<string | null | undefined>(body, "surface", "surface") ?? null,
        bridge: pickAlias<boolean | undefined>(body, "bridge", "bridge") ?? false,
        tunnel: pickAlias<boolean | undefined>(body, "tunnel", "tunnel") ?? false,
    };
}

export function mapCoreReviewStreetPatch(body: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    if (body.geometry !== undefined) out.geometry = body.geometry;
    if (pickAlias(body, "myanmarName", "myanmar_name") !== undefined) {
        out.myanmarName = pickAlias(body, "myanmarName", "myanmar_name");
    }
    if (pickAlias(body, "englishName", "english_name") !== undefined) {
        out.englishName = pickAlias(body, "englishName", "english_name");
    }
    if (pickAlias(body, "roadClassId", "road_class_id") !== undefined) {
        out.road_class_id = pickAlias(body, "roadClassId", "road_class_id");
    }
    if (pickAlias(body, "adminAreaId", "admin_area_id") !== undefined) {
        out.admin_area_id = pickAlias(body, "adminAreaId", "admin_area_id");
    }
    if (pickAlias(body, "isOneway", "is_oneway") !== undefined) {
        out.is_oneway = pickAlias(body, "isOneway", "is_oneway");
    }
    if (pickAlias(body, "surface", "surface") !== undefined) {
        out.surface = pickAlias(body, "surface", "surface");
    }
    if (pickAlias(body, "bridge", "bridge") !== undefined) {
        out.bridge = pickAlias(body, "bridge", "bridge");
    }
    if (pickAlias(body, "tunnel", "tunnel") !== undefined) {
        out.tunnel = pickAlias(body, "tunnel", "tunnel");
    }
    if (pickAlias(body, "editReason", "edit_reason") !== undefined) {
        out.edit_reason = pickAlias(body, "editReason", "edit_reason");
    }
    return out;
}
