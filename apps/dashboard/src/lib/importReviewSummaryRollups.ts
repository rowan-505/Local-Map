import type { ImportReviewSummaryBucketRow } from "@/src/lib/api";
import {
    getImportReviewEntityByApiFamily,
    sortEntityFamilies,
} from "@/src/lib/importReviewEntityConfig";

function lc(s: string | null | undefined): string {
    return (s ?? "").trim().toLowerCase();
}

function sumWhere(rows: ImportReviewSummaryBucketRow[], pred: (r: ImportReviewSummaryBucketRow) => boolean): number {
    let n = 0;
    for (const r of rows) {
        if (pred(r)) {
            n += r.row_count;
        }
    }
    return n;
}

export type ImportReviewFamilyRollup = {
    apiFamily: string;
    label: string;
    slug: string | null;
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    needsReview: number;
    promoted: number;
    promotionFailed: number;
};

export type ImportReviewBatchRollup = {
    totalCandidates: number;
    pending: number;
    approved: number;
    rejected: number;
    needsReview: number;
    promoted: number;
    promotionFailed: number;
    readyForPublish: number;
    ignored: number;
    merged: number;
    byFamily: ImportReviewFamilyRollup[];
};

function isPendingBucket(r: ImportReviewSummaryBucketRow): boolean {
    const rs = lc(r.review_status);
    return (rs === "pending" || rs === "needs_review") && lc(r.promotion_status) !== "promoted";
}

function isNeedsReviewBucket(r: ImportReviewSummaryBucketRow): boolean {
    const rs = lc(r.review_status);
    return rs === "needs_review" || rs === "needs_more_review" || lc(r.review_decision) === "needs_more_review";
}

export function computeBatchRollups(
    rows: ImportReviewSummaryBucketRow[],
    entityFamiliesFromEnvelope?: string[] | null
): ImportReviewBatchRollup {
    const familySet = new Set<string>();
    for (const r of rows) {
        if (r.entity_family?.trim()) {
            familySet.add(r.entity_family.trim());
        }
    }
    if (entityFamiliesFromEnvelope) {
        for (const f of entityFamiliesFromEnvelope) {
            if (f.trim()) {
                familySet.add(f.trim());
            }
        }
    }

    const orderedFamilies = sortEntityFamilies([...familySet]);

    const byFamily: ImportReviewFamilyRollup[] = orderedFamilies.map((apiFamily) => {
        const familyRows = rows.filter((r) => lc(r.entity_family) === lc(apiFamily));
        const cfg = getImportReviewEntityByApiFamily(apiFamily);
        return {
            apiFamily,
            label: cfg?.pluralLabel ?? apiFamily.replace(/_/g, " "),
            slug: cfg?.slug ?? null,
            total: sumWhere(familyRows, () => true),
            pending: sumWhere(familyRows, isPendingBucket),
            approved: sumWhere(familyRows, (r) => lc(r.review_decision) === "approved"),
            rejected: sumWhere(familyRows, (r) => lc(r.review_decision) === "rejected"),
            needsReview: sumWhere(familyRows, isNeedsReviewBucket),
            promoted: sumWhere(familyRows, (r) => lc(r.promotion_status) === "promoted"),
            promotionFailed: sumWhere(familyRows, (r) => lc(r.promotion_status) === "promotion_failed"),
        };
    });

    return {
        totalCandidates: sumWhere(rows, () => true),
        pending: sumWhere(rows, isPendingBucket),
        approved: sumWhere(rows, (r) => lc(r.review_decision) === "approved"),
        rejected: sumWhere(rows, (r) => lc(r.review_decision) === "rejected"),
        needsReview: sumWhere(rows, isNeedsReviewBucket),
        promoted: sumWhere(rows, (r) => lc(r.promotion_status) === "promoted"),
        promotionFailed: sumWhere(rows, (r) => lc(r.promotion_status) === "promotion_failed"),
        readyForPublish: sumWhere(
            rows,
            (r) =>
                lc(r.review_decision) === "approved" &&
                lc(r.review_status) === "approved" &&
                lc(r.promotion_status) !== "promoted" &&
                lc(r.promotion_status) !== "promotion_failed"
        ),
        ignored: sumWhere(
            rows,
            (r) => lc(r.review_decision) === "ignored" || lc(r.review_status) === "ignored"
        ),
        merged: sumWhere(
            rows,
            (r) => lc(r.review_decision) === "merged" || lc(r.review_status) === "merged"
        ),
        byFamily,
    };
}

export function familyBucketRows(
    rows: ImportReviewSummaryBucketRow[],
    apiFamily: string
): ImportReviewSummaryBucketRow[] {
    return rows.filter((r) => lc(r.entity_family) === lc(apiFamily));
}

export function aggregateBy(
    rows: ImportReviewSummaryBucketRow[],
    key: "match_status" | "auto_action" | "review_decision" | "promotion_status"
): Record<string, number> {
    const m: Record<string, number> = {};
    for (const r of rows) {
        const raw = r[key];
        const label = raw === null || raw === undefined || raw === "" ? "(empty)" : raw;
        m[label] = (m[label] ?? 0) + r.row_count;
    }
    return m;
}
