import type { ImportReviewPromotionEligibilityResponse } from "@/src/lib/api";

function isFamilyRow(value: unknown): value is ImportReviewPromotionEligibilityResponse["families"][number] {
    if (!value || typeof value !== "object") {
        return false;
    }
    const row = value as Record<string, unknown>;
    return typeof row.family === "string";
}

/** Accept canonical `families` or legacy `items` / `rows` keys from API payloads. */
export function normalizePromotionEligibilityResponse(
    raw: ImportReviewPromotionEligibilityResponse | Record<string, unknown>
): ImportReviewPromotionEligibilityResponse {
    const data = raw as Record<string, unknown>;
    const familiesRaw = data.families ?? data.items ?? data.rows;
    const families = Array.isArray(familiesRaw)
        ? familiesRaw.filter(isFamilyRow)
        : [];

    const totals =
        data.totals && typeof data.totals === "object"
            ? (data.totals as ImportReviewPromotionEligibilityResponse["totals"])
            : {
                  ready: 0,
                  warnings: 0,
                  blocked: 0,
                  batched: 0,
                  promoted: 0,
              };

    return {
        review_batch_id: Number(data.review_batch_id ?? 0),
        families,
        totals,
        has_high_risk: Boolean(data.has_high_risk),
        can_create_batch: Boolean(data.can_create_batch),
        messages: Array.isArray(data.messages)
            ? data.messages.filter((m): m is string => typeof m === "string")
            : [],
    };
}
