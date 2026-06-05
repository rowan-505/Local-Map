import { parsePublishBatchDryRunResultFromSummary } from "./import-review-publish-batch-dry-run.js";
import { normalizePublishBatchLifecycleStatus } from "./import-review-publish-batch-lifecycle.js";
import { normalizeStageStatus } from "./import-review-promotion-stage-status.js";
import type {
    ImportReviewPublishBatchEntityValidationCounts,
    ImportReviewPublishBatchLogsResponse,
    ImportReviewPublishBatchProgressResponse,
    ImportReviewPublishBatchPromotionResultSummary,
    ImportReviewPublishBatchValidationResultSummary,
    ImportReviewPublishItemStatusCounts,
    ImportReviewPublishStageLogItem,
} from "./import-review-promotion.types.js";
import type { RoadPromotionGatesResult } from "./import-review-road-promotion-gates.js";

function clampInt(value: unknown, fallback = 0): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.max(0, Math.floor(n));
}

function clampPercent(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return 0;
    }
    return Math.min(100, Math.max(0, n));
}

export function normalizeIsoDateTime(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString();
}

function normalizeEntityCounts(
    raw: ImportReviewPublishBatchEntityValidationCounts
): ImportReviewPublishBatchEntityValidationCounts {
    const ready = clampInt(raw.ready ?? raw.valid);
    return {
        total: clampInt(raw.total),
        ready,
        valid: ready,
        warning: clampInt(raw.warning),
        blocked: clampInt(raw.blocked),
        skipped: clampInt(raw.skipped),
    };
}

export function normalizeValidationResultForResponse(
    value: ImportReviewPublishBatchValidationResultSummary | null
): ImportReviewPublishBatchValidationResultSummary | null {
    if (!value) {
        return null;
    }

    const byEntity: Record<string, ImportReviewPublishBatchEntityValidationCounts> = {};
    for (const [key, counts] of Object.entries(value.by_entity ?? {})) {
        byEntity[key] = normalizeEntityCounts(counts);
    }

    const outcome =
        value.outcome === "blocked" || value.outcome === "partial" ? value.outcome : "passed";

    return {
        outcome,
        can_promote: value.can_promote === true,
        requires_warning_confirmation: value.requires_warning_confirmation === true,
        ready_count: clampInt(value.ready_count ?? value.valid_count),
        valid_count: clampInt(value.valid_count ?? value.ready_count),
        warning_count: clampInt(value.warning_count),
        blocked_count: clampInt(value.blocked_count),
        skipped_count: clampInt(value.skipped_count),
        promotable_count: clampInt(value.promotable_count),
        total_count: clampInt(value.total_count ?? value.total_items),
        total_items: clampInt(value.total_items ?? value.total_count),
        by_publish_action: {
            insert: clampInt(value.by_publish_action?.insert),
            update: clampInt(value.by_publish_action?.update),
            merge: clampInt(value.by_publish_action?.merge),
        },
        by_entity: byEntity,
        entity_family: {
            buildings: clampInt(value.entity_family?.buildings),
        },
        promotable_entity_families: Array.isArray(value.promotable_entity_families)
            ? value.promotable_entity_families.filter((f) => typeof f === "string")
            : [],
    };
}

export function normalizePromotionResultForResponse(
    value: ImportReviewPublishBatchPromotionResultSummary | null
): ImportReviewPublishBatchPromotionResultSummary | null {
    if (!value) {
        return null;
    }

    const startedAt = normalizeIsoDateTime(value.started_at);
    const finishedAt = normalizeIsoDateTime(value.finished_at);
    if (!startedAt || !finishedAt) {
        return null;
    }

    const status =
        value.status === "promoted" || value.status === "partial" || value.status === "partially_promoted"
            ? value.status === "partially_promoted"
                ? "partial"
                : value.status
            : "failed";

    return {
        status,
        promoted_count: clampInt(value.promoted_count ?? value.success_count),
        inserted_count: clampInt(value.inserted_count),
        updated_count: clampInt(value.updated_count),
        success_count: clampInt(value.success_count),
        failed_count: clampInt(value.failed_count),
        skipped_count: clampInt(value.skipped_count),
        total: clampInt(value.total),
        core_verified_count: clampInt(value.core_verified_count),
        import_review_marked_promoted_count: clampInt(value.import_review_marked_promoted_count),
        verification_metadata_applied_count: clampInt(value.verification_metadata_applied_count),
        verification_metadata_skipped_already_verified_count: clampInt(
            value.verification_metadata_skipped_already_verified_count
        ),
        partial_success: value.partial_success === true ? true : undefined,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: clampInt(value.duration_ms),
        promoted_entity_families: Array.isArray(value.promoted_entity_families)
            ? value.promoted_entity_families.filter((f) => typeof f === "string")
            : [],
        ...(value.sample_failures?.length ? { sample_failures: value.sample_failures } : {}),
    };
}

