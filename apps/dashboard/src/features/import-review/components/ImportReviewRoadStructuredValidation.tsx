"use client";

import type {
    ImportReviewRoadRoutingValidationStats,
    ImportReviewRoadValidationIssue,
    RoadDryRunItemResult,
} from "@/src/lib/api";
import ImportReviewRoadDryRunStatusBadge from "@/src/features/import-review/components/ImportReviewRoadDryRunStatusBadge";
import {
    formatValidationIssue,
    ValidationStatsGrid,
} from "@/src/lib/importReviewRoadDrawerValidation";

const CONNECTIVITY_CODES = new Set([
    "START_ENDPOINT_ISOLATED",
    "END_ENDPOINT_ISOLATED",
    "ROAD_ISLAND",
    "IMPORTANT_ROAD_ISOLATED",
    "POSSIBLE_UNSNAPPED_ENDPOINT",
    "NO_CANDIDATE_CONNECTIONS",
    "CANDIDATE_NETWORK_ISLAND",
    "NEW_REGION_NO_CORE_ROADS",
]);

const DUPLICATE_CODES = new Set([
    "POSSIBLE_DUPLICATE_CORE_ROAD",
    "POSSIBLE_DUPLICATE_REVIEW_ROAD",
    "DUPLICATE_EXTERNAL_ID_IN_REVIEW_BATCH",
    "DUPLICATE_EXTERNAL_ID_IN_CORE",
    "LIKELY_NAME_CLASS_DUPLICATE",
]);

const ROUTING_ATTR_CODES = new Set([
    "SURFACE_MISSING",
    "ACCESS_MISSING",
    "SPEED_KPH_MISSING",
    "ONEWAY_UNKNOWN",
    "ONEWAY_CHANGED_WITHOUT_NOTE",
    "ROUTING_CLASS_MISSING",
    "ROUTING_LAYER_SUSPICIOUS",
    "LAYER_BRIDGE_TUNNEL_SUSPICIOUS",
    "NAME_MISSING",
]);

function partitionIssues(issues: ImportReviewRoadValidationIssue[]) {
    const connectivity: ImportReviewRoadValidationIssue[] = [];
    const duplicates: ImportReviewRoadValidationIssue[] = [];
    const routing: ImportReviewRoadValidationIssue[] = [];
    const reviewWarnings: ImportReviewRoadValidationIssue[] = [];
    const blocking: ImportReviewRoadValidationIssue[] = [];
    const info: ImportReviewRoadValidationIssue[] = [];

    for (const issue of issues) {
        const code = issue.code ?? "";
        if (issue.severity === "error") {
            blocking.push(issue);
            continue;
        }
        if (issue.severity === "info") {
            info.push(issue);
            continue;
        }
        if (CONNECTIVITY_CODES.has(code) || code.includes("ENDPOINT") || code.includes("INTERSECTION")) {
            connectivity.push(issue);
        } else if (DUPLICATE_CODES.has(code) || code.includes("DUPLICATE")) {
            duplicates.push(issue);
        } else if (ROUTING_ATTR_CODES.has(code)) {
            routing.push(issue);
        } else {
            reviewWarnings.push(issue);
        }
    }

    return { blocking, reviewWarnings, info, connectivity, duplicates, routing };
}

function IssueList({ title, issues, tone }: { title: string; issues: ImportReviewRoadValidationIssue[]; tone: string }) {
    if (issues.length === 0) {
        return null;
    }
    return (
        <details open className={`rounded-md border px-3 py-2 ${tone}`}>
            <summary className="cursor-pointer text-xs font-semibold">
                {title} ({issues.length})
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {issues.map((issue) => (
                    <li key={`${issue.code}-${issue.message}`}>{formatValidationIssue(issue)}</li>
                ))}
            </ul>
        </details>
    );
}

export default function ImportReviewRoadStructuredValidation({
    errors,
    warnings,
    info,
    stats,
    canApprove,
    dryRunItem,
}: {
    errors: ImportReviewRoadValidationIssue[];
    warnings: ImportReviewRoadValidationIssue[];
    info: ImportReviewRoadValidationIssue[];
    stats: ImportReviewRoadRoutingValidationStats | null;
    canApprove: boolean | null;
    dryRunItem?: RoadDryRunItemResult | null;
}) {
    const allIssues = [...errors, ...warnings, ...info];
    const parts = partitionIssues(allIssues);

    return (
        <div className="space-y-3">
            {dryRunItem ? (
                <div className="rounded-md border border-violet-200 bg-violet-50/70 px-3 py-2 text-xs text-violet-950">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">Promotion dry-run:</span>
                        <ImportReviewRoadDryRunStatusBadge status={dryRunItem.dry_run_status} />
                        {dryRunItem.can_promote_later ? (
                            <span className="text-emerald-800">Can promote later</span>
                        ) : (
                            <span className="text-red-800">Blocked from promotion</span>
                        )}
                    </div>
                </div>
            ) : null}

            {stats ? <ValidationStatsGrid stats={stats} canApprove={canApprove} /> : null}

            <IssueList title="Blocking errors" issues={parts.blocking} tone="border-red-200 bg-red-50 text-red-950" />
            <IssueList
                title="Warnings requiring review"
                issues={parts.reviewWarnings}
                tone="border-amber-200 bg-amber-50 text-amber-950"
            />
            <IssueList title="Connectivity" issues={parts.connectivity} tone="border-sky-200 bg-sky-50 text-sky-950" />
            <IssueList title="Duplicates" issues={parts.duplicates} tone="border-orange-200 bg-orange-50 text-orange-950" />
            <IssueList title="Routing attributes" issues={parts.routing} tone="border-teal-200 bg-teal-50 text-teal-950" />
            <IssueList title="Informational notices" issues={parts.info} tone="border-slate-200 bg-slate-50 text-slate-800" />
        </div>
    );
}
