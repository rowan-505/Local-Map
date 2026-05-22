import { z } from "zod";

function coerceOptionalBigIntId(value: unknown): bigint | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        return null;
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
            return null;
        }
        return BigInt(t);
    }
    return undefined;
}

function coerceRequiredBigIntParam(value: unknown): bigint {
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

export const importReviewAddressCandidateIdParamsSchema = z.object({
    id: z.preprocess(coerceRequiredBigIntParam, z.bigint()),
});

export const patchImportReviewAddressMatchesBodySchema = z.object({
    matched_street_id: z.preprocess(coerceOptionalBigIntId, z.bigint().nullable().optional()),
    matched_admin_area_id: z.preprocess(coerceOptionalBigIntId, z.bigint().nullable().optional()),
    matched_building_id: z.preprocess(coerceOptionalBigIntId, z.bigint().nullable().optional()),
    matched_place_id: z.preprocess(coerceOptionalBigIntId, z.bigint().nullable().optional()),
    street_match_confidence: z.coerce.number().min(0).max(100).optional(),
    replace_reviewed_street_components: z.boolean().optional(),
});

export type PatchImportReviewAddressMatchesBody = z.infer<
    typeof patchImportReviewAddressMatchesBodySchema
>;
