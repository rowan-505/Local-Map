import { z } from "zod";

function coerceOptionalBigIntId(value: unknown): bigint | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === "string") {
        const t = value.trim();
        if (t === "") {
            return undefined;
        }
        return BigInt(t);
    }
    return undefined;
}

const componentUpsertSchema = z.object({
    id: z.preprocess(coerceOptionalBigIntId, z.bigint().optional()),
    component_type_code: z.string().min(1),
    component_value: z.string(),
    language_code: z.enum(["en", "my", "und"]),
    confidence_score: z.coerce.number().min(0).max(100).nullable().optional(),
    match_type: z.string().nullable().optional(),
    is_reviewed: z.boolean().optional(),
});

export const patchImportReviewAddressComponentsBodySchema = z.object({
    upsert: z.array(componentUpsertSchema).default([]),
    delete_ids: z
        .preprocess((value): bigint[] | undefined => {
            if (value === undefined || value === null) {
                return undefined;
            }
            if (!Array.isArray(value)) {
                return undefined;
            }
            const out: bigint[] = [];
            for (const item of value) {
                const id = coerceOptionalBigIntId(item);
                if (id !== undefined) {
                    out.push(id);
                }
            }
            return out;
        }, z.array(z.bigint()).optional())
        .optional(),
});

export type PatchImportReviewAddressComponentsBody = z.infer<
    typeof patchImportReviewAddressComponentsBodySchema
>;
