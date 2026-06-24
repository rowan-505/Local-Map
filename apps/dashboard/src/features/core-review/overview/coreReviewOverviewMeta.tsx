import type { CoreReviewOverviewAccess, CoreReviewOverviewSourceSchema } from "@/src/components/core-review/coreReviewOverviewModules";

const BADGE_BASE =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight";

export function coreReviewSourceSchemaFromTable(_table: string): CoreReviewOverviewSourceSchema {
    return "core";
}

export function CoreReviewOverviewSourceBadge({
    source,
    className = "",
}: {
    source: CoreReviewOverviewSourceSchema;
    className?: string;
}) {
    const styles = "border-slate-200 bg-slate-50 text-slate-800";

    return (
        <span className={`${BADGE_BASE} ${styles} ${className}`}>Source: {source}</span>
    );
}

export function CoreReviewOverviewAccessBadge({
    access,
    className = "",
}: {
    access: CoreReviewOverviewAccess;
    className?: string;
}) {
    const styles =
        access === "editable"
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-200 bg-amber-50 text-amber-900";

    return (
        <span className={`${BADGE_BASE} ${styles} ${className}`}>
            {access === "editable" ? "Editable" : "Read-only"}
        </span>
    );
}

export function CoreReviewOverviewMetaBadges({
    sourceTable,
    sourceSchema,
    access,
    className = "",
}: {
    sourceTable: string;
    sourceSchema: CoreReviewOverviewSourceSchema;
    access: CoreReviewOverviewAccess;
    className?: string;
}) {
    return (
        <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
            <span className="font-mono text-[11px] text-slate-500">{sourceTable}</span>
            <CoreReviewOverviewSourceBadge source={sourceSchema} />
            <CoreReviewOverviewAccessBadge access={access} />
        </div>
    );
}
