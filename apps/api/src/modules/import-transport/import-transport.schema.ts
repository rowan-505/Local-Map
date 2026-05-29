import { z } from "zod";

import {
    IMPORT_TRANSPORT_FAMILIES,
    IMPORT_TRANSPORT_SORT_OPTIONS,
} from "./import-transport.config.js";

const numericIdString = z.string().regex(/^\d+$/);

/** Database bigint IDs from query strings or JSON bodies (accepts `"2"` or `2`). */
export const importTransportDbIdSchema = z.coerce.number().int().positive();

export const importTransportScopeQuerySchema = z
    .object({
        import_batch_id: importTransportDbIdSchema.optional(),
        source_snapshot_version: z.string().trim().min(1).optional(),
        latest: z
            .union([z.literal("true"), z.literal("false"), z.boolean()])
            .optional()
            .transform((v) => v === true || v === "true"),
    })
    .superRefine((value, ctx) => {
        const hasBatch = Boolean(value.import_batch_id);
        const hasSnapshot = Boolean(value.source_snapshot_version?.trim());
        if (hasBatch === hasSnapshot) {
            ctx.addIssue({
                code: "custom",
                message: "Provide exactly one of import_batch_id or source_snapshot_version",
            });
        }
    });

export type ImportTransportScopeQueryInput = z.infer<typeof importTransportScopeQuerySchema>;

export const importTransportBatchesListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
    import_status: z.string().trim().min(1).optional(),
    validation_status: z.string().trim().min(1).optional(),
    source_snapshot_version: z.string().trim().min(1).optional(),
});

export type ImportTransportBatchesListQueryInput = z.infer<typeof importTransportBatchesListQuerySchema>;

export const importTransportFamilyParamSchema = z.enum(IMPORT_TRANSPORT_FAMILIES);

export const importTransportFamilyCandidateParamsSchema = z.object({
    family: importTransportFamilyParamSchema,
    id: numericIdString,
});

export const importTransportCandidatesListQuerySchema = importTransportScopeQuerySchema.and(
    z.object({
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        offset: z.coerce.number().int().min(0).optional().default(0),
        sort: z.enum(IMPORT_TRANSPORT_SORT_OPTIONS).optional().default("updated_at_desc"),
        review_status: z.string().trim().min(1).optional(),
        review_decision: z.string().trim().min(1).optional(),
        promotion_status: z.string().trim().min(1).optional(),
        validation_status: z.string().trim().min(1).optional(),
        mode_type: z.string().trim().min(1).optional(),
        q: z.string().trim().min(1).optional(),
        include_total: z
            .union([z.literal("true"), z.literal("false"), z.boolean()])
            .optional()
            .transform((v) => v === true || v === "true"),
        include_geometry: z
            .union([z.literal("true"), z.literal("false"), z.boolean()])
            .optional()
            .transform((v) => v === true || v === "true"),
        include_promoted: z
            .union([z.literal("true"), z.literal("false"), z.boolean()])
            .optional()
            .transform((v) => v === true || v === "true")
            .default(false),
    })
);

export type ImportTransportCandidatesListQueryInput = z.infer<typeof importTransportCandidatesListQuerySchema>;

export const importTransportCandidateDetailQuerySchema = importTransportScopeQuerySchema.and(
    z.object({
        include_geometry: z
            .union([z.literal("true"), z.literal("false"), z.boolean()])
            .optional()
            .transform((v) => v === true || v === "true"),
    })
);

export type ImportTransportCandidateDetailQueryInput = z.infer<
    typeof importTransportCandidateDetailQuerySchema
>;

export const importTransportValidateCandidateBodySchema = z.object({
    confirm_warnings: z.boolean().optional().default(false),
    review_note: z.string().trim().min(1).optional(),
});

export type ImportTransportValidateCandidateBodyInput = z.infer<
    typeof importTransportValidateCandidateBodySchema
>;

export const importTransportValidateCandidateQuerySchema = importTransportScopeQuerySchema;

export const importTransportBatchValidationBodySchema = importTransportScopeQuerySchema.and(
    z.object({
        families: z.array(importTransportFamilyParamSchema).optional(),
        confirm_warnings: z.boolean().optional().default(false),
        review_note: z.string().trim().min(1).optional(),
    })
);

export type ImportTransportBatchValidationBodyInput = z.infer<
    typeof importTransportBatchValidationBodySchema
>;

export const importTransportValidationIssuesQuerySchema = importTransportScopeQuerySchema.and(
    z.object({
        entity_kind: z.string().trim().min(1).optional(),
        entity_id: importTransportDbIdSchema.optional(),
        severity: z.string().trim().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional().default(100),
        offset: z.coerce.number().int().min(0).optional().default(0),
    })
);

export type ImportTransportValidationIssuesQueryInput = z.infer<
    typeof importTransportValidationIssuesQuerySchema
>;

export const importTransportPromotionModeSchema = z.enum(["one_entity", "all_entities"]);

export const postImportTransportPromotionBatchBodySchema = z
    .object({
        import_batch_id: importTransportDbIdSchema,
        mode: importTransportPromotionModeSchema,
        entity_family: importTransportFamilyParamSchema.nullable().optional(),
        include_warnings: z.boolean().optional().default(false),
    })
    .superRefine((value, ctx) => {
        if (value.mode === "one_entity" && !value.entity_family) {
            ctx.addIssue({
                code: "custom",
                message: "entity_family is required when mode is one_entity",
                path: ["entity_family"],
            });
        }
    });

export type PostImportTransportPromotionBatchBodyInput = z.infer<
    typeof postImportTransportPromotionBatchBodySchema
>;

export const importTransportPromotionReadyQuerySchema = z.object({
    import_batch_id: importTransportDbIdSchema,
    include_warnings: z
        .union([z.literal("true"), z.literal("false"), z.boolean()])
        .optional()
        .transform((v) => v === true || v === "true"),
});

export type ImportTransportPromotionReadyQueryInput = z.infer<
    typeof importTransportPromotionReadyQuerySchema
>;

export const importTransportPromotionBatchesListQuerySchema = z.object({
    import_batch_id: importTransportDbIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ImportTransportPromotionBatchesListQueryInput = z.infer<
    typeof importTransportPromotionBatchesListQuerySchema
>;

export const importTransportPromotionBatchIdParamsSchema = z.object({
    id: z.string().regex(/^\d+$/),
});

export const postImportTransportPromotionBatchPromoteBodySchema = z.object({
    confirm_warnings: z.boolean().optional().default(false),
    review_note: z.string().nullable().optional(),
});

export type PostImportTransportPromotionBatchPromoteBodyInput = z.infer<
    typeof postImportTransportPromotionBatchPromoteBodySchema
>;

export function parseImportTransportScopeQuery(
    input: ImportTransportScopeQueryInput
): { import_batch_id?: bigint; source_snapshot_version?: string; latest?: boolean } {
    return {
        import_batch_id:
            input.import_batch_id !== undefined ? BigInt(input.import_batch_id) : undefined,
        source_snapshot_version: input.source_snapshot_version,
        latest: input.latest,
    };
}
