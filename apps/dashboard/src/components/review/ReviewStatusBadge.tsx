import { confidenceBadgeVariant } from "./reviewPalette";

const VARIANT_STYLES = {
    verified: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    unverified: "bg-amber-50 text-amber-900 ring-amber-200",
    active: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    inactive: "bg-slate-100 text-slate-600 ring-slate-200",
    public: "bg-sky-50 text-sky-800 ring-sky-200",
    private: "bg-slate-100 text-slate-600 ring-slate-200",
    deleted: "bg-red-50 text-red-800 ring-red-200",
    "confidence-high": "bg-emerald-50 text-emerald-800 ring-emerald-200",
    "confidence-medium": "bg-amber-50 text-amber-900 ring-amber-200",
    "confidence-low": "bg-red-50 text-red-800 ring-red-200",
    surveyed: "bg-teal-50 text-teal-900 ring-teal-200",
    settlement: "bg-violet-50 text-violet-900 ring-violet-200",
    neutral: "bg-slate-100 text-slate-600 ring-slate-200",
    "not-implemented": "bg-amber-50 text-amber-900 ring-amber-200",
    ready: "bg-emerald-50 text-emerald-800 ring-emerald-200",
} as const;

export type ReviewStatusBadgeVariant = keyof typeof VARIANT_STYLES;

export default function ReviewStatusBadge({
    variant,
    label,
    title,
}: {
    variant: ReviewStatusBadgeVariant;
    label: string;
    /** Native tooltip — full label and guidance for compact list badges. */
    title?: string;
}) {
    return (
        <span
            title={title}
            className={`inline-flex max-w-full items-center truncate rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${VARIANT_STYLES[variant]}`}
        >
            {label}
        </span>
    );
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
    return (
        <ReviewStatusBadge
            variant={verified ? "verified" : "unverified"}
            label={verified ? "Verified" : "Unverified"}
        />
    );
}

export function ConfidenceBadge({ score }: { score: number | null | undefined }) {
    const variant = confidenceBadgeVariant(score);
    const label =
        score === null || score === undefined || Number.isNaN(score) ? "—" : String(Math.round(score));
    return <ReviewStatusBadge variant={variant} label={label} />;
}
