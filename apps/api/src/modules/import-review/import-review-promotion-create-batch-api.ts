import type { FamilyEligibilityCountDb } from "./import-review-promotion-eligibility.js";
import { buildPromotionEligibilityResponse } from "./import-review-promotion-eligibility-api.js";
import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import { resolveCreateBatchFamiliesFromSimpleRegistry } from "./import-review-promotion-create-batch.js";
import { importReviewPromotionFamilyTarget } from "./import-review-promotion-family-meta.js";
import type {
    ImportReviewCreatePublishBatchDryRunResult,
    ImportReviewCreatePublishBatchResult,
    ImportReviewCreatePublishBatchTimingMs,
    ImportReviewPromotionCreateBatchFamilyResult,
    ImportReviewPublishBatchDetail,
} from "./import-review-promotion.types.js";

export type CreatePublishBatchDryRunPreview = {
    batchName: string;
    entityFamilies: string[];
    totals: { included: number; excluded: number; skipped: number };
    byFamily: Array<{
        entity_family: string;
        included: number;
        excluded: number;
        skipped: number;
        skipped_reasons: Array<{ reason: string; count: number }>;
    }>;
};

export function resolveCreateBatchFamilies(
    families: readonly string[] | undefined,
    legacyEntityFamilies: readonly string[] | undefined
): ImportReviewPublishFamilyConfig[] {
    const selected =
        families && families.length > 0
            ? families
            : legacyEntityFamilies && legacyEntityFamilies.length > 0
              ? legacyEntityFamilies
              : [];
    return resolveCreateBatchFamiliesFromSimpleRegistry(selected);
}

export function defaultCreateBatchName(
    reviewBatchId: bigint,
    familySlugs: readonly string[]
): string {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const familyTag = familySlugs.length === 1 ? familySlugs[0] : "multi";
    return `${familyTag}-publish-batch-${reviewBatchId.toString()}-${stamp}`;
}

export function buildCreateBatchDryRunResponse(args: {
    reviewBatchId: bigint;
    batchName: string;
    familyConfigs: ImportReviewPublishFamilyConfig[];
    preview: CreatePublishBatchDryRunPreview;
    countRows: FamilyEligibilityCountDb[];
    includeWarnings: boolean;
    timing_ms: ImportReviewCreatePublishBatchTimingMs;
    resolveMs: number;
}): ImportReviewCreatePublishBatchDryRunResult {
    const eligibility = buildPromotionEligibilityResponse({
        reviewBatchId: args.reviewBatchId,
        familyConfigs: args.familyConfigs,
        countRows: args.countRows,
        includeWarnings: args.includeWarnings,
    });

    const previewByFamily = new Map(args.preview.byFamily.map((row) => [row.entity_family, row]));

    const families = args.familyConfigs.map((cfg) => {
        const previewRow = previewByFamily.get(cfg.entityFamily);
        const eligibilityRow = eligibility.families.find((f) => f.family === cfg.entityFamily);
        return {
            family: cfg.entityFamily,
            label: eligibilityRow?.label ?? cfg.entityFamily,
            risk_level: eligibilityRow?.risk_level ?? "normal",
            target: importReviewPromotionFamilyTarget(cfg.entityFamily),
            ready: eligibilityRow?.ready ?? 0,
            warnings: eligibilityRow?.warnings ?? 0,
            blocked: eligibilityRow?.blocked ?? 0,
            batched: eligibilityRow?.batched ?? 0,
            promoted: eligibilityRow?.promoted ?? 0,
            included: previewRow?.included ?? 0,
            excluded: previewRow?.excluded ?? 0,
            skipped: previewRow?.skipped ?? 0,
            skipped_reasons: previewRow?.skipped_reasons ?? [],
        };
    });

    const can_create_batch = args.preview.totals.included > 0;
    const messages = [
        ...eligibility.messages,
        can_create_batch
            ? `${args.preview.totals.included.toLocaleString()} candidate(s) would be added to publish batch "${args.batchName}".`
            : "No eligible candidates would be included. Adjust families or set include_warnings=true.",
    ];

    const reviewBatchNumber = eligibility.review_batch_id;
    const by_entity = Object.fromEntries(
        args.preview.byFamily.map((row) => [row.entity_family, row.included])
    );

    return {
        dry_run: true,
        review_batch_id: reviewBatchNumber,
        batch_name: args.batchName,
        families,
        entity_families: args.preview.entityFamilies,
        totals: args.preview.totals,
        by_family: args.preview.byFamily,
        total_selected: args.preview.totals.included,
        by_entity,
        skipped: args.preview.totals.skipped,
        can_create_batch,
        has_high_risk: eligibility.has_high_risk,
        messages,
        timing_ms: args.timing_ms,
        stages: [
            {
                stage_key: "resolve_scope",
                stage_label: "Resolve scope",
                message: `Scope resolved for review_batch_id=${reviewBatchIdString(args.reviewBatchId)}.`,
                counts: {},
            },
            {
                stage_key: "count_eligible",
                stage_label: "Count eligible candidates",
                message: `${args.preview.totals.included} candidate(s) would be included.`,
                counts: args.preview.totals,
            },
        ],
        message: can_create_batch
            ? "Dry-run complete. No database rows were changed."
            : "Dry-run complete. No eligible candidates for the selected families.",
    };
}

