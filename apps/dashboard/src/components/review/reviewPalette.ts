/** Neutral palette tokens — import review uses gray; core review uses slate/zinc. */

export type ReviewPalette = "import" | "core";

export const REVIEW_PALETTE = {
    import: {
        pageBg: "bg-gray-50",
        cardBorder: "border-gray-200",
        cardBg: "bg-white",
        title: "text-gray-900",
        body: "text-gray-600",
        muted: "text-gray-500",
        navBorder: "border-gray-200",
        navInactive: "text-gray-700 hover:bg-gray-100",
        navActive: "bg-gray-900 font-medium text-white",
        rowHover: "hover:bg-gray-50",
        rowSelected: "bg-sky-50 ring-1 ring-inset ring-sky-200",
        inputBorder: "border-gray-300",
        dashedBorder: "border-gray-300",
    },
    core: {
        pageBg: "bg-slate-50",
        cardBorder: "border-slate-200",
        cardBg: "bg-white",
        title: "text-slate-900",
        body: "text-slate-600",
        muted: "text-slate-500",
        navBorder: "border-slate-200",
        navInactive: "text-slate-700 hover:bg-slate-100",
        navActive: "bg-slate-900 font-medium text-white",
        rowHover: "hover:bg-slate-50",
        rowSelected: "bg-sky-50 ring-1 ring-inset ring-sky-200",
        inputBorder: "border-slate-300",
        dashedBorder: "border-slate-300",
    },
} as const;

export function reviewTableRowClass(
    palette: ReviewPalette,
    isSelected: boolean,
    extra?: string
): string {
    const p = REVIEW_PALETTE[palette];
    const base = isSelected ? p.rowSelected : p.rowHover;
    return `cursor-pointer ${p.title} ${base}${extra ? ` ${extra}` : ""}`;
}

export function confidenceBadgeVariant(
    score: number | null | undefined
): "confidence-high" | "confidence-medium" | "confidence-low" | "neutral" {
    if (score === null || score === undefined || Number.isNaN(score)) {
        return "neutral";
    }
    if (score >= 80) {
        return "confidence-high";
    }
    if (score >= 60) {
        return "confidence-medium";
    }
    return "confidence-low";
}
