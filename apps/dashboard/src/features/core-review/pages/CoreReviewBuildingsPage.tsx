"use client";

import Link from "next/link";

import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import { CORE_REVIEW_BUILDINGS_CONFIG } from "../config/entity-configs";
import CoreReviewEntityPage from "../components/CoreReviewEntityPage";

export default function CoreReviewBuildingsPage() {
    const config = {
        ...CORE_REVIEW_BUILDINGS_CONFIG,
        extensions: {
            headerActions: (
                <Link
                    href={coreReviewPath("buildings/new")}
                    className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                    Add Building
                </Link>
            ),
        },
    };

    return <CoreReviewEntityPage config={config} />;
}
