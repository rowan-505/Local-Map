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
    /** When `township`, only township-level areas (for place/road/building manual override). */
    admin_level_code: z.enum(["township"]).optional(),
});