export function normalizeRoadPromotionGatesForResponse(
    value: RoadPromotionGatesResult | null
): RoadPromotionGatesResult | null {
    if (!value) {
        return null;
    }

    return {
        applies: value.applies === true,
        can_promote: value.can_promote === true,
        road_item_count: clampInt(value.road_item_count),
        roads_ready_count: clampInt(value.roads_ready_count),
        recommend_sql_bulk_promotion: value.recommend_sql_bulk_promotion === true,
        api_bulk_promotion_allowed: value.api_bulk_promotion_allowed === true,
        sql_bulk_promotion_ready_threshold: clampInt(value.sql_bulk_promotion_ready_threshold, 50),
        sql_bulk_promote_script:
            typeof value.sql_bulk_promote_script === "string"
                ? value.sql_bulk_promote_script
                : "tools/data-pipeline/import-review-bulk/roads_bulk_promote_new_auto.sql",
        sql_bulk_validate_script:
            typeof value.sql_bulk_validate_script === "string"
                ? value.sql_bulk_validate_script
                : "tools/data-pipeline/import-review-bulk/roads_bulk_validate.sql",
        env_enabled: value.env_enabled === true,
        gates: Array.isArray(value.gates)
            ? value.gates.map((gate) => ({
                  id: gate.id,
                  label: typeof gate.label === "string" ? gate.label : gate.id,
                  satisfied: gate.satisfied === true,
                  detail: typeof gate.detail === "string" ? gate.detail : "",
                  ...(typeof gate.helper === "string" ? { helper: gate.helper } : {}),
              }))
            : [],
        primary_blocker: value.primary_blocker ?? null,
        primary_blocker_message:
            typeof value.primary_blocker_message === "string" ? value.primary_blocker_message : null,
    };
}

export function normalizePublishItemStatusCountsForResponse(
    value: ImportReviewPublishItemStatusCounts
): ImportReviewPublishItemStatusCounts {
    const pending = clampInt(value.pending);
    const success = clampInt(value.success);
    const failed = clampInt(value.failed);
    const skipped = clampInt(value.skipped);
    const total = clampInt(value.total, pending + success + failed + skipped);
    return { pending, success, failed, skipped, total };
}

export function normalizePublishStageLogItemForResponse(
    row: ImportReviewPublishStageLogItem
): ImportReviewPublishStageLogItem {
    const startedAt = normalizeIsoDateTime(row.started_at) ?? new Date(0).toISOString();
    const finishedAt = row.finished_at ? normalizeIsoDateTime(row.finished_at) : null;
    const stageStatus = normalizeStageStatus(row.stage_status) ?? "skipped";

    return {
        id: String(row.id),
        stage_key: typeof row.stage_key === "string" ? row.stage_key : "unknown",
        stage_label: typeof row.stage_label === "string" ? row.stage_label : "Unknown stage",
        stage_status: stageStatus,
        message: typeof row.message === "string" ? row.message : null,
        progress_percent: clampPercent(row.progress_percent),
        details: row.details ?? null,
        started_at: startedAt,
        finished_at: finishedAt,
    };
}

