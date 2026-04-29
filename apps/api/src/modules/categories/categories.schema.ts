import { z } from "zod";

export const categoriesQuerySchema = z.object({
    parentId: z.coerce.bigint().optional(),
    includePrivate: z.coerce.boolean().optional(),
});
