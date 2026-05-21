"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import { CoreReviewLoadingCard, CoreReviewSuccessBanner } from "@/src/components/core-review/CoreReviewStateCard";
import CoreReviewPageShell from "@/src/components/core-review/CoreReviewPageShell";
import { useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import CoreReviewEntityPage from "../components/CoreReviewEntityPage";
import { CORE_REVIEW_PLACES_CONFIG } from "../config/entity-configs";

function CoreReviewPlacesPageInner() {
    const searchParams = useSearchParams();
    const { bumpPlaceTileVersion } = useDashboardTileVersions();
    const [successMessage, setSuccessMessage] = useState("");
    const editPlaceOpenId = searchParams.get("editPlace");

    useEffect(() => {
        const message =
            typeof window !== "undefined" ? window.sessionStorage.getItem("placeCreateSuccess") : null;
        if (message) {
            setSuccessMessage(message);
            sessionStorage.removeItem("placeCreateSuccess");
            bumpPlaceTileVersion();
        }
    }, [bumpPlaceTileVersion]);

    useEffect(() => {
        if (editPlaceOpenId && typeof window !== "undefined") {
            window.location.replace(coreReviewPath(`places/${editPlaceOpenId}/edit`));
        }
    }, [editPlaceOpenId]);

    const config = {
        ...CORE_REVIEW_PLACES_CONFIG,
        extensions: {
            headerActions: (
                <Link
                    href={coreReviewPath("places/new")}
                    className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                    Add Place
                </Link>
            ),
            wrapPage: (content: ReactNode) => (
                <>
                    {successMessage ? <CoreReviewSuccessBanner message={successMessage} /> : null}
                    {content}
                </>
            ),
        },
    };

    return <CoreReviewEntityPage config={config} />;
}

export default function CoreReviewPlacesPage() {
    return (
        <Suspense
            fallback={
                <CoreReviewPageShell>
                    <CoreReviewLoadingCard message="Loading places…" />
                </CoreReviewPageShell>
            }
        >
            <CoreReviewPlacesPageInner />
        </Suspense>
    );
}
