import { z } from "zod";

import { normalizeEntityAdminAreaKind } from "./entity-admin-area-kind.js";

const entityKindInputSchema = z.enum(["place", "street", "building", "landuse", "bus_stop", "road"]);

const geoJsonGeometrySchema = z.object({
    type: z.string(),
    coordinates: z.unknown(),
});

export const entityAdminAreaInferBodySchema = z
    .object({
        kind: entityKindInputSchema,
        lat: z.number().finite().optional(),
        lng: z.number().finite().optional(),
        geometry: geoJsonGeometrySchema.optional(),
        /** Road edit audit: stored admin_area_id from DB (does not change inference). */
        current_admin_area_id: z.string().trim().optional(),
        /** Road edit audit logging only. */
        entity_public_id: z.string().trim().optional(),
    })
    .superRefine((body, ctx) => {
        const kind = normalizeEntityAdminAreaKind(body.kind);
        if (!kind) {
            ctx.addIssue({
                code: "custom",
                message: "kind must be place, street, building, landuse, bus_stop, or road",
                path: ["kind"],
            });
            return;
        }
        if (kind === "place" || kind === "bus_stop") {
            const hasLatLng = body.lat !== undefined && body.lng !== undefined;
            const hasPointGeometry =
                body.geometry?.type === "Point" &&
                Array.isArray(body.geometry.coordinates) &&
                body.geometry.coordinates.length >= 2;
            if (!hasLatLng && !hasPointGeometry) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        kind === "bus_stop"
                            ? "lat and lng or a Point geometry are required for bus_stop inference"
                            : "lat and lng are required for place inference",
                    path: ["lat"],
                });
            }
            return;
        }
        if ((kind === "building" || kind === "landuse") && !body.geometry) {
            ctx.addIssue({
                code: "custom",
                message: `geometry is required for ${kind} inference`,
                path: ["geometry"],
            });
        }
    })
    .transform((body) => ({
        ...body,
        kind: normalizeEntityAdminAreaKind(body.kind)!,
    }));

export const entityAdminAreaValidateManualBodySchema = entityAdminAreaInferBodySchema.and(
    z.object({
        admin_area_id: z.string().trim().min(1),
    })
);
