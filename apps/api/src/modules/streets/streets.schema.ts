import { z } from "zod";

export const streetsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const streetIdParamsSchema = z.object({
    id: z.string().uuid(),
});

const nullableBigintBodySchema = z.preprocess((value) => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }

    if (typeof value === "string" && value.trim() !== "") {
        return BigInt(value);
    }

    return value;
}, z.bigint().nullable().optional());

export const updateStreetBodySchema = z
    .object({
        canonical_name: z.string().trim().min(1).optional(),
        admin_area_id: nullableBigintBodySchema,
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "At least one editable field is required",
    });
