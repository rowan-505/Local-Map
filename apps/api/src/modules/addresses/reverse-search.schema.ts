import { z } from "zod";

export const reverseSearchQuerySchema = z.object({
    lat: z.coerce.number().finite().min(-90).max(90),
    lng: z.coerce.number().finite().min(-180).max(180),
});

export type ReverseSearchQuery = z.infer<typeof reverseSearchQuerySchema>;
