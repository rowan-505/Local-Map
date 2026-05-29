import type { ImportTransportFamily } from "./import-transport.config.js";

export const IMPORT_TRANSPORT_PROMOTION_VALIDATION_STAGES = [
    { key: "routes", label: "Routes", entity_kind: "route", family: "routes" as ImportTransportFamily },
    { key: "stops", label: "Stops", entity_kind: "stop", family: "stops" as ImportTransportFamily },
    {
        key: "variants",
        label: "Variants",
        entity_kind: "route_variant",
        family: "variants" as ImportTransportFamily,
    },
    {
        key: "route_stops",
        label: "Route stops",
        entity_kind: "route_stop",
        family: "route_stops" as ImportTransportFamily,
    },
] as const;

export type ImportTransportPromotionValidationStageKey =
    (typeof IMPORT_TRANSPORT_PROMOTION_VALIDATION_STAGES)[number]["key"];

export type ImportTransportPromotionItemValidationStatus =
    | "pending"
    | "valid"
    | "warning"
    | "blocked"
    | "skipped";

export type ImportTransportPromotionStageLogRow = {
    id: string;
    promotion_batch_id: string;
    stage_key: string;
    stage_label: string;
    stage_status: string;
    message: string | null;
    progress_percent: number;
    details: Record<string, unknown>;
    started_at: string;
    finished_at: string | null;
};

export type ImportTransportPromotionBatchProgressRow = {
    id: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: string | null;
    summary: Record<string, unknown>;
};

export type ImportTransportPromotionEntityValidationSummary = {
    entity_family: ImportTransportFamily;
    pending: number;
    valid: number;
    warning: number;
    blocked: number;
    skipped: number;
};

export type ImportTransportPromotionBatchProgressResponse = {
    batch_id: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: string | null;
    by_entity: ImportTransportPromotionEntityValidationSummary[];
    stages: ImportTransportPromotionStageLogRow[];
};

export type ImportTransportPromotionBatchValidationResult = ImportTransportPromotionBatchProgressResponse & {
    message: string;
};

export type ImportTransportPromotionBatchLogsResponse = {
    batch_id: string;
    items: ImportTransportPromotionStageLogRow[];
};

export const IMPORT_TRANSPORT_ENTITY_KIND_TO_FAMILY: Record<string, ImportTransportFamily> = {
    route: "routes",
    stop: "stops",
    route_variant: "variants",
    route_stop: "route_stops",
};

export function familyForEntityKind(entityKind: string): ImportTransportFamily | null {
    return IMPORT_TRANSPORT_ENTITY_KIND_TO_FAMILY[entityKind] ?? null;
}

export function stagesForBatchMode(summary: Record<string, unknown>): ImportTransportFamily[] {
    const mode = String(summary.mode ?? "all_entities");
    if (mode === "one_entity") {
        const family = summary.entity_family;
        if (typeof family === "string" && family.trim()) {
            return [family.trim() as ImportTransportFamily];
        }
    }
    return ["routes", "stops", "variants", "route_stops"];
}
