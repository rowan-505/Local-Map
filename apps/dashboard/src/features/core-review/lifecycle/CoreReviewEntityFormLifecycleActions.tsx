"use client";

import { useRouter } from "next/navigation";

import type { CoreReviewEntitySlug } from "@/src/lib/api";
import type { CoreEntityKey } from "@/src/lib/core-review/entityConfigs";

import CoreReviewRestoreButton from "./CoreReviewRestoreButton";
import CoreReviewSoftDeleteButton from "./CoreReviewSoftDeleteButton";
import { isCoreReviewRowDeleted } from "./coreReviewLifecycleUtils";

const ENTITY_KEY_TO_SLUG: Record<CoreEntityKey, CoreReviewEntitySlug> = {
    buildings: "buildings",
    places: "places",
    streets: "streets",
    "bus-stops": "bus-stops",
    "bus-routes": "bus-routes",
    "bus-route-variants": "bus-route-variants",
    landuse: "landuse",
    "water-lines": "water-lines",
    "water-polygons": "water-polygons",
    addresses: "addresses",
    "admin-areas": "admin-areas",
};

export default function CoreReviewEntityFormLifecycleActions({
    entityKey,
    recordId,
    detail,
    listRoute,
    onReload,
    onSuccess,
    onError,
}: {
    entityKey: CoreEntityKey;
    recordId: string;
    detail: Record<string, unknown> | null;
    listRoute: string;
    onReload: () => Promise<void>;
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
}) {
    const router = useRouter();
    const apiSlug = ENTITY_KEY_TO_SLUG[entityKey];
    const deleted = detail ? isCoreReviewRowDeleted(detail) : false;

    if (deleted) {
        return (
            <CoreReviewRestoreButton
                apiSlug={apiSlug}
                recordId={recordId}
                onSuccess={(message) => {
                    onSuccess?.(message);
                    void onReload();
                }}
                onError={onError}
            />
        );
    }

    return (
        <CoreReviewSoftDeleteButton
            apiSlug={apiSlug}
            recordId={recordId}
            onSuccess={(message) => {
                onSuccess?.(message);
                router.push(listRoute);
            }}
            onError={onError}
        />
    );
}
