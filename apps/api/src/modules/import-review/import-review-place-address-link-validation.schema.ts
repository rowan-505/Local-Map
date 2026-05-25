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

function coerceBigIntArray(value: unknown): bigint[] | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (Array.isArray(value)) {
        const out = value
            .map(coerceOptionalBigIntId)
            .filter((id): id is bigint => id !== undefined);
        return out.length > 0 ? out : undefined;
    }
    const single = coerceOptionalBigIntId(value);
    return single !== undefined ? [single] : undefined;
}

export const postImportReviewPlaceAddressLinkValidateBodySchema = z
    .object({
        review_batch_id: z.preprocess(coerceOptionalBigIntId, z.bigint().optional()),
        link_ids: z.preprocess(coerceBigIntArray, z.array(z.bigint()).optional()),
    })
    .superRefine((data, ctx) => {
        const hasBatch = data.review_batch_id !== undefined;
        const hasIds = !!(data.link_ids && data.link_ids.length > 0);
        if (hasBatch === hasIds) {
            ctx.addIssue({
                code: "custom",
                message: "Provide exactly one of review_batch_id or link_ids",
                path: hasBatch ? ["link_ids"] : ["review_batch_id"],
            });
        }
    });

export type PostImportReviewPlaceAddressLinkValidateBody = z.infer<
    typeof postImportReviewPlaceAddressLinkValidateBodySchema
>;
