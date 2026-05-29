import type { ImportTransportFamily } from "./import-transport.config.js";

export const IMPORT_TRANSPORT_PROMOTION_MODES = ["one_entity", "all_entities"] as const;

export type ImportTransportPromotionMode = (typeof IMPORT_TRANSPORT_PROMOTION_MODES)[number];

export type ImportTransportPromotionReadyFamilyCounts = {
    entity_family: ImportTransportFamily;
    ready: number;
    with_warnings: number;
    blocked: number;
    already_promoted: number;
    already_batched: number;
};

export type ImportTransportPromotionReadyResponse = {
    import_batch_id: string;
    include_warnings: boolean;
    by_family: ImportTransportPromotionReadyFamilyCounts[];
    totals: {
        ready: number;
        with_warnings: number;
        blocked: number;
        already_promoted: number;
        already_batched: number;
    };
};

export type ImportTransportPromotionBatchListItem = {
    id: string;
    public_id: string;
    import_batch_id: string;
    batch_name: string;
    target_schema: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: string | null;
    item_counts: Record<string, unknown>;
    summary: Record<string, unknown>;
    error_message: string | null;
    created_at: string;
    updated_at: string;
};

export type ImportTransportPromotionBatchesListResponse = {
    items: ImportTransportPromotionBatchListItem[];
    total: number;
    limit: number;
    offset: number;
};

export type ImportTransportPromotionBatchDetailResponse = ImportTransportPromotionBatchListItem & {
    items: Array<{
        id: string;
        entity_kind: string;
        raw_entity_id: string;
        promotion_status: string;
        match_status: string;
        item_validation_status: string;
        promoted_target_id: string | null;
        error_message: string | null;
        created_at: string;
        updated_at: string;
    }>;
};

export type ImportTransportCreatePromotionBatchResponse = {
    batch: ImportTransportPromotionBatchListItem;
    items_added: number;
    candidates_marked_batched: number;
    by_family: Array<{
        entity_family: ImportTransportFamily;
        items_added: number;
        marked_batched: number;
    }>;
    message: string;
};

export const IMPORT_TRANSPORT_PROMOTION_ACTIVE_BATCH_STATUSES = [
    "draft",
    "not_ready",
    "ready",
    "validating",
    "promoting",
] as const;
