"use client";

import Link from "next/link";
import { useState } from "react";

import ImportReviewPromotionEligibilityReasonCell from "@/src/features/import-review/components/ImportReviewPromotionEligibilityReasonCell";
import ImportReviewStatusBadge from "@/src/features/import-review/components/ImportReviewStatusBadge";
import { promotionEligibilityReviewHref } from "@/src/features/import-review/utils/promotionEligibilityReviewHref";
import type {
    ImportReviewPromotionEligibilityBucket,
    ImportReviewPromotionEligibilityDetailItem,
} from "@/src/lib/api";

function formatDisplayName(item: ImportReviewPromotionEligibilityDetailItem): string {
    if (item.display_name?.trim()) {
        return item.display_name.trim();
    }
    if (item.external_id?.trim()) {
        return item.external_id.trim();
    }
    return "—";
}

function EligibilityJsonInspectPanel({
    item,
    onClose,
}: {
    item: ImportReviewPromotionEligibilityDetailItem;
    onClose: () => void;
}) {
    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Candidate #{item.id}</h3>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                    Close
                </button>
            </div>
            <pre className="max-h-64 overflow-auto rounded border border-gray-200 bg-white p-2 font-mono text-[11px] leading-relaxed text-gray-800">
                {JSON.stringify(item, null, 2)}
            </pre>
        </div>
    );
}

export default function ImportReviewPromotionEligibilityDetailsTable({
    items,
    family,
    reviewBatchId,
    bucket,
}: {
    items: ImportReviewPromotionEligibilityDetailItem[];
    family: string;
    reviewBatchId: string;
    bucket: ImportReviewPromotionEligibilityBucket;
}) {
    const [jsonInspectId, setJsonInspectId] = useState<number | null>(null);
    const jsonInspectItem = jsonInspectId != null ? items.find((i) => i.id === jsonInspectId) : null;

    return (
        <div className="space-y-3">
            <div className="-mx-1 overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-xs">
                    <thead>
                        <tr className="border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            <th className="whitespace-nowrap px-2 py-2">ID</th>
                            <th className="whitespace-nowrap px-2 py-2">External ID</th>
                            <th className="min-w-[8rem] px-2 py-2">Name / label</th>
                            <th className="min-w-[10rem] px-2 py-2">Reason</th>
                            <th className="whitespace-nowrap px-2 py-2">Match</th>
                            <th className="whitespace-nowrap px-2 py-2">Decision</th>
                            <th className="whitespace-nowrap px-2 py-2">Promotion</th>
                            <th className="whitespace-nowrap px-2 py-2">Conf.</th>
                            <th className="whitespace-nowrap px-2 py-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {items.map((item) => {
                            const reviewHref = promotionEligibilityReviewHref(
                                family,
                                reviewBatchId,
                                item.id
                            );
                            return (
                                <tr key={item.id} className="align-top text-gray-800">
                                    <td className="whitespace-nowrap px-2 py-2 tabular-nums">{item.id}</td>
                                    <td className="max-w-[8rem] truncate px-2 py-2 font-mono text-[10px] text-gray-600">
                                        {item.external_id ?? "—"}
                                    </td>
                                    <td className="max-w-[10rem] px-2 py-2">
                                        <span className="line-clamp-2 text-sm text-gray-900" title={formatDisplayName(item)}>
                                            {formatDisplayName(item)}
                                        </span>
                                    </td>
                                    <td className="min-w-[10rem] px-2 py-2">
                                        <ImportReviewPromotionEligibilityReasonCell
                                            reasonCodes={item.reason_codes}
                                            reasonMessages={item.reason_messages}
                                            bucket={bucket}
                                        />
                                    </td>
                                    <td className="px-2 py-2">
                                        {item.match_status ? (
                                            <ImportReviewStatusBadge value={item.match_status} />
                                        ) : (
                                            "—"
                                        )}
                                    </td>
                                    <td className="px-2 py-2">
                                        {item.review_decision ? (
                                            <ImportReviewStatusBadge value={item.review_decision} />
                                        ) : (
                                            "—"
                                        )}
                                    </td>
                                    <td className="px-2 py-2">
                                        {item.promotion_status ? (
                                            <ImportReviewStatusBadge value={item.promotion_status} />
                                        ) : (
                                            "—"
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-gray-600">
                                        {item.confidence_score != null ? item.confidence_score : "—"}
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-2">
                                        {reviewHref ? (
                                            <Link
                                                href={reviewHref}
                                                prefetch={false}
                                                className="font-medium text-emerald-800 hover:underline"
                                            >
                                                Open in review
                                            </Link>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => setJsonInspectId(item.id)}
                                                className="font-medium text-gray-700 hover:underline"
                                            >
                                                View details
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {jsonInspectItem ? (
                <EligibilityJsonInspectPanel
                    item={jsonInspectItem}
                    onClose={() => setJsonInspectId(null)}
                />
            ) : null}
        </div>
    );
}
