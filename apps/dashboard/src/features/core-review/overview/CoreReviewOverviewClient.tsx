"use client";

import CoreReviewHeaderCard from "@/src/components/core-review/CoreReviewHeaderCard";
import CoreReviewPageShell from "@/src/components/core-review/CoreReviewPageShell";
import { useCoreReviewVerificationSummary } from "@/src/features/core-review/hooks/useCoreReviewVerificationSummary";
import {
    coreReviewModuleHref,
    coreReviewStatusFilterHref,
} from "@/src/features/core-review/overview/coreReviewOverviewLinks";
import {
    GLOBAL_STATUS_TOTALS_HINT,
    VerificationSummaryFamilyCards,
    VerificationSummaryTotalsGrid,
} from "@/src/features/core-review/overview/verificationSummaryUi";

export default function CoreReviewOverviewClient() {
    const { data: summary, error: queryError, isLoading } = useCoreReviewVerificationSummary();
    const error = queryError instanceof Error ? queryError.message : queryError ? "Request failed." : null;

    return (
        <CoreReviewPageShell>
            <CoreReviewHeaderCard
                title="Core review"
                description="Production data management and verification for core entities."
            />

            {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
            ) : null}

            <section className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">Status totals</h2>
                <p className="text-sm text-slate-600">{GLOBAL_STATUS_TOTALS_HINT}</p>
                <VerificationSummaryTotalsGrid totals={summary?.totals} />
            </section>

            <section className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">Status by module</h2>
                <p className="text-sm text-slate-600">
                    Counts link to the module list with the matching status filter applied.
                </p>
                {isLoading && !summary ? (
                    <p className="text-sm text-slate-500">Loading summary…</p>
                ) : (
                    <VerificationSummaryFamilyCards
                        families={summary?.families ?? []}
                        buildModuleHref={(family) => coreReviewModuleHref(family.path)}
                        buildStatusHref={(family, status) => coreReviewStatusFilterHref(family.path, status)}
                    />
                )}
            </section>
        </CoreReviewPageShell>
    );
}
