import Link from "next/link";

import CoreReviewHeaderCard from "@/src/components/core-review/CoreReviewHeaderCard";
import CoreReviewPageShell from "@/src/components/core-review/CoreReviewPageShell";
import CoreReviewStatusBadge from "@/src/components/core-review/CoreReviewStatusBadge";
import { CORE_REVIEW_OVERVIEW_MODULES } from "@/src/components/core-review/coreReviewOverviewModules";
import type { CoreReviewOverviewStatus } from "@/src/features/core-review/config/entity-config-types";

function statusBadge(status: CoreReviewOverviewStatus) {
    if (status === "ready") {
        return <CoreReviewStatusBadge variant="ready" label="Ready" />;
    }
    if (status === "partial") {
        return <CoreReviewStatusBadge variant="not-implemented" label="Partial" />;
    }
    return <CoreReviewStatusBadge variant="neutral" label="TODO" />;
}

export default function CoreReviewOverviewPage() {
    return (
        <CoreReviewPageShell>
            <CoreReviewHeaderCard
                title="Core review"
                description="Production map data management from the core schema — verified entities ready for maps, search, and routing."
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {CORE_REVIEW_OVERVIEW_MODULES.map((module) => (
                    <Link
                        key={module.segment}
                        href={module.href}
                        className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                    >
                        <div className="mb-3 flex items-start justify-between gap-2">
                            <h2 className="text-lg font-semibold text-slate-900 group-hover:text-slate-950">
                                {module.title}
                            </h2>
                            {statusBadge(module.status)}
                        </div>
                        <p className="text-sm text-slate-600">{module.description}</p>
                        <span className="mt-4 inline-block text-sm font-medium text-sky-700 group-hover:text-sky-800">
                            Open module →
                        </span>
                    </Link>
                ))}
            </div>
        </CoreReviewPageShell>
    );
}