function reviewBatchIdString(reviewBatchId: bigint): string {
    return reviewBatchId.toString();
}

export function publishBatchIdToNumber(batchId: bigint): number {
    const id = Number(batchId);
    if (!Number.isSafeInteger(id) || id < 1) {
        throw new Error(`Invalid system_publish_batches.id: ${batchId.toString()}`);
    }
    return id;
}

export function reviewBatchIdToNumber(reviewBatchId: bigint): number {
    const id = Number(reviewBatchId);
    if (!Number.isSafeInteger(id) || id < 1) {
        throw new Error(`Invalid review_batch_id: ${reviewBatchId.toString()}`);
    }
    return id;
}

/** Canonical POST /promotion/batches success body (201). Top-level `id` is always numeric. */
export function buildCreateBatchSuccessResponse(args: {
    batch: { id: bigint; batch_name: string; status: string };
    detail: ImportReviewPublishBatchDetail;
    reviewBatchId: bigint;
    mode: "selected" | "all_ready";
    families: string[];
    countByFamily: Record<string, number>;
    itemsAdded: number;
    totalSelected: number;
    candidatesMarked: number;
    byFamily: ImportReviewPromotionCreateBatchFamilyResult[];
    skipped: number;
    timing_ms: ImportReviewCreatePublishBatchTimingMs;
    buildingsMarked: number;
    message: string;
    warnings?: string[];
}): ImportReviewCreatePublishBatchResult {
    const id = publishBatchIdToNumber(args.batch.id);
    const batchId = id.toString();
    const review_batch_id = reviewBatchIdToNumber(args.reviewBatchId);
    const by_entity = Object.fromEntries(
        args.byFamily.map((f) => [f.entity_family, f.items_added])
    );
    const total_item_count = args.detail.total_item_count ?? args.itemsAdded;

    return {
        id,
        public_id: args.detail.public_id,
        review_batch_id,
        mode: args.mode,
        total_item_count,
        count_by_family: { ...args.countByFamily },
        message: args.message,
        batch: args.detail,
        batch_id: batchId,
        publish_batch_id: batchId,
        families: args.families,
        status: args.batch.status,
        total_items: args.itemsAdded,
        items_added: args.itemsAdded,
        total_selected: args.totalSelected,
        candidates_marked_batched: args.candidatesMarked,
        by_family: args.byFamily,
        by_entity,
        skipped: args.skipped,
        timing_ms: args.timing_ms,
        building_candidates_marked_batched: args.buildingsMarked,
        ...(args.warnings?.length ? { warnings: args.warnings } : {}),
    };
}
