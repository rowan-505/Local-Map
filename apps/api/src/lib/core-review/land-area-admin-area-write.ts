import type { JwtUser } from "../../plugins/auth.js";
import type { EntityAdminAreaService } from "../../modules/entity-admin-area/entity-admin-area.service.js";
import { pickAlias } from "../../modules/core-review/core-review-write.schema.js";

type GeoJsonGeometry = { type: string; coordinates: unknown };

function isPolygonLikeGeometry(geometry: unknown): geometry is GeoJsonGeometry {
    if (!geometry || typeof geometry !== "object" || !("type" in geometry)) {
        return false;
    }
    const t = (geometry as GeoJsonGeometry).type;
    return t === "Polygon" || t === "MultiPolygon";
}

function readAdminAreaFromBody(body: Record<string, unknown>): {
    present: boolean;
    value: bigint | null | undefined;
} {
    if ("admin_area_id" in body) {
        return { present: true, value: body.admin_area_id as bigint | null };
    }
    if ("adminAreaId" in body) {
        return { present: true, value: body.adminAreaId as bigint | null };
    }
    return { present: false, value: undefined };
}

function isExplicitAdminAreaClear(body: Record<string, unknown>): boolean {
    return body.explicitClearAdminArea === true || body.explicit_clear_admin_area === true;
}

/** Land area create — infer township from polygon when admin_area_id is omitted. */
export async function applyLandAreaAdminAreaForCreate(
    service: EntityAdminAreaService,
    body: Record<string, unknown>,
    geometry: unknown,
    user: JwtUser,
): Promise<void> {
    const requested = pickAlias<bigint | null | undefined>(body, "adminAreaId", "admin_area_id");

    if (!isPolygonLikeGeometry(geometry)) {
        if (requested !== undefined && requested !== null) {
            await service.assertActiveTownshipAdminArea(requested, "admin_area_id");
            body.admin_area_id = requested;
        }
        return;
    }

    const resolved = await service.resolveForWrite({
        kind: "land_area",
        geometry,
        requested_admin_area_id: requested,
        user,
        path: "admin_area_id",
    });

    if (requested !== undefined) {
        body.admin_area_id = resolved.admin_area_id;
        return;
    }

    if (resolved.admin_area_id !== null) {
        body.admin_area_id = resolved.admin_area_id;
    }
}

/**
 * Land area update — omitted admin_area_id preserves township/null and clears legacy non-township.
 */
export async function applyLandAreaAdminAreaForUpdate(
    service: EntityAdminAreaService,
    body: Record<string, unknown>,
    geometry: unknown,
    existingAdminAreaId: bigint | null,
    user: JwtUser,
): Promise<void> {
    const adminInBody = readAdminAreaFromBody(body);
    const explicitClear = isExplicitAdminAreaClear(body);

    if (!adminInBody.present) {
        const omitted = await service.resolveTownshipAdminAreaForOmittedUpdate(existingAdminAreaId);
        if (omitted.admin_area_id !== undefined) {
            body.admin_area_id = omitted.admin_area_id;
        } else {
            delete body.admin_area_id;
            delete body.adminAreaId;
        }
        return;
    }

    const requested = adminInBody.value ?? null;

    if (requested === null) {
        if (explicitClear) {
            body.admin_area_id = null;
        } else {
            delete body.admin_area_id;
            delete body.adminAreaId;
        }
        return;
    }

    if (!isPolygonLikeGeometry(geometry)) {
        await service.assertActiveTownshipAdminArea(requested, "admin_area_id");
        body.admin_area_id = requested;
        return;
    }

    const resolved = await service.resolveForWrite({
        kind: "land_area",
        geometry,
        requested_admin_area_id: requested,
        user,
        path: "admin_area_id",
    });
    body.admin_area_id = resolved.admin_area_id;
}
