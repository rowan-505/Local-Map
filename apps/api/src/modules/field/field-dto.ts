import { canonicalYbsVariantIdentity } from "../transport/ybs-direction.js";
import type { FieldRoute, FieldRoutePath, FieldRouteStop, FieldStop, FieldVariant } from "./field.schema.js";

export type FieldRouteRow = {
    public_id: string;
    route_code: string;
    name_my: string | null;
    name_en: string | null;
};

export type FieldVariantRow = {
    public_id: string;
    route_public_id: string;
    route_code: string;
    direction_id: number;
    origin_name: string | null;
    destination_name: string | null;
};

export type FieldStopRow = {
    public_id: string;
    stop_code: string | null;
    name_my: string | null;
    name_en: string | null;
    lat: number;
    lng: number;
};

export type FieldRouteStopRow = {
    variant_public_id: string;
    stop_public_id: string;
    stop_sequence: number;
};

export type FieldRoutePathRow = {
    variant_public_id: string;
    geometry: unknown;
};

export function toFieldRoute(row: FieldRouteRow): FieldRoute {
    return {
        publicId: row.public_id,
        routeCode: row.route_code,
        nameMy: row.name_my,
        nameEn: row.name_en,
    };
}

export function toFieldVariant(row: FieldVariantRow): FieldVariant | null {
    const identity = canonicalYbsVariantIdentity(row.route_code, row.direction_id);
    if (!identity) {
        return null;
    }
    return {
        publicId: row.public_id,
        routePublicId: row.route_public_id,
        variantCode: identity.directionName,
        directionId: identity.directionId,
        originName: row.origin_name,
        destinationName: row.destination_name,
    };
}

export function toFieldStop(row: FieldStopRow): FieldStop | null {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
        return null;
    }
    return {
        publicId: row.public_id,
        stopCode: row.stop_code,
        nameMy: row.name_my,
        nameEn: row.name_en,
        lat: row.lat,
        lng: row.lng,
    };
}

export function toFieldRouteStop(row: FieldRouteStopRow): FieldRouteStop | null {
    if (!Number.isInteger(row.stop_sequence) || row.stop_sequence < 1) {
        return null;
    }
    return {
        variantPublicId: row.variant_public_id,
        stopPublicId: row.stop_public_id,
        stopSequence: row.stop_sequence,
    };
}

export function toFieldRoutePath(row: FieldRoutePathRow): FieldRoutePath | null {
    const geometry = asLineString(row.geometry);
    if (!geometry) {
        return null;
    }
    return {
        variantPublicId: row.variant_public_id,
        geometry,
    };
}

export function asLineString(
    value: unknown
): { type: "LineString"; coordinates: [number, number][] } | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const geom = value as { type?: unknown; coordinates?: unknown };
    if (geom.type !== "LineString" || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
        return null;
    }
    const coordinates: [number, number][] = [];
    for (const pair of geom.coordinates) {
        if (!Array.isArray(pair) || pair.length < 2) {
            return null;
        }
        const lng = Number(pair[0]);
        const lat = Number(pair[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
        }
        coordinates.push([lng, lat]);
    }
    return { type: "LineString", coordinates };
}

export function sortRouteStops(items: FieldRouteStop[]): FieldRouteStop[] {
    return [...items].sort((a, b) => {
        const variant = a.variantPublicId.localeCompare(b.variantPublicId);
        if (variant !== 0) {
            return variant;
        }
        return a.stopSequence - b.stopSequence;
    });
}
