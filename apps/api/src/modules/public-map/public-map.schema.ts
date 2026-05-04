import { z } from "zod";

export const publicPlaceIdParamsSchema = z.object({
    id: z.string().uuid(),
});

export const publicPlacesQuerySchema = z.object({
    q: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    lang: z.enum(["my", "en", "both"]).default("my"),
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
