import type { JwtUser } from "../../plugins/auth.js";
import type { EntityAdminAreaService } from "../../modules/entity-admin-area/entity-admin-area.service.js";

type GeoJsonGeometry = { type: string; coordinates: unknown };

function isPolygonLikeGeometry(geometry: unknown): geometry is GeoJsonGeometry {
    if (!geometry || typeof geometry !== "object" || !("type" in geometry)) {
        return false;
    }
    const t = (geometry as GeoJsonGeometry).type;
    return t === "Polygon" || t === "MultiPolygon";
}

function isExplicitBuildingAdminAreaClear(body: {
    explicitClearAdminArea?: boolean;
    explicit_clear_admin_area?: boolean;
}): boolean {
    return body.explicitClearAdminArea === true || body.explicit_clear_admin_area === true;
}

export type BuildingAdminAreaUpdateResult = {
    admin_area_id: bigint | null;
    admin_area_resolve_spatial: boolean;
};

/**
 * Building update — omitted admin_area_id preserves township/null and clears legacy non-township.
 * Null without explicitClearAdminArea preserves existing; null with explicit clear clears.
 */
export async function resolveBuildingAdminAreaForUpdate(args: {
    service: EntityAdminAreaService;
    patch: {
        admin_area_id?: bigint | null;
        explicitClearAdminArea?: boolean;
        explicit_clear_admin_area?: boolean;
        geometry?: GeoJsonGeometry;
    };
    existingAdminAreaId: bigint | null;
    fallbackGeometry: GeoJsonGeometry | undefined;
    user: JwtUser;
}): Promise<BuildingAdminAreaUpdateResult> {
    const explicitClear = isExplicitBuildingAdminAreaClear(args.patch);
    const geometry = args.patch.geometry ?? args.fallbackGeometry;

    if (args.patch.admin_area_id === undefined) {
        const omitted = await args.service.resolveTownshipAdminAreaForOmittedUpdate(
            args.existingAdminAreaId,
        );
        if (omitted.admin_area_id === undefined) {
            return {
                admin_area_id: args.existingAdminAreaId,
                admin_area_resolve_spatial: false,
            };
        }
        return {
            admin_area_id: omitted.admin_area_id,
            admin_area_resolve_spatial: false,
        };
    }

    if (args.patch.admin_area_id === null) {
        if (explicitClear) {
            return { admin_area_id: null, admin_area_resolve_spatial: false };
        }
        return {
            admin_area_id: args.existingAdminAreaId,
            admin_area_resolve_spatial: false,
        };
    }

    const requested = args.patch.admin_area_id;

    if (!isPolygonLikeGeometry(geometry)) {
        await args.service.assertActiveTownshipAdminArea(requested, "admin_area_id");
        return { admin_area_id: requested, admin_area_resolve_spatial: false };
    }

    const resolved = await args.service.resolveForWrite({
        kind: "building",
        geometry,
        requested_admin_area_id: requested,
        user: args.user,
        path: "admin_area_id",
    });
    return {
        admin_area_id: resolved.admin_area_id,
        admin_area_resolve_spatial: resolved.admin_area_id === null,
    };
}
