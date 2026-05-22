import { z } from "zod";

export const reverseAddressQuerySchema = z.object({
    lat: z.coerce.number().finite().min(-90).max(90),
    lng: z.coerce.number().finite().min(-180).max(180),
    lang: z.enum(["en", "my"]).optional().default("en"),
});

export type ReverseAddressQuery = z.infer<typeof reverseAddressQuerySchema>;