export function serializePublishBatchProgressResponse(
    response: ImportReviewPublishBatchProgressResponse
): ImportReviewPublishBatchProgressResponse {
    const workflow =
        response.workflow === "validation" ||
        response.workflow === "promotion" ||
        response.workflow === "idle"
            ? response.workflow
            : "idle";

    const promotionStatus =
        response.promotion_status === "not_started" ||
        response.promotion_status === "promoting" ||
        response.promotion_status === "promoted" ||
        response.promotion_status === "partially_promoted" ||
        response.promotion_status === "partial" ||
        response.promotion_status === "promotion_failed"
            ? response.promotion_status
            : null;

    return {
        batch_id: String(response.batch_id),
        status: normalizePublishBatchLifecycleStatus(
            typeof response.status === "string" ? response.status : "draft"
        ),
        derived_status: normalizePublishBatchLifecycleStatus(
            typeof response.derived_status === "string"
                ? response.derived_status
                : typeof response.status === "string"
                  ? response.status
                  : "draft"
        ),
        derived_status_reason:
            typeof response.derived_status_reason === "string"
                ? response.derived_status_reason
                : null,
        stored_status_recommendation:
            typeof response.stored_status_recommendation === "string"
                ? response.stored_status_recommendation
                : null,
        status_note: typeof response.status_note === "string" ? response.status_note : null,
        workflow,
        validation_total: clampInt(response.validation_total),
        validation_done: clampInt(response.validation_done),
        validation_percent: clampPercent(response.validation_percent),
        total_item_count: clampInt(response.total_item_count),
        item_processed_count: clampInt(response.item_processed_count),
        stage_count: clampInt(response.stage_count),
        validated_at: normalizeIsoDateTime(response.validated_at),
        current_stage_key:
            typeof response.current_stage_key === "string" ? response.current_stage_key : null,
        current_stage_label:
            typeof response.current_stage_label === "string" ? response.current_stage_label : null,
        current_stage_status:
            typeof response.current_stage_status === "string" ? response.current_stage_status : null,
        current_entity_family:
            typeof response.current_entity_family === "string"
                ? response.current_entity_family
                : null,
        current_message:
            typeof response.current_message === "string" ? response.current_message : null,
        validation_result: normalizeValidationResultForResponse(response.validation_result),
        validation_logs_summary:
            typeof response.validation_logs_summary === "string"
                ? response.validation_logs_summary
                : null,
        promotion_result: normalizePromotionResultForResponse(response.promotion_result),
        promotion_logs_summary:
            typeof response.promotion_logs_summary === "string"
                ? response.promotion_logs_summary
                : null,
        validation_heartbeat_at: normalizeIsoDateTime(response.validation_heartbeat_at),
        validation_cancel_requested_at: normalizeIsoDateTime(
            response.validation_cancel_requested_at
        ),
        validation_heartbeat_stale_warning: response.validation_heartbeat_stale_warning === true,
        promotion_heartbeat_at: normalizeIsoDateTime(response.promotion_heartbeat_at),
        promotion_heartbeat_stale_warning: response.promotion_heartbeat_stale_warning === true,
        promotion_worker_in_process: response.promotion_worker_in_process === true,
        current_promotable_count: clampInt(response.current_promotable_count),
        validation_promotable_count:
            response.validation_promotable_count == null
                ? null
                : clampInt(response.validation_promotable_count),
        publish_item_status_counts: normalizePublishItemStatusCountsForResponse(
            response.publish_item_status_counts
        ),
        promotion_status: promotionStatus,
        failed_ready_retry_count: clampInt(response.failed_ready_retry_count),
        road_promotion_gates: normalizeRoadPromotionGatesForResponse(response.road_promotion_gates),
        dry_run_result: response.dry_run_result ?? null,
        current_stage:
            typeof response.current_stage === "string" ? response.current_stage : null,
        percent: clampPercent(response.percent ?? response.validation_percent),
        processed_count: clampInt(response.processed_count ?? response.item_processed_count),
        total: clampInt(response.total ?? response.total_item_count),
        last_heartbeat_at:
            normalizeIsoDateTime(response.last_heartbeat_at) ??
            normalizeIsoDateTime(response.validation_heartbeat_at) ??
            normalizeIsoDateTime(response.promotion_heartbeat_at),
        resumable_actions: Array.isArray(response.resumable_actions)
            ? response.resumable_actions.filter((a): a is string => typeof a === "string")
            : [],
    };
}

export function serializePublishBatchLogsResponse(
    response: ImportReviewPublishBatchLogsResponse
): ImportReviewPublishBatchLogsResponse {
    return {
        batch_id: String(response.batch_id),
        items: response.items.map(normalizePublishStageLogItemForResponse),
    };
}

/** Safe progress payload when the DB pool is saturated (e.g. connection_limit=1 during validation). */
export function buildMinimalPublishBatchProgressResponse(args: {
    batchId: string;
    status: string;
    validationPercent?: number;
    validationTotal?: number;
    validationDone?: number;
    summary?: unknown;
    message: string;
}): ImportReviewPublishBatchProgressResponse {
    const dry_run_result = parsePublishBatchDryRunResultFromSummary(args.summary);
    const validationTotal = clampInt(args.validationTotal);
    const validationDone = clampInt(args.validationDone);
    return serializePublishBatchProgressResponse({
        batch_id: args.batchId,
        status: args.status,
        derived_status: args.status,
        derived_status_reason: args.message,
        stored_status_recommendation: null,
        status_note: args.message,
        workflow: args.status === "validating" ? "validation" : args.status === "promoting" ? "promotion" : "idle",
        validation_total: validationTotal,
        validation_done: validationDone,
        validation_percent: clampPercent(args.validationPercent),
        total_item_count: validationTotal,
        item_processed_count: validationDone,
        stage_count: 0,
        validated_at: null,
        current_stage_key: null,
        current_stage_label: null,
        current_stage_status: null,
        current_entity_family: null,
        current_message: args.message,
        validation_result: null,
        validation_logs_summary: null,
        promotion_result: null,
        promotion_logs_summary: null,
        validation_heartbeat_at: null,
        validation_cancel_requested_at: null,
        validation_heartbeat_stale_warning: args.status === "validating",
        promotion_heartbeat_at: null,
        promotion_heartbeat_stale_warning: args.status === "promoting",
        promotion_worker_in_process: false,
        current_promotable_count: 0,
        validation_promotable_count: null,
        publish_item_status_counts: {
            pending: 0,
            success: 0,
            failed: 0,
            skipped: 0,
            total: validationTotal,
        },
        promotion_status: null,
        failed_ready_retry_count: 0,
        road_promotion_gates: null,
        dry_run_result,
        current_stage: args.status === "validating" ? "validate_items" : args.status === "promoting" ? "promote_items" : null,
        percent: clampPercent(args.validationPercent),
        processed_count: validationDone,
        total: validationTotal,
        last_heartbeat_at: null,
        resumable_actions:
            args.status === "validating"
                ? ["resume_validation", "cancel_validation"]
                : args.status === "promoting"
                  ? ["resume_promotion", "cancel_promotion"]
                  : [],
    });
}
