import { z } from "zod";

function coerceRequiredBigIntId(value: unknown): bigint {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === "string") {
        const t = value.trim();
        if (t === "") {
            throw new Error("Invalid id");
        }
        return BigInt(t);
    }
    throw new Error("Invalid id");
}

export const postImportReviewAddressAdminInferenceBodySchema = z.object({
    review_batch_id: z.preprocess(coerceRequiredBigIntId, z.bigint()),
    nearest_village_meters: z.coerce.number().positive().max(50_000).optional(),
});

export type PostImportReviewAddressAdminInferenceBody = z.infer<
    typeof postImportReviewAddressAdminInferenceBodySchema
>;
