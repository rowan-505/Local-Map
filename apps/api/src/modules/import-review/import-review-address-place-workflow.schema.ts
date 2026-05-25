import { z } from "zod";

function coerceOptionalBigIntId(value: unknown): unknown {
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
        if (/^\d+$/.test(t)) {
            return BigInt(t);
        }
        return value;
    }
    return undefined;
}

export const patchImportReviewAddressPlaceStatusBodySchema = z
    .object({
        place_candidate_status: z.literal("ignored").optional(),
        matched_core_place_id: z.preprocess(coerceOptionalBigIntId, z.bigint().nullable().optional()),
        clear_linked_place_candidate: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
        if (
            data.place_candidate_status === undefined &&
            data.matched_core_place_id === undefined &&
            data.clear_linked_place_candidate !== true
        ) {
            ctx.addIssue({
                code: "custom",
                message:
                    "Provide place_candidate_status, matched_core_place_id, or clear_linked_place_candidate.",
                path: [],
            });
        }
    });

export type PatchImportReviewAddressPlaceStatusBody = z.infer<
    typeof patchImportReviewAddressPlaceStatusBodySchema
>;
