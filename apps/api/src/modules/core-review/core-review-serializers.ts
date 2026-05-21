import { mapBuildingNameFields } from "../../lib/entity-names/building-detail-select-sql.js";
import type { BuildingDetailRow } from "../buildings/buildings.repo.js";
import type { PlaceDetailRow, PlaceNameRow, PlaceRow } from "../places/places.repo.js";
import type { StreetRow } from "../streets/streets.repo.js";
import type { CoreReviewNameDto } from "./core-review.types.js";

function iso(d: Date | string | null | undefined): string | null {
    if (d === null || d === undefined) {
        return null;
    }
    if (d instanceof Date) {
        return d.toISOString();
    }
    return String(d);
}

export function mapPlaceNames(names: PlaceNameRow[]): CoreReviewNameDto[] {
    return names.map((n) => ({
        id: String(n.id),
        name: n.name,
        languageCode: n.language_code,
        scriptCode: n.script_code,
        nameType: n.name_type,
        isPrimary: n.is_primary,
        searchWeight: n.search_weight,
    }));
}

export function serializeCoreReviewBuilding(row: BuildingDetailRow) {
    const names = mapBuildingNameFields(row);
    return {
        id: row.id,
        publicId: row.public_id,
        externalId: row.external_id,
        name: names.name,
        nameMm: names.name_mm,
        nameEn: names.name_en,
        buildingTypeId: row.building_type_id,
        buildingTypeCode: row.building_type_code,
        buildingTypeName: row.building_type_name,
        adminAreaId: row.admin_area_id,
        adminAreaName: row.admin_area_canonical_name,
        areaM2: row.area_m2,
        levels: row.levels,
        confidenceScore: row.confidence_score,
        isVerified: row.is_verified,
        isActive: row.is_active,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        geometry: row.geometry,
    };
}

export function serializeCoreReviewPlace(row: PlaceRow | PlaceDetailRow, includeDetail = false) {
    const geometry =
        typeof row.lng === "number" && typeof row.lat === "number"
            ? { type: "Point" as const, coordinates: [row.lng, row.lat] }
            : null;

    const base = {
        id: String(row.id),
        publicId: row.public_id,
        displayName: row.display_name,
        primaryName: row.primary_name,
        categoryId: String(row.category_id),
        categoryName: row.category_name,
        adminAreaId: row.admin_area_id !== null ? String(row.admin_area_id) : null,
        adminAreaName: row.admin_area_name,
        lat: row.lat,
        lng: row.lng,
        geometry,
        importanceScore: row.importance_score,
        popularityScore: row.popularity_score,
        confidenceScore: row.confidence_score,
        isPublic: row.is_public,
        isVerified: row.is_verified,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        names: mapPlaceNames(row.names ?? []),
        myanmarName: row.myanmar_name,
        englishName: row.english_name,
    };

    if (!includeDetail) {
        return base;
    }

    const detail = row as PlaceDetailRow;
    return {
        ...base,
        plusCode: detail.plus_code,
        currentVersionId: detail.current_version_id !== null ? String(detail.current_version_id) : null,
        deletedAt: iso(detail.deleted_at),
        sourceTypeId: String(detail.source_type_id),
        publishStatusId:
            detail.publish_status_id !== null ? String(detail.publish_status_id) : null,
    };
}

export function serializeCoreReviewStreet(row: StreetRow) {
    return {
        publicId: row.public_id,
        canonicalName: row.canonical_name,
        adminAreaId: row.admin_area_id,
        adminAreaName: row.admin_area_name,
        roadClassId: row.road_class_id,
        roadClass: row.road_class,
        roadClassName: row.road_class_name,
        surface: row.surface,
        isOneway: row.is_oneway,
        bridge: row.bridge,
        tunnel: row.tunnel,
        manualOverride: row.manual_override,
        editStatus: row.edit_status,
        routingStatus: row.routing_status,
        deletedAt: iso(row.deleted_at),
        lastEditedAt: iso(row.last_edited_at),
        isActive: row.is_active,
        isVerified: row.is_verified,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        geometry: row.geometry,
        names: (row.names ?? []).map((n) => ({
            id: String(n.id),
            name: n.name,
            languageCode: n.language_code,
            scriptCode: n.script_code,
            nameType: n.name_type,
            isPrimary: n.is_primary,
        })),
        myanmarName: row.myanmar_name,
        englishName: row.english_name,
    };
}

export function serializeGenericCoreRow(row: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
        if (value instanceof Date) {
            out[key] = value.toISOString();
            continue;
        }
        if (typeof value === "bigint") {
            out[key] = value.toString();
            continue;
        }
        if (value !== null && typeof value === "object" && "toISOString" in value) {
            try {
                out[key] = (value as Date).toISOString();
                continue;
            } catch {
                /* fall through */
            }
        }
        out[key] = value;
    }
    return out;
}
