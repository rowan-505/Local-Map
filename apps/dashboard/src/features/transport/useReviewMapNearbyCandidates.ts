"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { getNearbyTransportStopCandidates } from "./api";
import {
    resolveReviewMapNearbySearchCenter,
    type ReviewMapCandidateSearchPoint,
    type ReviewMapNearbyCandidateSearchCenterSource,
    type ReviewMapNearbyCandidatesSearchStatus,
} from "./reviewMapNearbyCandidatesSearch";
import {
    REVIEW_MAP_NEARBY_SEARCH_DEBOUNCE_MS,
    shouldSearchNearbyImmediately,
} from "./reviewMapNearbySearchSchedule";
import type { TransportNearbyStopCandidate } from "./types";

const DEFAULT_RADIUS_METERS = 100 as const;

export { DEFAULT_RADIUS_METERS as REVIEW_MAP_NEARBY_CANDIDATES_RADIUS_METERS };
export { REVIEW_MAP_NEARBY_SEARCH_DEBOUNCE_MS };

export type { ReviewMapCandidateSearchPoint, ReviewMapNearbyCandidatesSearchStatus };

export function useReviewMapNearbyCandidates({
    enabled,
    routeStopId,
    stopPublicId,
    stopMode,
    selectedName,
    savedCoords,
}: {
    readonly enabled: boolean;
    /** Route-stop row id — resets candidate search when selection changes. */
    readonly routeStopId: string | null;
    readonly stopPublicId: string | null;
    readonly stopMode: string | null;
    readonly selectedName: string | null;
    readonly savedCoords: ReviewMapCandidateSearchPoint | null;
}) {
    const [candidates, setCandidates] = useState<readonly TransportNearbyStopCandidate[]>([]);
    const [status, setStatus] = useState<ReviewMapNearbyCandidatesSearchStatus>("idle");
    const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
    const [manualClickCoords, setManualClickCoords] =
        useState<ReviewMapCandidateSearchPoint | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<number | null>(null);
    const requestIdRef = useRef(0);
    const lastSearchCenterRef = useRef<ReviewMapCandidateSearchPoint | null>(null);
    const lastSearchSourceRef = useRef<ReviewMapNearbyCandidateSearchCenterSource | null>(null);

    const clearSchedule = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const abortInFlight = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        requestIdRef.current += 1;
    }, []);

    const beginSearch = useCallback(() => {
        clearSchedule();
        abortInFlight();
        setCandidates([]);
        setSelectedCandidateId(null);
        setStatus("loading");
    }, [abortInFlight, clearSchedule]);

    const resetSearchState = useCallback(() => {
        clearSchedule();
        abortInFlight();
        setCandidates([]);
        setSelectedCandidateId(null);
        setManualClickCoords(null);
        setStatus("idle");
        lastSearchCenterRef.current = null;
        lastSearchSourceRef.current = null;
    }, [abortInFlight, clearSchedule]);

    const resetForRouteStopChange = useCallback(() => {
        clearSchedule();
        abortInFlight();
        setCandidates([]);
        setSelectedCandidateId(null);
        setManualClickCoords(null);
        setStatus("loading");
        lastSearchCenterRef.current = null;
        lastSearchSourceRef.current = null;
    }, [abortInFlight, clearSchedule]);

    const runSearch = useCallback(
        (
            center: ReviewMapCandidateSearchPoint,
            source: ReviewMapNearbyCandidateSearchCenterSource,
            options: { readonly immediate: boolean },
        ) => {
            if (!enabled || !stopPublicId || !stopMode) {
                return;
            }

            lastSearchCenterRef.current = center;
            lastSearchSourceRef.current = source;
            beginSearch();

            const execute = async () => {
                const controller = new AbortController();
                abortRef.current = controller;
                const requestId = requestIdRef.current + 1;
                requestIdRef.current = requestId;

                try {
                    const result = await getNearbyTransportStopCandidates(
                        {
                            lat: center.lat,
                            lng: center.lng,
                            radiusMeters: DEFAULT_RADIUS_METERS,
                            mode: stopMode,
                            selectedStopId: stopPublicId,
                            selectedName: selectedName ?? undefined,
                        },
                        { signal: controller.signal },
                    );
                    if (requestId !== requestIdRef.current) {
                        return;
                    }
                    setCandidates(result.items);
                    setSelectedCandidateId(null);
                    setStatus(result.items.length > 0 ? "success" : "empty");
                } catch (error) {
                    if (isAbortError(error)) {
                        return;
                    }
                    if (requestId !== requestIdRef.current) {
                        return;
                    }
                    setCandidates([]);
                    setSelectedCandidateId(null);
                    setStatus("error");
                }
            };

            if (options.immediate) {
                void execute();
                return;
            }

            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                void execute();
            }, REVIEW_MAP_NEARBY_SEARCH_DEBOUNCE_MS);
        },
        [beginSearch, enabled, selectedName, stopMode, stopPublicId],
    );

    const { center: searchCenter, source: searchCenterSource } = useMemo(
        () =>
            resolveReviewMapNearbySearchCenter({
                manualClickCoords,
                savedCoords,
            }),
        [manualClickCoords, savedCoords],
    );

    const mapCandidates = useMemo(
        () => (status === "loading" ? [] : candidates),
        [candidates, status],
    );

    useEffect(() => {
        if (!enabled) {
            resetSearchState();
        }
    }, [enabled, resetSearchState]);

    useEffect(() => {
        if (!enabled) {
            return;
        }
        resetForRouteStopChange();
    }, [enabled, resetForRouteStopChange, routeStopId]);

    useEffect(() => {
        if (!enabled || !stopPublicId || !stopMode) {
            return;
        }
        if (!searchCenter || !searchCenterSource) {
            setStatus("idle");
            setCandidates([]);
            return;
        }

        runSearch(searchCenter, searchCenterSource, {
            immediate: shouldSearchNearbyImmediately(searchCenterSource),
        });

        return () => {
            clearSchedule();
        };
    }, [
        clearSchedule,
        enabled,
        runSearch,
        searchCenter?.lat,
        searchCenter?.lng,
        searchCenterSource,
        stopMode,
        stopPublicId,
    ]);

    useEffect(() => {
        return () => {
            clearSchedule();
            abortInFlight();
        };
    }, [abortInFlight, clearSchedule]);

    const searchAtMapClick = useCallback(
        (coords: ReviewMapCandidateSearchPoint) => {
            if (!enabled) {
                return;
            }
            // Do not beginSearch here — wait for debounced runSearch so rapid
            // map clicks collapse to one request without flashing empty results.
            setManualClickCoords(coords);
        },
        [enabled],
    );

    const retrySearch = useCallback(() => {
        const center = lastSearchCenterRef.current;
        const source = lastSearchSourceRef.current;
        if (!center || !source) {
            return;
        }
        runSearch(center, source, { immediate: true });
    }, [runSearch]);

    const revertToSavedSearch = useCallback(() => {
        setManualClickCoords(null);
        setSelectedCandidateId(null);
        if (!enabled || !savedCoords || !stopMode || !stopPublicId) {
            return;
        }
        runSearch(savedCoords, "saved", { immediate: true });
    }, [enabled, runSearch, savedCoords, stopMode, stopPublicId]);

    return {
        candidates,
        mapCandidates,
        status,
        loading: status === "loading",
        hasSearched: status === "success" || status === "empty" || status === "error",
        failed: status === "error",
        selectedCandidateId,
        setSelectedCandidateId,
        searchCenter,
        searchCenterSource,
        searchAtMapClick,
        retrySearch,
        revertToSavedSearch,
        resetSearchState,
    };
}
