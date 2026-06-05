import type { ImportReviewPromotionEligibilityResponse } from "@/src/lib/api";

function toCount(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toNullableCount(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    return toCount(value);
}

function isFamilyRow(value: unknown): value is ImportReviewPromotionEligibilityResponse["families"][number] {
    if (!value || typeof value !== "object") {
        return false;
    }
    const row = value as Record<string, unknown>;
    return typeof row.family === "string";
}

function normalizeFamilyRow(
    row: ImportReviewPromotionEligibilityResponse["families"][number]
): ImportReviewPromotionEligibilityResponse["families"][number] {
    const raw = row as Record<string, unknown>;
    const ready_now = toCount(raw.ready_now ?? raw.ready);
    const retry_needed = toCount(raw.retry_needed);
    const active_locked = toCount(raw.active_locked);
    const stale_locked = toCount(raw.stale_locked);
    const promoted = toCount(raw.promoted);
    return {
        ...row,
        counts_ok: typeof raw.counts_ok === "boolean" ? raw.counts_ok : true,
        count_error:
            raw.count_error && typeof raw.count_error === "object"
                ? (raw.count_error as ImportReviewPromotionEligibilityResponse["families"][number]["count_error"])
                : null,
        approved_count: toNullableCount(raw.approved_count),
        ready_existing_count: toNullableCount(raw.ready_existing_count),
        blocked_existing_count: toNullableCount(raw.blocked_existing_count),
        warning_existing_count: toNullableCount(raw.warning_existing_count),
        already_batched_count: toNullableCount(raw.already_batched_count),
        already_promoted_count: toNullableCount(raw.already_promoted_count),
        ready_now,
        retry_needed,
        active_locked,
        stale_locked,
        promoted,
        ready: ready_now,
        warnings: toCount(raw.warnings),
        blocked: toCount(raw.blocked),
        batched: active_locked + stale_locked,
    };
}

function normalizeTotals(
    totals: unknown,
    families: ImportReviewPromotionEligibilityResponse["families"]
): ImportReviewPromotionEligibilityResponse["totals"] {
    if (totals && typeof totals === "object") {
        const raw = totals as Record<string, unknown>;
        const ready_now = toCount(raw.ready_now ?? raw.ready);
        const retry_needed = toCount(raw.retry_needed);
        const active_locked = toCount(raw.active_locked);
        const stale_locked = toCount(raw.stale_locked);
        const promoted = toCount(raw.promoted);
        return {
            ready_now,
            retry_needed,
            active_locked,
            stale_locked,
            promoted,
            ready: ready_now,
            warnings: toCount(raw.warnings),
            blocked: toCount(raw.blocked),
            batched: active_locked + stale_locked,
        };
    }

    return families.reduce(
        (acc, row) => ({
            ready_now: acc.ready_now + row.ready_now,
            retry_needed: acc.retry_needed + row.retry_needed,
            active_locked: acc.active_locked + row.active_locked,
            stale_locked: acc.stale_locked + row.stale_locked,
            promoted: acc.promoted + row.promoted,
            ready: acc.ready + row.ready_now,
            warnings: acc.warnings + row.warnings,
            blocked: acc.blocked + row.blocked,
            batched: acc.batched + row.batched,
        }),
        {
            ready_now: 0,
            retry_needed: 0,
            active_locked: 0,
            stale_locked: 0,
            promoted: 0,
            ready: 0,
            warnings: 0,
            blocked: 0,
            batched: 0,
        }
    );
}

/** Accept canonical `families` or legacy `items` / `rows` keys from API payloads. */
export function normalizePromotionEligibilityResponse(
    raw: ImportReviewPromotionEligibilityResponse | Record<string, unknown>
): ImportReviewPromotionEligibilityResponse {
    const data = raw as Record<string, unknown>;
    const familiesRaw = data.families ?? data.items ?? data.rows;
    const families = Array.isArray(familiesRaw)
        ? familiesRaw.filter(isFamilyRow).map(normalizeFamilyRow)
        : [];

    return {
        review_batch_id: Number(data.review_batch_id ?? 0),
        families,
        totals: normalizeTotals(data.totals, families),
        has_high_risk: Boolean(data.has_high_risk),
        can_create_batch: Boolean(data.can_create_batch),
        messages: Array.isArray(data.messages)
            ? data.messages.filter((m): m is string => typeof m === "string")
            : [],
    };
}
