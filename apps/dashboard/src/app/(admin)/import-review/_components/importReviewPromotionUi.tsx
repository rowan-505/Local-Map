import type { ReactNode } from "react";

export function PromotionStatusBadge({ value }: { value: string | null | undefined }) {
    const label = value?.trim() || "(empty)";
    const v = label.toLowerCase();

    let className = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

    if (v === "approved") {
        className += " bg-emerald-50 text-emerald-800 ring-emerald-200";
    } else if (v === "promoted" || v === "batched") {
        className += " bg-sky-50 text-sky-800 ring-sky-200";
    } else if (v === "not_ready" || v === "ready") {
        className += " bg-amber-50 text-amber-900 ring-amber-200";
    } else if (v.includes("fail") || v === "rejected") {
        className += " bg-red-50 text-red-800 ring-red-200";
    } else if (v === "manual_protected" || v === "protect_manual") {
        className += " bg-violet-50 text-violet-800 ring-violet-200";
    } else if (v === "new_auto" || v === "matched_auto_update") {
        className += " bg-blue-50 text-blue-800 ring-blue-200";
    } else {
        className += " bg-gray-50 text-gray-700 ring-gray-200";
    }

    return <span className={className}>{label}</span>;
}

export function PromotionSectionHeading({
    id,
    title,
    subtitle,
}: {
    id?: string;
    title: string;
    subtitle?: string;
}) {
    return (
        <div>
            <h2 id={id} className="text-base font-semibold text-gray-900">
                {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-sm text-gray-600">{subtitle}</p> : null}
        </div>
    );
}

export function PromotionCardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`p-5 ${className}`}>{children}</div>;
}
