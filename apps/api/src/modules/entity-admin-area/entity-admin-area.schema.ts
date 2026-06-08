import { z } from "zod";

import { normalizeEntityAdminAreaKind } from "./entity-admin-area-kind.js";

const entityKindInputSchema = z.enum(["place", "street", "building", "road"]);

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
    })
    .superRefine((body, ctx) => {
        const kind = normalizeEntityAdminAreaKind(body.kind);
        if (!kind) {
            ctx.addIssue({
                code: "custom",
                message: "kind must be place, street, building, or road",
                path: ["kind"],
            });
            return;
        }
        if (kind === "place") {
            if (body.lat === undefined || body.lng === undefined) {
                ctx.addIssue({
                    code: "custom",
                    message: "lat and lng are required for place inference",
                    path: ["lat"],
                });
            }
            return;
        }
        if (!body.geometry) {
            ctx.addIssue({
                code: "custom",
                message: "geometry is required for street/building inference",
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
