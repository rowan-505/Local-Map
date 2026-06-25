import { z } from "zod";

/**
 * Saved-place create payload. Two modes:
 *  - place:      references a core place (entityId required).
 *  - map_point:  an arbitrary clicked location (lat/lng required).
 */
export const createSavedPlaceBodySchema = z.discriminatedUnion("entityType", [
    z.object({
        entityType: z.literal("place"),
        entityId: z.number().int().positive(),
    }),
    z.object({
        entityType: z.literal("map_point"),
        customName: z.string().trim().min(1).max(120).optional(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        addressLine: z.string().trim().max(500).optional(),
        plusCode: z.string().trim().max(60).optional(),
        adminAreaId: z.number().int().positive().optional(),
    }),
]);

export type CreateSavedPlaceBody = z.infer<typeof createSavedPlaceBodySchema>;

export const savedPlaceIdParamSchema = z.object({
    id: z
        .string()
        .trim()
        .regex(/^\d+$/, "Saved place id must be a positive integer"),
});

export const savedPlaceResponseSchema = z.object({
    id: z.string(),
    entity_type: z.enum(["place", "map_point"]),
    entity_id: z.string().nullable(),
    display_name: z.string().nullable(),
    custom_name: z.string().nullable(),
    category: z
        .object({
            code: z.string(),
            name: z.string(),
        })
        .nullable(),
    address_line: z.string().nullable(),
    plus_code: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    admin_area_id: z.string().nullable(),
    created_at: z.string(),
});

export const savedPlaceListResponseSchema = z.array(savedPlaceResponseSchema);
