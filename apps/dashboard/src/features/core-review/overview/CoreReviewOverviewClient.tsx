"use client";

import { useEffect, useState } from "react";

import CoreReviewHeaderCard from "@/src/components/core-review/CoreReviewHeaderCard";
import CoreReviewPageShell from "@/src/components/core-review/CoreReviewPageShell";
import {
    coreReviewModuleHref,
    coreReviewStatusFilterHref,
} from "@/src/features/core-review/overview/coreReviewOverviewLinks";
import {
    GLOBAL_STATUS_TOTALS_HINT,
    VerificationSummaryFamilyCards,
    VerificationSummaryTotalsGrid,
} from "@/src/features/core-review/overview/verificationSummaryUi";
import {
    getCoreReviewVerificationSummary,
    type CoreReviewVerificationSummaryResponse,
} from "@/src/lib/api";

export default function CoreReviewOverviewClient() {
    const [summary, setSummary] = useState<CoreReviewVerificationSummaryResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        getCoreReviewVerificationSummary({ signal: controller.signal })
            .then(setSummary)
            .catch((err) => {
                if (err instanceof Error && err.name !== "AbortError") setError(err.message);
            });
        return () => controller.abort();
    }, []);

    return (
        <CoreReviewPageShell>
            <CoreReviewHeaderCard
                title="Core review"
                description="Production data management and verification for core and core_transport entities."
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
                <VerificationSummaryFamilyCards
                    families={summary?.families ?? []}
                    buildModuleHref={(family) => coreReviewModuleHref(family.path)}
                    buildStatusHref={(family, status) => coreReviewStatusFilterHref(family.path, status)}
                />
            </section>
        </CoreReviewPageShell>
    );
}
