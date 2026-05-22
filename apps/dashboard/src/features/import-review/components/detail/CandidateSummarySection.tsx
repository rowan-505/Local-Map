"use client";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { ImportReviewEntityConfig } from "../../config/types";
import { dash, formatBuildingTypeLabel, formatImportReviewTs, importReviewRowHasOverrides } from "../../utils/entityPageUtils";
import { resolveDrawerSubtitle, resolveDrawerTitle } from "../../utils/detailDrawerUtils";
import {
    formatLanduseClassLabel,
    formatLanduseImportedClassCode,
} from "../../utils/importReviewLanduseListDisplay";

function hasNameFields(config: ImportReviewEntityConfig): boolean {
    return config.overrideEditableFields.includes("name_mm") || config.overrideEditableFields.includes("name_en");
}

export default function CandidateSummarySection({
    config,
    row,
}: {
    config: ImportReviewEntityConfig;
    row: ImportReviewBuildingListItem;
}) {
    const subtitle = resolveDrawerSubtitle(row, config);
    const nameMm = row.effective_name_mm ?? null;
    const nameEn = row.effective_name_en ?? null;
    const showNames = hasNameFields(config);

    return (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div>
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Summary</h3>
                    {importReviewRowHasOverrides(row) ? (
                        <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-900">
                            Overrides applied
                        </span>
                    ) : null}
                </div>
                <p className="mt-1 text-base font-semibold text-gray-900">{resolveDrawerTitle(row, config)}</p>
                {subtitle ? (
                    <p className="text-sm text-gray-600">
                        <span className="font-medium text-gray-500">{config.detailSubtitleField ?? "external_id"}:</span>{" "}
                        <span className="font-mono">{subtitle}</span>
                    </p>
                ) : null}
            </div>

            {showNames ? (
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-100 bg-gray-50/80 p-3 text-sm sm:grid-cols-2">
                    <div>
                        <span className="font-medium text-gray-500">Myanmar name</span>
                        <div className="text-gray-900">{dash(nameMm)}</div>
                    </div>
                    <div>
                        <span className="font-medium text-gray-500">English name</span>
                        <div className="text-gray-900">{dash(nameEn)}</div>
                    </div>
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                    <span className="font-medium text-gray-500">id</span>
                    <div className="break-all font-mono text-xs text-gray-900">{row.id}</div>
                </div>
                <div>
                    <span className="font-medium text-gray-500">external_id</span>
                    <div className="font-mono text-xs text-gray-900">{dash(row.external_id)}</div>
                </div>
                {config.slug === "buildings" ? (
                    <div>
                        <span className="font-medium text-gray-500">Building type</span>
                        <div className="text-gray-900">{dash(formatBuildingTypeLabel(row))}</div>
                    </div>
                ) : config.slug === "addresses" ? null : config.slug === "routing-barriers" ? (
                    <>
                        <div>
                            <span className="font-medium text-gray-500">Barrier type</span>
                            <div className="font-mono text-gray-900">{dash(row.effective_barrier_type)}</div>
                        </div>
                        <div>
                            <span className="font-medium text-gray-500">Class</span>
                            <div className="font-mono text-gray-900">{dash(row.effective_class_code)}</div>
                        </div>
                    </>
                ) : config.apiFamily === "roads" ? null : config.apiFamily === "landuse" ? (
                    <>
                        <div>
                            <span className="font-medium text-gray-500">Landuse class</span>
                            <div className="text-gray-900">{dash(formatLanduseClassLabel(row))}</div>
                        </div>
                        <div>
                            <span className="font-medium text-gray-500">Imported class</span>
                            <div className="font-mono text-xs text-gray-700">
                                {dash(formatLanduseImportedClassCode(row))}
                            </div>
                        </div>
                    </>
                ) : (
                    <div>
                        <span className="font-medium text-gray-500">
                            {config.apiFamily === "water_lines"
                                ? "Waterway class"
                                : config.apiFamily === "water_polygons"
                                  ? "Water class"
                                  : "Class"}
                        </span>
                        <div className="font-mono text-gray-900">{dash(row.effective_class_code)}</div>
                    </div>
                )}
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
