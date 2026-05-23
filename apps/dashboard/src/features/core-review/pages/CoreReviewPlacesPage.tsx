"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";

function readPlaceCreateSuccessMessage(): string {
    if (typeof window === "undefined") {
        return "";
    }
    const message = window.sessionStorage.getItem("placeCreateSuccess");
    if (message) {
        window.sessionStorage.removeItem("placeCreateSuccess");
        return message;
    }
    return "";
}

import { CoreReviewLoadingCard, CoreReviewSuccessBanner } from "@/src/components/core-review/CoreReviewStateCard";
import CoreReviewPageShell from "@/src/components/core-review/CoreReviewPageShell";
import { useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import CoreReviewEntityPage from "../components/CoreReviewEntityPage";
import { CORE_REVIEW_PLACES_CONFIG } from "../config/entity-configs";

function CoreReviewPlacesPageInner() {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const router = useRouter();
    const { bumpPlaceTileVersion } = useDashboardTileVersions();
    const [successMessage] = useState(readPlaceCreateSuccessMessage);
    const [deepLinkEditPlaceId] = useState(() => searchParams.get("editPlace"));

    useEffect(() => {
        if (successMessage) {
            bumpPlaceTileVersion();
        }
    }, [successMessage, bumpPlaceTileVersion]);

    useEffect(() => {
        if (!deepLinkEditPlaceId) {
            return;
        }
        const params = new URLSearchParams(searchParams.toString());
        params.delete("editPlace");
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, [deepLinkEditPlaceId, pathname, router, searchParams]);

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

    return (
        <CoreReviewEntityPage
            config={config}
            initialSelectedRowId={deepLinkEditPlaceId}
            initialDrawerMode={deepLinkEditPlaceId ? "edit" : "view"}
        />
    );
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
