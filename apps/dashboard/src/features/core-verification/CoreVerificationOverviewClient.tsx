"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import CoreReviewHeaderCard from "@/src/components/core-review/CoreReviewHeaderCard";
import CoreReviewPageShell from "@/src/components/core-review/CoreReviewPageShell";
import {
    getCoreVerificationSummary,
    type CoreVerificationSummaryResponse,
} from "@/src/lib/api";

const STATUS_LABELS: Record<string, string> = {
    unverified: "Unverified",
    verified: "Verified",
    needs_fix: "Needs fix",
    questionable: "Questionable",
    rejected_after_core_review: "Rejected",
};

export default function CoreVerificationOverviewClient() {
    const [summary, setSummary] = useState<CoreVerificationSummaryResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        getCoreVerificationSummary({ signal: controller.signal })
            .then(setSummary)
            .catch((err) => {
                if (err instanceof Error && err.name !== "AbortError") setError(err.message);
            });
        return () => controller.abort();
    }, []);

    return (
        <CoreReviewPageShell>
            <CoreReviewHeaderCard
                title="Core verification"
                description="Review promoted production rows, update verification status, and inspect source lineage without writing back to import review."
            />
            {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {Object.entries(STATUS_LABELS).map(([status, label]) => (
                    <div key={status} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">
                            {(summary?.totals?.[status] ?? 0).toLocaleString()}
                        </p>
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(summary?.families ?? []).map((family) => (
                    <Link
                        key={family.family}
                        href={`/dashboard/core-verification/${family.path}`}
                        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">{family.label}</h2>
                                <p className="mt-1 text-xs text-slate-500">{family.table}</p>
                            </div>
                            {!family.support.verification_supported ? (
                                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                                    Unsupported
                                </span>
                            ) : null}
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                            <div><dt className="text-slate-500">Total</dt><dd className="font-semibold">{family.total.toLocaleString()}</dd></div>
                            <div><dt className="text-slate-500">Unverified</dt><dd className="font-semibold">{family.unverified.toLocaleString()}</dd></div>
                            <div><dt className="text-slate-500">Needs fix</dt><dd className="font-semibold">{family.needs_fix.toLocaleString()}</dd></div>
                            <div><dt className="text-slate-500">Rejected</dt><dd className="font-semibold">{family.rejected_after_core_review.toLocaleString()}</dd></div>
                        </dl>
                        {family.support.unsupported_reason ? (
                            <p className="mt-3 text-xs text-amber-700">{family.support.unsupported_reason}</p>
                        ) : null}
                    </Link>
                ))}
            </div>
        </CoreReviewPageShell>
    );
}
