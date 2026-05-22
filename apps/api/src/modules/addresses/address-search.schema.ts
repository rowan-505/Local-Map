import { z } from "zod";

export const addressSearchQuerySchema = z.object({
    q: z.string().trim().min(1).max(200),
    lang: z.enum(["en", "my"]).optional().default("en"),
    limit: z.coerce.number().int().min(1).max(50).optional().default(10),
    admin_area_id: z.string().trim().optional(),
});

export type AddressSearchQuery = z.infer<typeof addressSearchQuerySchema>;
