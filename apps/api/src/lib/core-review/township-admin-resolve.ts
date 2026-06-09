import type { JwtUser } from "../../plugins/auth.js";
import { EntityAdminAreaValidationError } from "../../modules/entity-admin-area/entity-admin-area.service.js";
import type { EntityAdminAreaService } from "../../modules/entity-admin-area/entity-admin-area.service.js";
import { pickAlias } from "../../modules/core-review/core-review-write.schema.js";
import {
    isTownshipAdminEntity,
    townshipAdminEntityInferKind,
    type TownshipAdminEntitySlug,
} from "./township-admin-policy.js";

type GeoJsonGeometry = { type: string; coordinates: unknown };

function pointFromGeometry(geometry: unknown): { lat: number; lng: number } | null {
    if (!geometry || typeof geometry !== "object" || !("type" in geometry)) {
        return null;
    }
    const g = geometry as GeoJsonGeometry;
    if (g.type !== "Point" || !Array.isArray(g.coordinates) || g.coordinates.length < 2) {
        return null;
    }
    const lng = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
    }
    return { lat, lng };
}

function isPolygonLikeGeometry(geometry: unknown): geometry is GeoJsonGeometry {
    if (!geometry || typeof geometry !== "object" || !("type" in geometry)) {
        return false;
    }
    const t = (geometry as GeoJsonGeometry).type;
    return t === "Polygon" || t === "MultiPolygon";
}

/**
 * Resolves township admin_area_id for generic core-review writes (landuse, bus-stops).
 * Mutates body with resolved bigint id (or null) under admin_area_id / adminAreaId.
 */
export async function applyTownshipAdminAreaToGenericWriteBody(
    service: EntityAdminAreaService,
    slug: TownshipAdminEntitySlug,
    body: Record<string, unknown>,
    geometry: unknown,
    user: JwtUser,
): Promise<void> {
    const inferKind = townshipAdminEntityInferKind(slug);
    const requested = pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id");

    try {
        if (inferKind === "place") {
            const pt = pointFromGeometry(geometry);
            if (!pt) {
                return;
            }
            const resolved = await service.resolveForWrite({
                kind: "place",
                lat: pt.lat,
                lng: pt.lng,
                requested_admin_area_id: requested,
                user,
                path: "admin_area_id",
            });
            body.admin_area_id = resolved.admin_area_id;
            return;
        }

        if (!isPolygonLikeGeometry(geometry)) {
            return;
        }

        const resolved = await service.resolveForWrite({
            kind: "building",
            geometry,
            requested_admin_area_id: requested,
            user,
            path: "admin_area_id",
        });
        body.admin_area_id = resolved.admin_area_id;
    } catch (error) {
        if (error instanceof EntityAdminAreaValidationError) {
            throw error;
        }
        throw error;
    }
}

/** @deprecated No generic-write slugs use applyTownshipAdminAreaToGenericWriteBody anymore. */
export function genericWriteSlugUsesTownshipPolicy(_slug: string): _slug is TownshipAdminEntitySlug {
    return false;
}
