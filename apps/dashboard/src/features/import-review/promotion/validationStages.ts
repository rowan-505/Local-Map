/** Mirrors API IMPORT_REVIEW_SIMPLE_PUBLISH_VALIDATION_STAGES (simple validation runner). */
export const IMPORT_REVIEW_SIMPLE_VALIDATION_STAGE_KEYS = [
    "load_batch",
    "load_items",
    "group_by_entity",
    "validate_candidate_state",
    "write_validation_summary",
] as const;

export type ImportReviewSimpleValidationStageKey =
    (typeof IMPORT_REVIEW_SIMPLE_VALIDATION_STAGE_KEYS)[number];

const STAGE_ORDER_INDEX = new Map<string, number>(
    IMPORT_REVIEW_SIMPLE_VALIDATION_STAGE_KEYS.map((key, index) => [key, index])
);

export function isSimpleValidationStageKey(stageKey: string): stageKey is ImportReviewSimpleValidationStageKey {
    return (IMPORT_REVIEW_SIMPLE_VALIDATION_STAGE_KEYS as readonly string[]).includes(stageKey);
}

/** Hide legacy phantom stages (geometry, references, …) left pending from older API versions. */
export function filterSimpleValidationStageLogs<T extends { stage_key: string }>(items: T[]): T[] {
    return items.filter((item) => isSimpleValidationStageKey(item.stage_key));
}

export function sortSimpleValidationStageLogs<T extends { stage_key: string; started_at: string }>(
    items: T[]
): T[] {
    return [...items].sort((a, b) => {
        const ia = STAGE_ORDER_INDEX.get(a.stage_key as ImportReviewSimpleValidationStageKey) ?? 99;
        const ib = STAGE_ORDER_INDEX.get(b.stage_key as ImportReviewSimpleValidationStageKey) ?? 99;
        if (ia !== ib) {
            return ia - ib;
        }
        return a.started_at.localeCompare(b.started_at);
    });
}

export type ValidateItemsStageLiveDetails = {
    currentFamily: string | null;
    processedCount: number | null;
    totalItemCount: number | null;
    elapsedMs: number | null;
    lastHeartbeatAt: string | null;
    chunkIndex: number | null;
    chunkSize: number | null;
};

export function parseValidateItemsStageLiveDetails(details: unknown): ValidateItemsStageLiveDetails | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const d = details as Record<string, unknown>;
    const num = (key: string): number | null => {
        const v = d[key];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const str = (key: string): string | null => {
        const v = d[key];
        return typeof v === "string" && v.trim().length > 0 ? v : null;
    };
    return {
        currentFamily: str("current_family") ?? str("entity_family"),
        processedCount: num("processed_count"),
        totalItemCount: num("total_item_count"),
        elapsedMs: num("elapsed_ms"),
        lastHeartbeatAt: str("last_heartbeat_at"),
        chunkIndex: num("chunk_index"),
        chunkSize: num("chunk_size"),
    };
}

export function formatElapsedMs(ms: number | null | undefined): string | null {
    if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
        return null;
    }
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) {
        return `${min}m ${sec}s`;
    }
    return `${sec}s`;
}

export function formatValidateItemsStageDetailLine(
    live: ValidateItemsStageLiveDetails | null
): string | null {
    if (!live) {
        return null;
    }
    const parts: string[] = [];
    if (live.processedCount !== null && live.totalItemCount !== null) {
        parts.push(
            `${live.processedCount.toLocaleString()} / ${live.totalItemCount.toLocaleString()} items`
        );
    }
    const elapsed = formatElapsedMs(live.elapsedMs);
    if (elapsed) {
        parts.push(`elapsed ${elapsed}`);
    }
    if (live.lastHeartbeatAt) {
        const hb = new Date(live.lastHeartbeatAt);
        if (!Number.isNaN(hb.getTime())) {
            parts.push(`heartbeat ${hb.toLocaleTimeString()}`);
        }
    }
    if (live.chunkIndex !== null && live.chunkSize !== null) {
        parts.push(`chunk ${live.chunkIndex + 1} (${live.chunkSize})`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
}
