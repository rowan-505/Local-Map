import { z } from "zod";

export const adminAreasQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
});

export const adminAreaOptionsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(2000).default(500),
    q: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional(),
});
