import Link from "next/link";

import { getCoreReviewOverviewModuleByPath } from "@/src/components/core-review/coreReviewOverviewModules";
import type { CoreVerificationSupport } from "@/src/lib/api";

import {
    CoreReviewOverviewMetaBadges,
    coreReviewSourceSchemaFromTable,
} from "./coreReviewOverviewMeta";
import type { CoreReviewVerificationStatus } from "../verification/coreReviewVerificationFilter";

export const VERIFICATION_SUMMARY_STATUS_LABELS: Record<string, string> = {
    unverified: "Unverified",
    verified: "Verified",
    needs_fix: "Needs fix",
    questionable: "Questionable",
    rejected_after_core_review: "Rejected",
};

export const GLOBAL_STATUS_TOTALS_HINT =
    "Combined counts across all core review modules. Open a module card below to review records with this status.";

export type VerificationSummaryFamilyCard = {
    family: string;
    label: string;
    table: string;
    path: string;
    source_label?: string | null;
    total: number;
    unverified: number;
    verified: number;
    needs_fix: number;
    questionable: number;
    rejected_after_core_review: number;
    support: CoreVerificationSupport;
};

const COUNT_LINK_CLASS =
    "text-lg font-semibold text-sky-700 underline decoration-sky-200 underline-offset-2 hover:text-sky-800 hover:decoration-sky-400";

function SummaryCount({
    count,
    href,
    ariaLabel,
}: {
    count: number;
    href?: string;
    ariaLabel?: string;
}) {
    const formatted = count.toLocaleString();
    if (!href) {
        return <span className="text-lg font-semibold text-slate-900">{formatted}</span>;
    }
    return (
        <Link href={href} prefetch={false} className={COUNT_LINK_CLASS} aria-label={ariaLabel}>
            {formatted}
        </Link>
    );
}

export function VerificationSummaryTotalsGrid({
    totals,
    globalHint = GLOBAL_STATUS_TOTALS_HINT,
}: {
    totals: Record<string, number> | undefined;
    globalHint?: string;
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Object.entries(VERIFICATION_SUMMARY_STATUS_LABELS).map(([status, label]) => (
                <div
                    key={status}
                    title={globalHint}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">
                        {(totals?.[status] ?? 0).toLocaleString()}
                    </p>
                </div>
            ))}
        </div>
    );
}

export function VerificationSummaryFamilyCards({
    families,
    buildModuleHref,
    buildStatusHref,
    readOnly = false,
}: {
    families: VerificationSummaryFamilyCard[];
    buildModuleHref: (family: VerificationSummaryFamilyCard) => string;
    buildStatusHref?: (
        family: VerificationSummaryFamilyCard,
        status: CoreReviewVerificationStatus
    ) => string;
    readOnly?: boolean;
}) {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {families.map((family) => {
                const moduleHref = buildModuleHref(family);
                const statusHref = (status: CoreReviewVerificationStatus) =>
                    buildStatusHref?.(family, status);
                const moduleMeta = getCoreReviewOverviewModuleByPath(family.path);
                const sourceSchema = coreReviewSourceSchemaFromTable(family.table);
                const access = readOnly
                    ? "read-only"
                    : moduleMeta?.access ??
                      (family.support.verification_supported ? "editable" : "read-only");

                return (
                    <article
                        key={family.family}
                        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                        <h2 className="text-lg font-semibold text-slate-900">
                            <Link href={moduleHref} prefetch={false} className="hover:text-slate-950">
                                {family.label}
                            </Link>
                        </h2>
                        <CoreReviewOverviewMetaBadges
                            sourceTable={family.table}
                            sourceSchema={sourceSchema}
                            access={access}
                            className="mt-2"
                        />
                        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-slate-500">Total</dt>
                                <dd className="mt-0.5">
                                    <SummaryCount
                                        count={family.total}
                                        href={moduleHref}
                                        ariaLabel={`Open all ${family.label}`}
                                    />
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-slate-500">Unverified</dt>
                                <dd className="mt-0.5">
                                    <SummaryCount
                                        count={family.unverified}
                                        href={statusHref("unverified")}
                                        ariaLabel={`Open unverified ${family.label}`}
                                    />
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-slate-500">Verified</dt>
                                <dd className="mt-0.5">
                                    <SummaryCount
                                        count={family.verified}
                                        href={statusHref("verified")}
                                        ariaLabel={`Open verified ${family.label}`}
                                    />
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-slate-500">Needs fix</dt>
                                <dd className="mt-0.5">
                                    <SummaryCount
                                        count={family.needs_fix}
                                        href={statusHref("needs_fix")}
                                        ariaLabel={`Open ${family.label} needing fix`}
                                    />
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-slate-500">Questionable</dt>
                                <dd className="mt-0.5">
                                    <SummaryCount
                                        count={family.questionable}
                                        href={statusHref("questionable")}
                                        ariaLabel={`Open questionable ${family.label}`}
                                    />
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-slate-500">Rejected</dt>
                                <dd className="mt-0.5">
                                    <SummaryCount
                                        count={family.rejected_after_core_review}
                                        href={statusHref("rejected_after_core_review")}
                                        ariaLabel={`Open rejected ${family.label}`}
                                    />
                                </dd>
                            </div>
                        </dl>
                        <Link
                            href={moduleHref}
                            prefetch={false}
                            className="mt-4 inline-block text-sm font-medium text-sky-700 hover:text-sky-800"
                        >
                            Open module →
                        </Link>
                        {family.support.unsupported_reason ? (
                            <p className="mt-3 text-xs text-amber-700">{family.support.unsupported_reason}</p>
                        ) : null}
                    </article>
                );
            })}
        </div>
    );
}
