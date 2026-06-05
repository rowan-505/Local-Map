import type { ReactNode } from "react";

import { isDeprecatedCoreBusImportReviewFamily } from "@/src/features/import-review/utils/deprecatedCoreBusPromotion";

export function PromotionStatusBadge({ value }: { value: string | null | undefined }) {
    const label = value?.trim() || "(empty)";
    const v = label.toLowerCase();

    let className = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

    if (v === "approved") {
        className += " bg-emerald-50 text-emerald-800 ring-emerald-200";
    } else if (v === "promoted" || v === "batched") {
        className += " bg-sky-50 text-sky-800 ring-sky-200";
    } else if (v === "partially_promoted") {
        className += " bg-orange-50 text-orange-900 ring-orange-200";
    } else if (v === "needs_attention") {
        className += " bg-amber-50 text-amber-900 ring-amber-200";
    } else if (v === "invalid_empty_promoted") {
        className += " bg-red-50 text-red-800 ring-red-200";
    } else if (
        v === "partial" ||
        v === "partially_promoted" ||
        v === "partial promotion completed"
    ) {
        className += " bg-orange-50 text-orange-900 ring-orange-200";
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

const PUBLISH_ENTITY_FAMILY_LABELS: Record<string, string> = {
    buildings: "Buildings",
    places: "Places",
    landuse: "Landuse",
    water_lines: "Water lines",
    water_polygons: "Water polygons",
    bus_routes: "Bus routes",
    bus_route_variants: "Bus route variants",
    bus_route_stops: "Bus route stops",
    bus_stops: "Bus stops",
    roads: "Roads",
    addresses: "Addresses",
    admin_areas: "Admin areas",
    routing_barriers: "Routing barriers",
};

export function publishEntityFamilyLabel(family: string): string {
    return PUBLISH_ENTITY_FAMILY_LABELS[family] ?? family;
}

const HIGH_RISK_PUBLISH_ENTITY_FAMILIES = new Set([
    "roads",
    "addresses",
    "admin_areas",
    "routing_barriers",
]);

export function isHighRiskPublishEntityFamily(family: string): boolean {
    return HIGH_RISK_PUBLISH_ENTITY_FAMILIES.has(family);
}

function DeprecatedFamilyBadge() {
    return (
        <span className="inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 ring-1 ring-inset ring-slate-300">
            Deprecated
        </span>
    );
}

export function PublishEntityFamilyLabel({
    family,
    showHighRiskBadge = true,
    showDeprecatedBadge = true,
}: {
    family: string;
    showHighRiskBadge?: boolean;
    showDeprecatedBadge?: boolean;
}) {
    const label = publishEntityFamilyLabel(family);
    const deprecated = showDeprecatedBadge && isDeprecatedCoreBusImportReviewFamily(family);
    const highRisk = showHighRiskBadge && !deprecated && isHighRiskPublishEntityFamily(family);
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className={deprecated ? "text-gray-500" : undefined}>{label}</span>
            {deprecated ? <DeprecatedFamilyBadge /> : null}
            {highRisk ? (
                <span className="inline-flex rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800 ring-1 ring-inset ring-red-200">
                    High risk
                </span>
            ) : null}
        </span>
    );
}
