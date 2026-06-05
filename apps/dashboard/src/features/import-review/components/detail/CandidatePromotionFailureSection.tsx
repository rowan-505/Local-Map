"use client";

import Link from "next/link";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import { importReviewPath } from "@/src/lib/dashboardNavigation";

import { isCandidateRetryNeeded } from "../../utils/importReviewPromotionListState";

export default function CandidatePromotionFailureSection({
    row,
}: {
    row: ImportReviewBuildingListItem;
}) {
    if (!isCandidateRetryNeeded(row)) {
        return null;
    }

    const batchId = row.latest_promotion_publish_batch_id?.trim() || null;
    const errorCode = row.latest_promotion_error_code?.trim() || null;
    const errorMessage = row.latest_promotion_failure_message?.trim() || null;

    return (
        <section className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-red-800">
                Promotion failed
            </h3>
            <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                    <dt className="font-medium text-red-800/90">Latest publish batch</dt>
                    <dd className="font-mono text-xs">
                        {batchId ? (
                            <Link
                                href={importReviewPath(`history/publish-batches/${batchId}`)}
                                className="underline hover:text-red-950"
                            >
                                #{batchId}
                            </Link>
                        ) : (
                            "—"
                        )}
                    </dd>
                </div>
                <div>
                    <dt className="font-medium text-red-800/90">Error code</dt>
                    <dd className="font-mono text-xs">{errorCode || "—"}</dd>
                </div>
            </dl>
            <div>
                <dt className="font-medium text-red-800/90">Error message</dt>
                <dd className="mt-1 whitespace-pre-wrap text-red-900">{errorMessage || "—"}</dd>
            </div>
            <p className="text-xs text-red-800/90">
                Edit this candidate to fix the issue, then create a new publish batch. If it is still
                stuck as batched, use Release stale locked items on the promotion scope page.
            </p>
        </section>
    );
}
