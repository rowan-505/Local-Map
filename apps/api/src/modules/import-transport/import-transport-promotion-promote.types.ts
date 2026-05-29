import type { ImportTransportFamily } from "./import-transport.config.js";

export const IMPORT_TRANSPORT_PROMOTION_EXECUTION_STAGES = [
    { key: "promote_routes", label: "Promote routes", entity_kind: "route", family: "routes" as ImportTransportFamily },
    { key: "promote_stops", label: "Promote stops", entity_kind: "stop", family: "stops" as ImportTransportFamily },
    {
        key: "promote_variants",
        label: "Promote variants",
        entity_kind: "route_variant",
        family: "variants" as ImportTransportFamily,
    },
    {
        key: "promote_route_stops",
        label: "Promote route stops",
        entity_kind: "route_stop",
        family: "route_stops" as ImportTransportFamily,
    },
] as const;

export type ImportTransportPromotionExecutionStageKey =
    (typeof IMPORT_TRANSPORT_PROMOTION_EXECUTION_STAGES)[number]["key"];

export type ImportTransportPromoteItemOutcome = "promoted" | "skipped" | "failed";

export type ImportTransportPromoteItemResult = {
    promotion_item_id: string;
    entity_kind: string;
    raw_entity_id: string;
    outcome: ImportTransportPromoteItemOutcome;
    promoted_target_id: string | null;
    error_message: string | null;
};

export type ImportTransportPromotionBatchPromoteResponse = {
    batch_id: string;
    promotion_status: string;
    message: string;
    promoted: number;
    failed: number;
    skipped: number;
    items: ImportTransportPromoteItemResult[];
    summary: Record<string, unknown>;
};

export type PostImportTransportPromotionBatchPromoteBody = {
    confirm_warnings?: boolean;
    review_note?: string | null;
};
