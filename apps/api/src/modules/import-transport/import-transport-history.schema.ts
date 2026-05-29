import { z } from "zod";

import { IMPORT_TRANSPORT_FAMILIES } from "./import-transport.config.js";

export const importTransportHistoryImportBatchesListQuerySchema = z.object({
    import_status: z.string().trim().min(1).optional(),
    validation_status: z.string().trim().min(1).optional(),
    source_dataset_code: z.string().trim().min(1).optional(),
    source_snapshot_version: z.string().trim().min(1).optional(),
    imported_after: z.string().datetime().optional(),
    imported_before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ImportTransportHistoryImportBatchesListQuery = z.infer<
    typeof importTransportHistoryImportBatchesListQuerySchema
>;

export const importTransportHistoryPromotionBatchesListQuerySchema = z.object({
    import_batch_id: z.coerce.number().int().positive().optional(),
    promotion_status: z.string().trim().min(1).optional(),
    validation_status: z.string().trim().min(1).optional(),
    mode: z.enum(["one_entity", "all_entities"]).optional(),
    entity_family: z.enum(IMPORT_TRANSPORT_FAMILIES).optional(),
    created_after: z.string().datetime().optional(),
    created_before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ImportTransportHistoryPromotionBatchesListQuery = z.infer<
    typeof importTransportHistoryPromotionBatchesListQuerySchema
>;

export const importTransportHistoryBatchIdParamsSchema = z.object({
    id: z.string().regex(/^\d+$/),
});

export const importTransportHistoryPromotionBatchItemsQuerySchema = z.object({
    entity_kind: z.string().trim().min(1).optional(),
    promotion_status: z.string().trim().min(1).optional(),
    item_validation_status: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ImportTransportHistoryPromotionBatchItemsQuery = z.infer<
    typeof importTransportHistoryPromotionBatchItemsQuerySchema
>;
