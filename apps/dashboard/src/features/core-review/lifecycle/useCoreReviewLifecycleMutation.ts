"use client";

import { useCallback, useState } from "react";

import { useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { DASHBOARD_STREET_MVT_SESSION_BUST_KEY, scheduleBuildingTileRefresh } from "@/src/components/map/placeMapConfig";
import {
    restoreCoreReviewEntity,
    softDeleteCoreReviewEntity,
    type CoreReviewEntitySlug,
} from "@/src/lib/api";

import { coreReviewEntityLabel } from "./coreReviewLifecycleUtils";

function sanitizeLifecycleError(err: unknown): string {
    const raw = err instanceof Error ? err.message : "Request failed";
    const looksTechnical =
        raw.length > 400 ||
        /\b(pg_|postgresql|prisma|P1012|syntax error|violates|duplicate key|permission denied)/i.test(raw);
    return looksTechnical ? "Lifecycle action failed. Please try again." : raw;
}

export function useCoreReviewLifecycleMutation(apiSlug: CoreReviewEntitySlug) {
    const { bumpPlaceTileVersion, bumpBuildingTileVersion, bumpStreetTileVersion, bumpRoadLabelTileVersion } =
        useDashboardTileVersions();
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState("");

    const bumpTilesAfterLifecycle = useCallback(() => {
        if (apiSlug === "places") {
            bumpPlaceTileVersion();
            return;
        }
        if (apiSlug === "buildings") {
            const tileVersion = bumpBuildingTileVersion();
            scheduleBuildingTileRefresh(null, tileVersion);
            return;
        }
        if (apiSlug === "streets") {
            bumpStreetTileVersion();
            bumpRoadLabelTileVersion();
            try {
                sessionStorage.setItem(DASHBOARD_STREET_MVT_SESSION_BUST_KEY, String(Date.now()));
            } catch {
                /* ignore */
            }
        }
    }, [
        apiSlug,
        bumpBuildingTileVersion,
        bumpPlaceTileVersion,
        bumpRoadLabelTileVersion,
        bumpStreetTileVersion,
    ]);

    const runSoftDelete = useCallback(
        async (id: string) => {
            setIsBusy(true);
            setError("");
            try {
                await softDeleteCoreReviewEntity(apiSlug, id);
                bumpTilesAfterLifecycle();
                return {
                    ok: true as const,
                    message: `${coreReviewEntityLabel(apiSlug)} soft-deleted.`,
                };
            } catch (err) {
                const message = sanitizeLifecycleError(err);
                setError(message);
                return { ok: false as const, message };
            } finally {
                setIsBusy(false);
            }
        },
        [apiSlug, bumpTilesAfterLifecycle]
    );

    const runRestore = useCallback(
        async (id: string) => {
            setIsBusy(true);
            setError("");
            try {
                await restoreCoreReviewEntity(apiSlug, id);
                bumpTilesAfterLifecycle();
                return {
                    ok: true as const,
                    message: `${coreReviewEntityLabel(apiSlug)} restored.`,
                };
            } catch (err) {
                const message = sanitizeLifecycleError(err);
                setError(message);
                return { ok: false as const, message };
            } finally {
                setIsBusy(false);
            }
        },
        [apiSlug, bumpTilesAfterLifecycle]
    );

    return { isBusy, error, setError, runSoftDelete, runRestore };
}
