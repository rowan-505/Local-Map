import { z } from "zod";

import { placeIdParamsSchema as placePublicIdParamsSchema } from "../places/places.schema.js";

export const RELATION_TYPES = ["inside", "entrance", "nearby", "compound"] as const;

export const relationTypeSchema = z.enum(RELATION_TYPES);

export const placeBuildingParamsSchema = placePublicIdParamsSchema.extend({
    buildingId: z.string().uuid(),
});

export const linkPlaceBuildingBodySchema = z
    .object({
        building_id: z.string().uuid(),
        relation_type: relationTypeSchema.default("inside"),
        is_primary: z.boolean().optional().default(false),
    })
    .strict();

export type LinkPlaceBuildingBody = z.infer<typeof linkPlaceBuildingBodySchema>;

export const patchPlaceBuildingBodySchema = z
    .object({
        relation_type: relationTypeSchema.optional(),
        is_primary: z.boolean().optional(),
    })
    .strict()
    .refine((body) => body.relation_type !== undefined || body.is_primary !== undefined, {
        message: "At least one of relation_type or is_primary is required",
        path: ["relation_type"],
    });

export type PatchPlaceBuildingBody = z.infer<typeof patchPlaceBuildingBodySchema>;
