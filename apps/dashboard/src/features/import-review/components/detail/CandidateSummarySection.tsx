"use client";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { ImportReviewEntityConfig } from "../../config/types";
import { dash, formatImportReviewTs } from "../../utils/entityPageUtils";
import { resolveDrawerSubtitle, resolveDrawerTitle } from "../../utils/detailDrawerUtils";

export default function CandidateSummarySection({
    config,
    row,
}: {
    config: ImportReviewEntityConfig;
    row: ImportReviewBuildingListItem;
}) {
    const subtitle = resolveDrawerSubtitle(row, config);

    return (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Summary</h3>
                <p className="mt-1 text-base font-semibold text-gray-900">{resolveDrawerTitle(row, config)}</p>
                {subtitle ? (
                    <p className="text-sm text-gray-600">
                        <span className="font-medium text-gray-500">{config.detailSubtitleField ?? "external_id"}:</span>{" "}
                        <span className="font-mono">{subtitle}</span>
                    </p>
                ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                    <span className="font-medium text-gray-500">id</span>
                    <div className="break-all font-mono text-xs text-gray-900">{row.id}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">external_id</span>
                    <div className="font-mono text-xs text-gray-900">{dash(row.external_id)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">class_code</span>
                    <div className="font-mono text-gray-900">{dash(row.class_code)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">confidence_score</span>
                    <div className="tabular-nums text-gray-900">{dash(row.confidence_score)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">match_status</span>
                    <div>{dash(row.match_status)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">auto_action</span>
                    <div>{dash(row.auto_action)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">review_status</span>
                    <div>{dash(row.review_status)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">review_decision</span>
                    <div>{dash(row.review_decision)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">promotion_status</span>
                    <div>{dash(row.promotion_status)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">reviewed_by</span>
                    <div>{dash(row.reviewed_by)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">reviewed_at</span>
                    <div>{formatImportReviewTs(row.reviewed_at)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">created_at</span>
                    <div>{formatImportReviewTs(row.created_at)}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">updated_at</span>
                    <div>{formatImportReviewTs(row.updated_at)}</div>
                </div>
                <div className="sm:col-span-2">
                    <span className="font-medium text-gray-500">source_snapshot_id_local</span>
                    <div className="break-all font-mono text-[11px] text-gray-900">
                        {dash(row.source_snapshot_id_local)}
                    </div>
                </div>
                {row.matched_core_id ? (
                    <div className="sm:col-span-2">
                        <span className="font-medium text-gray-500">matched_core_id</span>
                        <div className="break-all font-mono text-[11px] text-gray-900">{row.matched_core_id}</div>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
