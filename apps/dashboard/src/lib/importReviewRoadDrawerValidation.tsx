"use client";

import { useMemo, useState, type ReactNode } from "react";

import type {
    ImportReviewBuildingListItem,
    ImportReviewRoadRoutingValidationResponse,
    ImportReviewRoadRoutingValidationStats,
    ImportReviewRoadValidationIssue,
} from "@/src/lib/api";
import { validationIssuesFromReviewJson } from "@/src/lib/importReviewValidationMessages";

/** Shown in mode banner — omit from validation issues list to avoid repetition. */
export const VALIDATION_MODE_BANNER_CODES = new Set(["NEW_REGION_NO_CORE_ROADS"]);

export type RoadDrawerValidationBundle = {
    validationMode: "existing_region" | "new_region" | null;
    errors: ImportReviewRoadValidationIssue[];
    warnings: ImportReviewRoadValidationIssue[];
    info: ImportReviewRoadValidationIssue[];
    stats: ImportReviewRoadRoutingValidationStats | null;
    canApprove: boolean | null;
};

export function dedupeValidationIssuesByCode(
    issues: ImportReviewRoadValidationIssue[],
): ImportReviewRoadValidationIssue[] {
    const seen = new Map<string, ImportReviewRoadValidationIssue>();
    for (const issue of issues) {
        const key = issue.code?.trim() || issue.message.trim();
        if (key.length === 0) {
            continue;
        }
        if (!seen.has(key)) {
            seen.set(key, issue);
        }
    }
    return [...seen.values()];
}

export function filterIssuesForDisplayList(
    issues: ImportReviewRoadValidationIssue[],
    excludeCodes: Set<string> = VALIDATION_MODE_BANNER_CODES,
): ImportReviewRoadValidationIssue[] {
    return dedupeValidationIssuesByCode(
        issues.filter((issue) => !issue.code || !excludeCodes.has(issue.code)),
    );
}

export function bundleFromRoutingValidation(
    result: ImportReviewRoadRoutingValidationResponse,
): RoadDrawerValidationBundle {
    return {
        validationMode: result.validation_mode,
        errors: dedupeValidationIssuesByCode(result.errors),
        warnings: dedupeValidationIssuesByCode(result.warnings),
        info: dedupeValidationIssuesByCode(result.info ?? []),
        stats: result.stats,
        canApprove: result.can_approve,
    };
}

export function bundleFromRow(row: ImportReviewBuildingListItem): RoadDrawerValidationBundle {
    const errors = dedupeValidationIssuesByCode(
        validationIssuesFromReviewJson(row.validation_errors, "error"),
    );
    const mixed = validationIssuesFromReviewJson(row.validation_warnings, "warning");
    const warnings = dedupeValidationIssuesByCode(mixed.filter((i) => i.severity !== "info"));
    const info = dedupeValidationIssuesByCode(mixed.filter((i) => i.severity === "info"));
    const hasNewRegionSignal = [...warnings, ...info, ...errors].some(
        (i) => i.code === "NEW_REGION_NO_CORE_ROADS",
    );
    const validationMode: RoadDrawerValidationBundle["validationMode"] =
        hasNewRegionSignal
            ? "new_region"
            : errors.length > 0 || warnings.length > 0 || info.length > 0
              ? "existing_region"
              : null;
    return {
        validationMode,
        errors,
        warnings,
        info,
        stats: null,
        canApprove: null,
    };
}

export function formatValidationIssue(issue: ImportReviewRoadValidationIssue): string {
    return issue.code ? `[${issue.code}] ${issue.message}` : issue.message;
}

export function ValidationSummaryBanner({
    errors,
    warnings,
}: {
    errors: ImportReviewRoadValidationIssue[];
    warnings: ImportReviewRoadValidationIssue[];
}) {
    if (errors.length > 0) {
        return (
            <div
                role="status"
                className="rounded-lg border border-red-200/80 bg-red-50/90 px-3 py-2.5 text-sm font-medium text-red-950"
            >
                Cannot approve. {errors.length} error{errors.length === 1 ? "" : "s"} must be fixed.
            </div>
        );
    }
    if (warnings.length > 0) {
        return (
            <div
                role="status"
                className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-sm font-medium text-amber-950"
            >
                Can save, but approval requires confirmation. {warnings.length} warning
                {warnings.length === 1 ? "" : "s"} found.
            </div>
        );
    }
    return (
        <div
            role="status"
            className="rounded-lg border border-emerald-200/80 bg-emerald-50/90 px-3 py-2.5 text-sm font-medium text-emerald-950"
        >
            Routing validation passed.
        </div>
    );
}

export function ValidationModeBanner({ mode }: { mode: "existing_region" | "new_region" }) {
    if (mode === "new_region") {
        return (
            <p className="rounded-md border border-sky-200/80 bg-sky-50/90 px-2.5 py-2 text-xs text-sky-950">
                <strong>New region mode:</strong> No production road network found. Validation uses
                same-batch review roads.
            </p>
        );
    }
    return (
        <p className="rounded-md border border-gray-200/80 bg-gray-50/90 px-2.5 py-2 text-xs text-gray-800">
            <strong>Existing region mode:</strong> Nearby core streets were used for connectivity checks.
        </p>
    );
}

