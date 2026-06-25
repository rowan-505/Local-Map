import { z } from "zod";

export const publicPlaceIdParamsSchema = z.object({
    id: z.string().uuid(),
});

export const publicPlacesQuerySchema = z.object({
    q: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    categoryId: z
        .string()
        .trim()
        .regex(/^\d+$/)
        .transform((value) => BigInt(value))
        .optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const publicSearchQuerySchema = z.object({
    q: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const publicAdminAreaSearchQuerySchema = z.object({
    q: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const publicAdminAreaIdParamsSchema = z.object({
    id: z.string().trim().regex(/^\d+$/, "Admin area id must be a positive integer"),
});

export const publicMapPlacesQuerySchema = z.object({
    bbox: z
        .string()
        .trim()
        .transform((value, ctx) => {
            const parts = value.split(",").map((part) => Number(part.trim()));

            if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
                ctx.addIssue({
                    code: "custom",
                    message: 'bbox must be "minLng,minLat,maxLng,maxLat"',
                });
                return z.NEVER;
            }

            const [minLng, minLat, maxLng, maxLat] = parts;
            const valid =
                minLng >= -180 &&
                maxLng <= 180 &&
                minLat >= -90 &&
                maxLat <= 90 &&
                minLng < maxLng &&
                minLat < maxLat;

            if (!valid) {
                ctx.addIssue({
                    code: "custom",
                    message: "bbox coordinates are out of range or not ordered",
                });
                return z.NEVER;
            }

            return [minLng, minLat, maxLng, maxLat] as [number, number, number, number];
        }),
    zoom: z.coerce.number().min(0).max(24),
    category: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(300).default(100),
    offset: z.coerce.number().int().min(0).default(0),
});
