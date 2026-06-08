import type { ImportReviewGeoJson, Street } from "@/src/lib/api";

import type { CoreReviewStreetRow } from "../config/types";
import { verificationFieldsFromDetail } from "../config/detailListRowUtils";

type StreetDetailLike = Street &
    Partial<CoreReviewStreetRow> & {
        is_verified?: boolean;
    };

function strOrNull(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const trimmed = String(value).trim();
    return trimmed || null;
}

function boolOrNull(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
}

function geometryOrNull(value: unknown): ImportReviewGeoJson | null {
    if (!value || typeof value !== "object" || !("type" in value)) {
        return null;
    }
    return value as ImportReviewGeoJson;
}

function adminAreaFieldsFromStreetDetail(
    d: StreetDetailLike,
    row: CoreReviewStreetRow,
): Pick<CoreReviewStreetRow, "adminAreaId" | "adminAreaName"> {
    const hasId = "admin_area_id" in d || "adminAreaId" in d;
    const hasName = "admin_area_name" in d || "adminAreaName" in d;
    return {
        adminAreaId: hasId ? strOrNull(d.adminAreaId ?? d.admin_area_id) : row.adminAreaId,
        adminAreaName: hasName ? strOrNull(d.adminAreaName ?? d.admin_area_name) : row.adminAreaName,
    };
}

/** Maps street edit detail (legacy `/streets/:id`) onto a core-review list row. */
export function applyStreetDetailToListRow(
    row: CoreReviewStreetRow,
    detail: unknown,
): CoreReviewStreetRow {
    const d = detail as StreetDetailLike;
    const verification = verificationFieldsFromDetail(d, row);

    return {
        ...row,
        publicId: d.publicId ?? d.public_id ?? row.publicId,
        canonicalName: d.canonicalName ?? d.canonical_name ?? row.canonicalName,
        myanmarName: d.myanmarName ?? row.myanmarName,
        englishName: d.englishName ?? row.englishName,
        ...adminAreaFieldsFromStreetDetail(d, row),
        roadClassId: strOrNull(d.roadClassId ?? d.road_class_id) ?? row.roadClassId,
        roadClass: strOrNull(d.roadClass ?? d.road_class) ?? row.roadClass,
        roadClassName: strOrNull(d.roadClassName ?? d.road_class_name) ?? row.roadClassName,
        surface: strOrNull(d.surface) ?? row.surface,
        isOneway: boolOrNull(d.isOneway ?? d.is_oneway) ?? row.isOneway,
        bridge: boolOrNull(d.bridge) ?? row.bridge,
        tunnel: boolOrNull(d.tunnel) ?? row.tunnel,
        routingStatus: strOrNull(d.routingStatus ?? d.routing_status) ?? row.routingStatus,
        isActive: boolOrNull(d.isActive ?? d.is_active) ?? row.isActive,
        verificationStatus: verification.verificationStatus,
        isVerified: verification.isVerified,
        deletedAt: strOrNull(d.deletedAt ?? d.deleted_at) ?? row.deletedAt,
        createdAt: strOrNull(d.createdAt ?? d.created_at) ?? row.createdAt,
        updatedAt: strOrNull(d.updatedAt ?? d.updated_at) ?? row.updatedAt,
        geometry: geometryOrNull(d.geometry) ?? row.geometry,
    };
}
