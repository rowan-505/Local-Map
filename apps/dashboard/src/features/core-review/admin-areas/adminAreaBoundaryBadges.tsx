"use client";

import { ConfidenceBadge } from "@/src/components/review/ReviewStatusBadge";
import ReviewStatusBadge, {
    type ReviewStatusBadgeVariant,
} from "@/src/components/review/ReviewStatusBadge";

import type { CoreReviewAdminAreaRow } from "../config/types";

function dash(value: string | null | undefined): string {
    const trimmed = value?.trim();
    return trimmed ? trimmed : "—";
}

const COMPACT_BOUNDARY_LABELS: Record<string, string> = {
    official: "Official",
    surveyed: "Surveyed",
    approximate: "Approx.",
    settlement_extent: "Settlement",
    unknown: "Unknown",
};

const COMPACT_ADDRESS_USAGE_LABELS: Record<string, string> = {
    official: "Address",
    locality_hint: "Locality hint",
    search_only: "Search only",
    disabled: "Disabled",
};

function boundaryStatusVariant(code: string | null | undefined): ReviewStatusBadgeVariant {
    switch (code) {
        case "official":
            return "verified";
        case "surveyed":
            return "surveyed";
        case "approximate":
            return "unverified";
        case "settlement_extent":
            return "settlement";
        case "unknown":
            return "neutral";
        default:
            return "neutral";
    }
}

function addressUsageVariant(code: string | null | undefined): ReviewStatusBadgeVariant {
    switch (code) {
        case "official":
            return "verified";
        case "locality_hint":
            return "public";
        case "search_only":
            return "neutral";
        case "disabled":
            return "inactive";
        default:
            return "neutral";
    }
}

function joinTooltipParts(parts: Array<string | null | undefined>): string | undefined {
    const lines = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
    return lines.length > 0 ? lines.join("\n\n") : undefined;
}

function boundaryStatusTooltip(row: CoreReviewAdminAreaRow): string | undefined {
    return joinTooltipParts([
        row.boundaryStatusLabelEn ?? row.boundaryStatus,
        row.boundaryStatusHelperEn,
    ]);
}

function addressUsageTooltip(row: CoreReviewAdminAreaRow): string | undefined {
    return joinTooltipParts([
        row.addressUsageLabelEn ?? row.addressUsage,
        row.addressUsageHelperEn,
    ]);
}

function boundaryListLabel(row: CoreReviewAdminAreaRow): string {
    const code = row.boundaryStatus?.trim();
    if (code && COMPACT_BOUNDARY_LABELS[code]) {
        return COMPACT_BOUNDARY_LABELS[code];
    }
    return row.boundaryStatusLabelEn?.trim() || code || "—";
}

function addressUsageListLabel(row: CoreReviewAdminAreaRow): string {
    const code = row.addressUsage?.trim();
    if (code && COMPACT_ADDRESS_USAGE_LABELS[code]) {
        return COMPACT_ADDRESS_USAGE_LABELS[code];
    }
    return row.addressUsageLabelEn?.trim() || code || "—";
}

function boundaryDetailLabel(row: CoreReviewAdminAreaRow): string {
    return row.boundaryStatusLabelEn?.trim() || row.boundaryStatus?.trim() || "—";
}

function addressUsageDetailLabel(row: CoreReviewAdminAreaRow): string {
    return row.addressUsageLabelEn?.trim() || row.addressUsage?.trim() || "—";
}

type BadgeMode = "list" | "detail";

export function AdminAreaBoundaryStatusBadge({
    row,
    mode = "detail",
}: {
    row: CoreReviewAdminAreaRow;
    mode?: BadgeMode;
}) {
    const label = mode === "list" ? boundaryListLabel(row) : boundaryDetailLabel(row);
    return (
        <ReviewStatusBadge
            variant={boundaryStatusVariant(row.boundaryStatus)}
            label={label}
            title={mode === "list" ? boundaryStatusTooltip(row) : undefined}
        />
    );
}

export function AdminAreaAddressUsageBadge({
    row,
    mode = "detail",
}: {
    row: CoreReviewAdminAreaRow;
    mode?: BadgeMode;
}) {
    const label = mode === "list" ? addressUsageListLabel(row) : addressUsageDetailLabel(row);
    return (
        <ReviewStatusBadge
            variant={addressUsageVariant(row.addressUsage)}
            label={label}
            title={mode === "list" ? addressUsageTooltip(row) : undefined}
        />
    );
}

export function AdminAreaOfficialBoundaryBadge({ row }: { row: CoreReviewAdminAreaRow }) {
    const isOfficial = row.isOfficialBoundary === true;
    return (
        <ReviewStatusBadge
            variant={isOfficial ? "verified" : "unverified"}
            label={isOfficial ? "Official boundary" : "Non-official"}
        />
    );
}

/** List table: boundary confidence as a compact percentage. */
export function AdminAreaBoundaryConfidenceCell({ row }: { row: CoreReviewAdminAreaRow }) {
    const score = row.boundaryConfidenceScore;
    if (score === null || score === undefined || Number.isNaN(score)) {
        return <span className="text-slate-500">—</span>;
    }
    const rounded = Math.round(score);
    return (
        <span
            className="inline-flex tabular-nums text-xs font-medium text-slate-700"
            title={`Boundary confidence: ${rounded}%`}
        >
            {rounded}%
        </span>
    );
}

export function adminAreaBoundaryDetailFields(row: CoreReviewAdminAreaRow) {
    return [
        { label: "Boundary status", value: <AdminAreaBoundaryStatusBadge row={row} mode="detail" /> },
        {
            label: "Boundary guidance",
            value: dash(row.boundaryStatusHelperEn),
        },
        { label: "Address usage", value: <AdminAreaAddressUsageBadge row={row} mode="detail" /> },
        {
            label: "Address usage guidance",
            value: dash(row.addressUsageHelperEn),
        },
        { label: "Official boundary", value: <AdminAreaOfficialBoundaryBadge row={row} /> },
        {
            label: "Boundary confidence",
            value: <ConfidenceBadge score={row.boundaryConfidenceScore} />,
        },
        { label: "Boundary note", value: dash(row.boundaryNote) },
    ];
}
