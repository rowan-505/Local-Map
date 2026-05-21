"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { DASHBOARD_STREET_MVT_SESSION_BUST_KEY } from "@/src/components/map/placeMapConfig";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import CoreReviewEntityPage from "../components/CoreReviewEntityPage";
import { CORE_REVIEW_STREETS_CONFIG } from "../config/entity-configs";

export default function CoreReviewRoadsPage() {
    const { bumpStreetTileVersion, bumpRoadLabelTileVersion } = useDashboardTileVersions();

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(DASHBOARD_STREET_MVT_SESSION_BUST_KEY);
            if (!raw) {
                return;
            }
            sessionStorage.removeItem(DASHBOARD_STREET_MVT_SESSION_BUST_KEY);
            bumpStreetTileVersion();
            bumpRoadLabelTileVersion();
        } catch {
            /* ignore */
        }
    }, [bumpRoadLabelTileVersion, bumpStreetTileVersion]);

    const config = {
        ...CORE_REVIEW_STREETS_CONFIG,
        extensions: {
            headerActions: (
                <Link
                    href={coreReviewPath("roads/new")}
                    className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                    Add Road
                </Link>
            ),
        },
    };

    return <CoreReviewEntityPage config={config} />;
}
