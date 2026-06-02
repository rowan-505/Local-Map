"use client";

import type { ImportReviewPromotionEligibilityBucket } from "@/src/lib/api";

const MAX_VISIBLE = 2;

function reasonToneClass(bucket: ImportReviewPromotionEligibilityBucket): string {
    if (bucket === "blocked") {
        return "rounded-md border border-red-200 bg-red-50/90 px-2 py-1.5";
    }
    if (bucket === "warnings") {
        return "rounded-md border border-amber-200 bg-amber-50/80 px-2 py-1.5";
    }
    return "";
}

function codeBadgeClass(bucket: ImportReviewPromotionEligibilityBucket): string {
    if (bucket === "blocked") {
        return "border-red-300 bg-red-100 text-red-950";
    }
    if (bucket === "warnings") {
        return "border-amber-300 bg-amber-100 text-amber-950";
    }
    return "border-gray-200 bg-gray-100 text-gray-800";
}

export default function ImportReviewPromotionEligibilityReasonCell({
    reasonCodes,
    reasonMessages,
    bucket,
}: {
    reasonCodes: string[];
    reasonMessages: string[];
    bucket: ImportReviewPromotionEligibilityBucket;
}) {
    if (reasonCodes.length === 0) {
        return <span className="text-xs text-gray-400">—</span>;
    }

    const visible = reasonCodes.slice(0, MAX_VISIBLE);
    const hiddenCount = reasonCodes.length - visible.length;
    const wrapClass = reasonToneClass(bucket);

    return (
        <ul className={`space-y-1.5 text-xs ${wrapClass}`}>
            {visible.map((code, index) => {
                const message = reasonMessages[index]?.trim();
                return (
                    <li key={`${code}-${index}`}>
                        <span
                            className={`inline-flex max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${codeBadgeClass(bucket)}`}
                            title={code}
                        >
                            {code}
                        </span>
                        {message ? <p className="mt-0.5 text-[11px] leading-snug text-gray-600">{message}</p> : null}
                    </li>
                );
            })}
            {hiddenCount > 0 ? (
                <li className="text-[11px] font-medium text-gray-500">+{hiddenCount} more</li>
            ) : null}
        </ul>
    );
}
