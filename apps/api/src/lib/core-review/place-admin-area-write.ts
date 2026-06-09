import type { JwtUser } from "../../plugins/auth.js";
import type { EntityAdminAreaService } from "../../modules/entity-admin-area/entity-admin-area.service.js";

function readPlaceAdminAreaFromBody(body: {
    adminAreaId?: bigint | null;
    admin_area_id?: bigint | null;
}): { present: boolean; value: bigint | null | undefined } {
    if ("adminAreaId" in body) {
        return { present: true, value: body.adminAreaId };
    }
    if ("admin_area_id" in body) {
        return { present: true, value: body.admin_area_id };
    }
    return { present: false, value: undefined };
}

function isExplicitPlaceAdminAreaClear(body: {
    explicitClearAdminArea?: boolean;
    explicit_clear_admin_area?: boolean;
}): boolean {
    return body.explicitClearAdminArea === true || body.explicit_clear_admin_area === true;
}

export type PlaceAdminAreaUpdatePatch = {
    admin_area_id?: bigint | null;
};

/**
 * Place update — omitted adminAreaId preserves township/null and clears legacy non-township.
 * Null without explicitClearAdminArea preserves existing; null with explicit clear clears.
 */
export async function resolvePlaceAdminAreaForUpdate(args: {
    service: EntityAdminAreaService;
    body: {
        adminAreaId?: bigint | null;
        admin_area_id?: bigint | null;
        explicitClearAdminArea?: boolean;
        explicit_clear_admin_area?: boolean;
        lat?: number;
        lng?: number;
    };
    existingAdminAreaId: bigint | null;
    existingLat: number;
    existingLng: number;
    user: JwtUser;
}): Promise<PlaceAdminAreaUpdatePatch> {
    const adminInBody = readPlaceAdminAreaFromBody(args.body);
    const explicitClear = isExplicitPlaceAdminAreaClear(args.body);

    if (!adminInBody.present) {
        const omitted = await args.service.resolveTownshipAdminAreaForOmittedUpdate(
            args.existingAdminAreaId,
        );
        if (omitted.admin_area_id !== undefined) {
            return { admin_area_id: omitted.admin_area_id };
        }
        return {};
    }

    const requested = adminInBody.value ?? null;

    if (requested === null) {
        if (explicitClear) {
            return { admin_area_id: null };
        }
        return {};
    }

    const lat = args.body.lat ?? args.existingLat;
    const lng = args.body.lng ?? args.existingLng;
    const resolved = await args.service.resolveForWrite({
        kind: "place",
        lat,
        lng,
        requested_admin_area_id: requested,
        user: args.user,
        path: "adminAreaId",
    });
    return { admin_area_id: resolved.admin_area_id };
}