export function ApprovalGuidanceNote({
    canApprove,
    errors,
    warnings,
}: {
    canApprove: boolean | null;
    errors: ImportReviewRoadValidationIssue[];
    warnings: ImportReviewRoadValidationIssue[];
}) {
    if (canApprove === true) {
        return null;
    }
    if (errors.length > 0) {
        return null;
    }
    if (warnings.length === 0 && canApprove === null) {
        return null;
    }
    return (
        <p className="text-xs text-amber-900/90">
            Approval requires warning confirmation and review note.
        </p>
    );
}

function StatCell({
    label,
    value,
    className = "",
}: {
    label: string;
    value: string | number;
    className?: string;
}) {
    return (
        <div className={className}>
            <span className="block text-[10px] text-gray-500">{label}</span>
            <span className="font-mono text-sm font-semibold text-gray-900">{value}</span>
        </div>
    );
}

export function ValidationStatsGrid({
    stats,
    canApprove,
}: {
    stats: ImportReviewRoadRoutingValidationStats;
    canApprove: boolean | null;
}) {
    return (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-gray-200/80 bg-white/80 p-2 text-xs sm:grid-cols-4">
            <StatCell label="Core roads nearby" value={stats.nearby_core_roads} />
            <StatCell label="Review roads nearby" value={stats.nearby_review_roads} />
            <StatCell label="Connected endpoints" value={stats.connected_endpoints} />
            <StatCell label="Isolated endpoints" value={stats.isolated_endpoints} />
            <StatCell label="Length" value={`${stats.length_m.toFixed(1)} m`} className="sm:col-span-2" />
            <StatCell label="Duplicates" value={stats.possible_duplicates} />
            <StatCell label="Unsplit crossings" value={stats.possible_unsplit_intersections} />
            <StatCell
                label="Can approve"
                value={canApprove === null ? "—" : canApprove ? "yes" : "no"}
                className="sm:col-span-2"
            />
        </div>
    );
}

export function CollapsibleDrawerSection({
    title,
    defaultOpen = false,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    children: ReactNode;
}) {
    return (
        <details
            open={defaultOpen}
            className="group rounded-lg border border-gray-200/80 bg-gray-50/50"
        >
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 transition group-open:rotate-90">
                        ▶
                    </span>
                    {title}
                </span>
            </summary>
            <div className="border-t border-gray-200/80 px-3 pb-3 pt-2">{children}</div>
        </details>
    );
}

function IssueAccordionGroup({
    title,
    issues,
    tone,
    defaultOpen,
}: {
    title: string;
    issues: ImportReviewRoadValidationIssue[];
    tone: "red" | "amber" | "slate";
    defaultOpen: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    if (issues.length === 0) {
        return null;
    }
    const toneCls =
        tone === "red"
            ? "border-red-200/70 bg-red-50/60 text-red-950"
            : tone === "amber"
              ? "border-amber-200/70 bg-amber-50/60 text-amber-950"
              : "border-slate-200/70 bg-slate-50/60 text-slate-800";

    return (
        <details
            open={open}
            onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
            className={`rounded-md border ${toneCls}`}
        >
            <summary className="cursor-pointer px-2.5 py-2 text-xs font-semibold marker:content-none [&::-webkit-details-marker]:hidden">
                {title} ({issues.length})
            </summary>
            <ul className="list-disc space-y-0.5 border-t border-inherit/40 px-2.5 py-2 pl-6 text-xs">
                {issues.map((item) => (
                    <li key={item.code || item.message}>{formatValidationIssue(item)}</li>
                ))}
            </ul>
        </details>
    );
}

export function ValidationIssuesSection({
    errors,
    warnings,
    info,
    excludeModeBannerCodes = true,
}: {
    errors: ImportReviewRoadValidationIssue[];
    warnings: ImportReviewRoadValidationIssue[];
    info: ImportReviewRoadValidationIssue[];
    excludeModeBannerCodes?: boolean;
}) {
    const exclude = excludeModeBannerCodes ? VALIDATION_MODE_BANNER_CODES : new Set<string>();
    const displayErrors = useMemo(() => filterIssuesForDisplayList(errors, exclude), [errors, exclude]);
    const displayWarnings = useMemo(
        () => filterIssuesForDisplayList(warnings, exclude),
        [warnings, exclude],
    );
    const displayInfo = useMemo(() => filterIssuesForDisplayList(info, exclude), [info, exclude]);

    const hasAny = displayErrors.length + displayWarnings.length + displayInfo.length > 0;
    if (!hasAny) {
        return <p className="text-[11px] text-gray-600">No validation issues.</p>;
    }

    return (
        <div className="space-y-2">
            <h5 className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                Validation issues
            </h5>
            <IssueAccordionGroup title="Errors" issues={displayErrors} tone="red" defaultOpen />
            <IssueAccordionGroup
                title="Warnings"
                issues={displayWarnings}
                tone="amber"
                defaultOpen={displayWarnings.length <= 5}
            />
            <IssueAccordionGroup title="Info" issues={displayInfo} tone="slate" defaultOpen={false} />
        </div>
    );
}
