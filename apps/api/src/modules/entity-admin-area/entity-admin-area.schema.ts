import { z } from "zod";

const entityKindSchema = z.enum(["place", "street", "building"]);

const geoJsonGeometrySchema = z.object({
    type: z.string(),
    coordinates: z.unknown(),
});

export const entityAdminAreaInferBodySchema = z
    .object({
        kind: entityKindSchema,
        lat: z.number().finite().optional(),
        lng: z.number().finite().optional(),
        geometry: geoJsonGeometrySchema.optional(),
    })
    .superRefine((body, ctx) => {
        if (body.kind === "place") {
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
    });

export const entityAdminAreaValidateManualBodySchema = entityAdminAreaInferBodySchema.and(
    z.object({
        admin_area_id: z.string().trim().min(1),
    })
);
