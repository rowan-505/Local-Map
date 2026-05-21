"use client";

import Link from "next/link";

import ReviewHeaderCard from "@/src/components/review/ReviewHeaderCard";
import { REVIEW_PALETTE } from "@/src/components/review/reviewPalette";

export default function ImportReviewPageHeader({
    pluralLabel,
    batchId,
    selectedBy,
    overviewHref,
}: {
    pluralLabel: string;
    batchId: string | null;
    selectedBy: string | null | undefined;
    overviewHref: string;
}) {
    const p = REVIEW_PALETTE.import;
    return (
        <ReviewHeaderCard
            palette="import"
            title={`Import review — ${pluralLabel}`}
            description={
                batchId ? (
                    <>
                        Batch <span className="font-mono font-medium">{batchId}</span>
                        {selectedBy ? <span className={p.muted}> · {selectedBy}</span> : null}
                    </>
                ) : (
                    "Set review_batch_id or source_snapshot_version to load candidates."
                )
            }
            actions={
                <Link
                    href={overviewHref}
                    className={`inline-flex shrink-0 rounded-lg border ${p.inputBorder} ${p.cardBg} px-4 py-2 text-sm font-medium shadow-sm hover:bg-gray-50 ${p.title}`}
                >
                    Back to overview
                </Link>
            }
        />
    );
}
