"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import {
    applyTransportRoutePathReviewAction,
    applyTransportRouteReviewAction,
    applyTransportStopReviewAction,
    permanentDeleteTransportStop,
    deleteTransportRouteVariant,
    deleteTransportVariantPath,
    getTransportRouteDetail,
    getTransportRouteReviewReadiness,
    getTransportRouteVariants,
    getTransportVariantOrderedStops,
    getTransportVariantStops,
    getTransportVariantStopQuality,
    generateTransportVariantPathFromStops,
    putTransportVariantPath,
    removeTransportRouteStop,
    replaceTransportRouteStop,
    searchTransportStops,
    swapTransportRouteDirection,
    updateTransportRouteStop,
    updateTransportStopLocation,
} from "./api";
import PermanentDeleteStopDialog from "./PermanentDeleteStopDialog";
import { transportModeLabel } from "./constants";
import { getTransportDisplayNameFromNames } from "./naming";
import InsertRouteStopDialog, {
    type InsertStopContext,
} from "./InsertRouteStopDialog";
import RemoveRouteStopDialog from "./RemoveRouteStopDialog";
import SwapRouteDirectionDialog from "./SwapRouteDirectionDialog";
import { getRouteDirectionSwapPair } from "./routeDirectionSwap";
import ReviewMapCandidateCompareDialog from "./ReviewMapCandidateCompareDialog";
import { candidateDisplayName } from "./reviewMapCandidateDisplay";
import { useReviewMapNearbyCandidates } from "./useReviewMapNearbyCandidates";
import { useTransportStopRouteUsageDetail } from "./useTransportStopRouteUsageDetail";
import TransportStopUsageDialog, {
    type TransportStopUsageDialogMode,
} from "./TransportStopUsageDialog";
import {
    buildInsertAfterContext,
    buildInsertAtStartContext,
} from "./routeStopInsertContext";
import {
    buildRouteStopMutationUpdate,
    isValidOrderedStopsMutationResponse,
    orderedStopLiteToItem,
    resolveSelectedRouteStopIdAfterMutation,
    type ApplyRouteStopMutationOptions,
} from "./routeStopMutationHelpers";
import {
    formatReviewMapStopActionError,
    formatTransportStopMergeErrorOverlay,
    type ReviewMapActionToastState,
} from "./reviewMapActionFeedback";
import type { TransportStopMergeResultOverlayState } from "./stopMergeResultDisplay";
import TransportStopMergeResultOverlay from "./TransportStopMergeResultOverlay";
import { useSelectedStopRouteUsage } from "./useSelectedStopRouteUsage";
import GeneratePathFromStopsDialog from "./GeneratePathFromStopsDialog";
import TransportPreviewMap from "./TransportPreviewMap";
import TransportRouteReviewPanel from "./TransportRouteReviewPanel";
import TransportRouteReviewMapShell from "./TransportRouteReviewMapShell";
import TransportRouteMoreMetadataPanel from "./TransportRouteMoreMetadataPanel";
import { TransportRouteAdvancedDiagnosticsPanel } from "./TransportRouteAdvancedDiagnosticsPanel";
import {
    buildRouteReviewChecklist,
    AdvancedToolSection,
    CollapsibleSection,
    RouteDetailHeader,
    RouteReviewChecklistCard,
    RouteSummaryCard,
    RouteVariantsCard,
    TransportToolbarButton,
} from "./TransportRouteDetailCards";
import { evaluateGeneratePathFromStopsReadiness } from "./reviewMapPathGeneration";
import {
    isTransportNetworkError,
    logTransportReadinessFetchError,
} from "./transportFetchErrors";
import { routeStopItemsToPreviewStops, applyStopLocationDetailToRouteStops } from "./transportPreviewStops";
import {
    deriveReviewMapActiveDetail,
    reviewMapPreviewGeomForRouteStop,
    routeStopSavedGeom,
} from "./reviewMapSelectionState";
import {
    coordsToLineStringGeometry,
    deletePathVertex,
    pathCoordsEqual,
    type PathCoord,
} from "./reviewMapPathEdit";
import { isReviewMapPathEditMode, type ReviewMapMode } from "./reviewMapMode";
import { hasSavedRoutePathGeometry } from "./routePathDisplay";
import { TransportRouteEditForm, TransportVariantForm } from "./transportEditForms";
import { DuplicateBadge, GeometryBadge } from "./transportReviewUi";
import type {
    DuplicateStatus,
    RouteReviewReadiness,
    TransportNearbyStopCandidate,
    TransportRouteStopMutationResult,
    StopGeometryStatus,
    TransportRouteDetail,
    TransportRouteStopItem,
    TransportRoutePath,
    TransportStopMergeGlobalResult,
    TransportStopSearchItem,
    TransportVariantStopQualityItem,
    TransportVariantSummary,
} from "./types";

const MAP_DEFAULT_ZOOM = 11;

function stopQualityGeometryStatus(
    quality: TransportVariantStopQualityItem | undefined
): StopGeometryStatus {
    if (!quality || quality.lng === null || quality.lat === null) {
        return "missing";
    }
    return "manual";
}

function stopQualityDuplicateStatus(
    quality: TransportVariantStopQualityItem | undefined
): DuplicateStatus {
    if (!quality) {
        return "none";
    }
    if (quality.is_loop_closure) {
        return "none";
    }
    if (quality.is_exact_duplicate_in_variant) {
        return "duplicate_name";
    }
    if (quality.nearby_duplicate_count > 0) {
        return "nearby";
    }
    return "none";
}

const SELECT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

function ReplaceRouteStopDialog({
    routeStop,
    variantPublicId,
    mode,
    near,
    onClose,
    onReplaced,
}: {
    readonly routeStop: TransportRouteStopItem;
    readonly variantPublicId: string;
    readonly mode: string;
    readonly near: { lng: number; lat: number } | null;
    readonly onClose: () => void;
    readonly onReplaced: () => void;
}) {
    const [search, setSearch] = useState("");
    const [results, setResults] = useState<readonly TransportStopSearchItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setLoading(true);
            setError("");
            void (async () => {
                try {
                    const response = await searchTransportStops(
                        {
                            search: search.trim() || undefined,
                            mode,
                            nearLng: near?.lng,
                            nearLat: near?.lat,
                            radiusMeters: near ? 2000 : undefined,
                            excludeRouteVariantPublicId: variantPublicId,
                            limit: 25,
                        },
                        { signal: controller.signal }
                    );
                    setResults(response.items);
                } catch (err) {
                    if (isAbortError(err)) return;
                    setError(err instanceof Error ? err.message : "Search failed.");
                } finally {
                    setLoading(false);
                }
            })();
        }, 300);
        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [search, mode, near, variantPublicId]);

    const handleReplace = async () => {
        if (!selectedId) {
            setError("Select a replacement stop.");
            return;
        }
        setSaving(true);
        setError("");
        try {
            await replaceTransportRouteStop(
                routeStop.id,
                selectedId,
                reason.trim() || undefined
            );
            onReplaced();
            onClose();
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Replace failed.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
                <h3 className="text-sm font-semibold text-gray-900">Replace stop in route</h3>
                <p className="mt-1 text-xs text-gray-600">
                    Replace <span className="font-medium">{routeStop.stop.name}</span> with another
                    stop. Sequence and flags stay on this route membership.
                </p>

                <div className="mt-3 space-y-2">
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search stops by name or code…"
                        className={SELECT_CLASS}
                    />
                    <select
                        className={SELECT_CLASS}
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                    >
                        <option value="">
                            {loading ? "Searching…" : "Select replacement stop…"}
                        </option>
                        {results.map((item) => (
                            <option key={item.public_id} value={item.public_id}>
                                {item.display_name}
                                {item.distance_m !== null
                                    ? ` · ${Math.round(item.distance_m)} m`
                                    : ""}
                            </option>
                        ))}
                    </select>
                    <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (optional)"
                        className={SELECT_CLASS}
                    />
                </div>

                {error ? (
                    <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                        {error}
                    </p>
                ) : null}

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        disabled={saving}
                        onClick={onClose}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        disabled={saving || !selectedId}
                        onClick={() => void handleReplace()}
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                        {saving ? "Replacing…" : "Replace stop"}
                    </button>
                </div>
            </div>
        </div>
    );
}


const PICKUP_DROP_OPTIONS = [
    { value: 0, label: "0 · Regular" },
    { value: 1, label: "1 · None" },
    { value: 2, label: "2 · Phone agency" },
    { value: 3, label: "3 · Coordinate w/ driver" },
] as const;

function InfoRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
    return (
        <div className="flex justify-between gap-3 py-1 text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="text-right font-medium text-gray-900">{value}</span>
        </div>
    );
}

function formatDistance(meters: number | null): string {
    if (meters === null || !Number.isFinite(meters)) {
        return "—";
    }
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
}

/**
 * Extract ordered [lng, lat] vertices from a stored path geometry so an existing
 * path can seed the draft when editing. Handles LineString and MultiLineString
 * (first segment); returns [] for anything else. No snapping/simplification.
 */
function lineStringDraftCoords(
    geometry: { type: string; coordinates: unknown } | null,
): Array<[number, number]> {
    if (!geometry) return [];
    const isPair = (p: unknown): p is [number, number] =>
        Array.isArray(p) &&
        p.length >= 2 &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]);
    let raw: unknown = geometry.coordinates;
    if (geometry.type === "MultiLineString" && Array.isArray(raw)) {
        raw = raw[0];
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter(isPair).map((p) => [p[0], p[1]] as [number, number]);
}

/** Compact distance for inline stop-quality text; null when not measurable. */
function formatMetersShort(meters: number | null): string | null {
    if (meters === null || !Number.isFinite(meters)) {
        return null;
    }
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
}

/**
 * Build the one-line stop-quality summary, e.g. "450 m from previous · 38 m from
 * path" or "450 m from previous · no path". `variantHasPath` decides the path
 * clause: when the variant has no active path we surface "no path"; otherwise we
 * show the measured deviation (omitted when the stop itself has no location).
 */
function stopQualitySummary(
    quality: TransportVariantStopQualityItem | undefined,
    variantHasPath: boolean
): string | null {
    if (!quality) {
        return null;
    }
    const parts: string[] = [];
    const prev = formatMetersShort(quality.distance_from_previous_m);
    if (prev) {
        parts.push(`${prev} from previous`);
    }
    if (variantHasPath) {
        const fromPath = formatMetersShort(quality.distance_from_path_m);
        if (fromPath) {
            parts.push(`${fromPath} from path`);
        }
    } else {
        parts.push("no path");
    }
    return parts.length > 0 ? parts.join(" · ") : null;
}

/** Extracts a [lng, lat] point from a stop's GeoJSON, or null when unavailable. */
function pointOf(item: TransportRouteStopItem): { lng: number; lat: number } | null {
    const g = item.stop.geometry;
    if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) {
        return null;
    }
    const lng = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

export type TransportRouteDetailContentProps = {
    readonly publicId: string;
    /**
     * When provided, the header renders a back/close control that calls this
     * instead of linking to the routes list (used by the drawer host). When
     * omitted, a normal "← Back to routes" link is shown (full-page mode).
     */
    readonly onClose?: () => void;
    /** Called after any successful save/mutation so a host (e.g. list) can refresh. */
    readonly afterSave?: () => void;
    /**
     * Opens the transport stop detail drawer while keeping this route view mounted
     * (used from review map).
     */
    readonly onOpenStopDetail?: (stopPublicId: string) => void;
    /**
     * Hide the built-in header (back control + title block). Used when a host
     * (e.g. the drawer shell) already renders its own title/close chrome.
     */
    readonly hideHeader?: boolean;
};

/**
 * Route detail content (info, edit form, variants, selected variant, ordered
 * stops, persistent map preview, save/cancel). This is the page-shell-agnostic
 * body so it can render inside the full detail page or the Transport drawer.
 */
export default function TransportRouteDetailContent({
    publicId,
    onClose,
    afterSave,
    onOpenStopDetail,
    hideHeader = false,
}: TransportRouteDetailContentProps) {
    const [route, setRoute] = useState<TransportRouteDetail | null>(null);
    const [routeLoading, setRouteLoading] = useState(true);
    const [routeError, setRouteError] = useState("");

    const [variants, setVariants] = useState<readonly TransportVariantSummary[]>([]);
    const variantsRef = useRef(variants);
    variantsRef.current = variants;
    const stopsLoadedVariantRef = useRef<string | null>(null);
    const stopsLoadGenerationRef = useRef(0);
    const reviewMapCenterGetterRef = useRef<(() => { lng: number; lat: number } | null) | null>(
        null,
    );
    const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

    const [stops, setStops] = useState<readonly TransportRouteStopItem[]>([]);
    const [path, setPath] = useState<TransportRoutePath | null>(null);
    const [stopsLoading, setStopsLoading] = useState(false);
    const [stopsError, setStopsError] = useState("");
    // Read-only stop-quality signals keyed by route_stop_id. Loaded separately and
    // non-blocking: the ordered-stop list always renders even if this fails.
    const [stopQuality, setStopQuality] = useState<
        ReadonlyMap<string, TransportVariantStopQualityItem>
    >(new Map());
    const [stopQualityLoading, setStopQualityLoading] = useState(false);

    const [editingRoute, setEditingRoute] = useState(false);
    const [editingVariant, setEditingVariant] = useState(false);
    const [addingVariant, setAddingVariant] = useState(false);
    const [confirmDeleteVariant, setConfirmDeleteVariant] = useState(false);
    const [variantMutating, setVariantMutating] = useState(false);
    const [variantActionError, setVariantActionError] = useState("");
    const [swapDirectionOpen, setSwapDirectionOpen] = useState(false);
    const [swapDirectionError, setSwapDirectionError] = useState("");
    const [swapDirectionBusy, setSwapDirectionBusy] = useState(false);

    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
    const [stopMutating, setStopMutating] = useState(false);
    const [stopActionError, setStopActionError] = useState("");

    const [removeTarget, setRemoveTarget] = useState<TransportRouteStopItem | null>(null);
    const [removeReason, setRemoveReason] = useState("");
    const [replaceTarget, setReplaceTarget] = useState<TransportRouteStopItem | null>(null);
    const [stopReviewBusy, setStopReviewBusy] = useState<string | null>(null);

    const [insertContext, setInsertContext] = useState<InsertStopContext | null>(null);
    const [usageDialogTarget, setUsageDialogTarget] = useState<{
        publicId: string;
        name: string;
        mode: TransportStopUsageDialogMode;
    } | null>(null);
    const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<{
        publicId: string;
        name: string;
    } | null>(null);
    const [permanentDeleteError, setPermanentDeleteError] = useState("");
    const [permanentDeleting, setPermanentDeleting] = useState(false);
    const [candidateCompareTarget, setCandidateCompareTarget] =
        useState<TransportNearbyStopCandidate | null>(null);
    const [mergeCompareInitialCanonicalSide, setMergeCompareInitialCanonicalSide] = useState<
        "current" | "candidate"
    >("current");

    // --- Route path drawing (selected variant). ------------------------------
    // `pathMode` null = idle; "create"/"edit" = drawing. `draftPath` holds the
    // ordered [lng, lat] vertices being placed via map clicks.
    const [pathMode, setPathMode] = useState<"create" | "edit" | null>(null);
    const [draftPath, setDraftPath] = useState<Array<[number, number]>>([]);
    const [pathMutating, setPathMutating] = useState(false);
    const [pathError, setPathError] = useState("");
    const [confirmDeletePath, setConfirmDeletePath] = useState(false);

    const [reviewMapOpen, setReviewMapOpen] = useState(false);
    const [selectedRouteStopId, setSelectedRouteStopId] = useState<string | null>(null);
    /** Unsaved preview geometry keyed by route-stop occurrence id. */
    const [previewGeomByRouteStopId, setPreviewGeomByRouteStopId] = useState<
        Readonly<Record<string, { lng: number; lat: number }>>
    >({});
    const [reviewMapStopPreviewSaveBusy, setReviewMapStopPreviewSaveBusy] = useState(false);
    const [reviewMapToast, setReviewMapToast] = useState<ReviewMapActionToastState>(null);
    const reviewMapToastTimerRef = useRef<number | null>(null);
    const [mergeResultOverlay, setMergeResultOverlay] =
        useState<TransportStopMergeResultOverlayState>(null);
    const [reviewMapCenterStopRequest, setReviewMapCenterStopRequest] = useState<{
        id: number;
        stopId: string;
    } | null>(null);
    const [reviewMapMode, setReviewMapMode] = useState<ReviewMapMode>(null);
    const [reviewMapPathDraftCoords, setReviewMapPathDraftCoords] = useState<PathCoord[] | null>(
        null,
    );
    const [reviewMapPathBaselineCoords, setReviewMapPathBaselineCoords] = useState<
        PathCoord[] | null
    >(null);
    const [reviewMapSelectedPathVertexIndex, setReviewMapSelectedPathVertexIndex] = useState<
        number | null
    >(null);
    const [reviewMapPathEditLoading, setReviewMapPathEditLoading] = useState(false);
    const [reviewMapPathEditError, setReviewMapPathEditError] = useState("");
    const [generatePathOpen, setGeneratePathOpen] = useState(false);
    const [generatePathLoading, setGeneratePathLoading] = useState(false);
    const [generatePathError, setGeneratePathError] = useState("");
    const [generatePathWarnings, setGeneratePathWarnings] = useState<string[]>([]);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [readiness, setReadiness] = useState<RouteReviewReadiness | null>(null);
    const [readinessLoading, setReadinessLoading] = useState(false);
    const [readinessUnavailable, setReadinessUnavailable] = useState(false);

    const showReviewMapToast = useCallback((kind: "success" | "error", message: string) => {
        if (reviewMapToastTimerRef.current !== null) {
            window.clearTimeout(reviewMapToastTimerRef.current);
        }
        setReviewMapToast({ kind, message });
        reviewMapToastTimerRef.current = window.setTimeout(() => {
            setReviewMapToast(null);
            reviewMapToastTimerRef.current = null;
        }, 3200);
    }, []);

    const selectedRouteStop = useMemo(
        () =>
            selectedRouteStopId
                ? (stops.find((stop) => stop.id === selectedRouteStopId) ?? null)
                : null,
        [selectedRouteStopId, stops],
    );
    const selectedRouteStopPublicId = selectedRouteStop?.stop.public_id ?? null;
    const selectedStopRouteUsage = useSelectedStopRouteUsage(selectedRouteStopPublicId);
    const {
        loading: selectedStopRouteUsageLoading,
        deleteAllowed: selectedStopDeleteAllowed,
        blockMessage: selectedStopDeleteBlockMessage,
        reload: reloadSelectedStopRouteUsage,
    } = selectedStopRouteUsage;

    const selectedRouteStopName = useMemo(() => {
        if (!selectedRouteStop) {
            return null;
        }
        return (
            selectedRouteStop.stop.name_mm?.trim() ||
            selectedRouteStop.stop.name_en?.trim() ||
            selectedRouteStop.stop.name?.trim() ||
            null
        );
    }, [selectedRouteStop]);

    const savedGeom = useMemo(
        () => routeStopSavedGeom(selectedRouteStop),
        [selectedRouteStop],
    );

    const {
        candidates: nearbyCandidates,
        mapCandidates: nearbyMapCandidates,
        status: nearbyCandidatesStatus,
        selectedCandidateId: selectedNearbyCandidateId,
        setSelectedCandidateId: setSelectedNearbyCandidateId,
        searchAtMapClick: searchNearbyCandidatesAtMapClick,
        retrySearch: retryNearbyCandidates,
        revertToSavedSearch: revertNearbySearchToSaved,
    } = useReviewMapNearbyCandidates({
        enabled: reviewMapOpen && selectedRouteStopId !== null,
        routeStopId: selectedRouteStopId,
        stopPublicId: selectedRouteStopPublicId,
        stopMode: route?.mode ?? null,
        selectedName: selectedRouteStopName,
        savedCoords: savedGeom,
    });

    const { activeDetailStopId, activeDetailSource } = useMemo(
        () =>
            deriveReviewMapActiveDetail({
                selectedRouteStopPublicId,
                selectedNearbyCandidateId,
            }),
        [selectedNearbyCandidateId, selectedRouteStopPublicId],
    );

    const {
        summary: activeDetailUsageSummary,
        items: activeDetailUsageItems,
        loading: activeDetailUsageLoading,
        error: activeDetailUsageError,
    } = useTransportStopRouteUsageDetail({
        stopPublicId: activeDetailStopId,
        enabled: reviewMapOpen && activeDetailStopId !== null,
    });

    const loadReadiness = useCallback(async (signal?: AbortSignal) => {
        setReadinessLoading(true);
        setReadinessUnavailable(false);
        try {
            const result = await getTransportRouteReviewReadiness(
                publicId,
                signal ? { signal } : undefined,
            );
            setReadiness(result);
        } catch (err) {
            if (isAbortError(err)) return;
            logTransportReadinessFetchError(err, "Failed to load review readiness.");
            setReadiness(null);
            setReadinessUnavailable(true);
        } finally {
            setReadinessLoading(false);
        }
    }, [publicId]);

    // --- Load route detail + variants when publicId changes. -----------------
    useEffect(() => {
        const controller = new AbortController();
        setRouteLoading(true);
        setRouteError("");
        setRoute(null);
        setVariants([]);
        setSelectedVariantId(null);
        setStops([]);
        setPath(null);
        setStopsError("");
        setEditingRoute(false);
        setEditingVariant(false);
        setAddingVariant(false);
        setConfirmDeleteVariant(false);
        setVariantActionError("");
        setSelectedStopId(null);
        setStopActionError("");
        setRemoveTarget(null);
        setRemoveReason("");
        setReplaceTarget(null);
        setStopReviewBusy(null);
        setInsertContext(null);
        setUsageDialogTarget(null);
        setPermanentDeleteTarget(null);
        setPermanentDeleteError("");
        setPermanentDeleting(false);
        setPathMode(null);
        setDraftPath([]);
        setPathError("");
        setConfirmDeletePath(false);
        setReviewMapOpen(false);
        setSelectedRouteStopId(null);
        setAdvancedOpen(false);
        setReadiness(null);
        setReadinessUnavailable(false);

        void (async () => {
            try {
                const [detail, variantList] = await Promise.all([
                    getTransportRouteDetail(publicId, { signal: controller.signal }),
                    getTransportRouteVariants(publicId, { signal: controller.signal }),
                ]);
                setRoute(detail);
                setVariants(variantList.items);
                setSelectedVariantId(variantList.items[0]?.public_id ?? null);
            } catch (err) {
                if (isAbortError(err)) return;
                if (process.env.NODE_ENV === "development") {
                    console.warn("[transport] route detail:", err);
                }
                setRouteError(
                    isTransportNetworkError(err)
                        ? "Could not reach the API. Check that it is running, then retry."
                        : err instanceof Error && err.message.trim()
                          ? err.message
                          : "Failed to load route.",
                );
            } finally {
                setRouteLoading(false);
            }
        })();

        return () => controller.abort();
    }, [publicId]);

    useEffect(() => {
        if (routeLoading || !route) {
            return;
        }

        const controller = new AbortController();
        void loadReadiness(controller.signal);
        return () => controller.abort();
    }, [route, routeLoading, loadReadiness]);

    // --- Load the saved route path overlay for the selected variant. -----------
    //     to the ordered-stop panel: fetched separately and only when a path
    //     exists, so the panel never waits on path geometry serialization. A
    //     failure here is non-fatal (stops stay rendered). The tiny limit keeps
    //     the stops side of this read trivial — we only consume `.path`. --------
    const loadVariantPath = useCallback(
        async (variantId: string, signal: AbortSignal | undefined) => {
            try {
                const result = await getTransportVariantStops(
                    variantId,
                    { includePath: true, limit: 1 },
                    signal ? { signal } : undefined,
                );
                setPath(result.path ?? null);
            } catch (err) {
                if (isAbortError(err)) return;
                // Path overlay is optional; leave the loaded stops intact.
            }
        },
        [],
    );

    // --- Load ordered stops via the lightweight endpoint (no path geometry).
    //     `silent` skips the skeleton for in-place refreshes after a stop
    //     mutation so the list does not flash. The verified path overlay is
    //     loaded separately, only when the variant actually has one. ----------
    const loadStops = useCallback(
        async (
            variantId: string,
            signal: AbortSignal | undefined,
            silent: boolean,
        ): Promise<TransportRouteStopItem[] | null> => {
            const generation = ++stopsLoadGenerationRef.current;
            if (!silent) setStopsLoading(true);
            setStopsError("");
            try {
                const result = await getTransportVariantOrderedStops(
                    variantId,
                    signal ? { signal } : undefined,
                );
                if (generation !== stopsLoadGenerationRef.current) {
                    return null;
                }
                if (signal?.aborted) {
                    return null;
                }
                const items = result.ordered_stops.map(orderedStopLiteToItem);
                setStops(items);
                stopsLoadedVariantRef.current = variantId;
                const variantSummary = variantsRef.current.find((v) => v.public_id === variantId);
                const shouldLoadPath =
                    result.has_verified_path ||
                    result.has_review_placeholder_path ||
                    variantSummary?.path_status === "has_path";
                if (shouldLoadPath) {
                    void loadVariantPath(variantId, signal);
                } else {
                    setPath(null);
                }
                return items;
            } catch (err) {
                if (isAbortError(err)) return null;
                if (generation !== stopsLoadGenerationRef.current) {
                    return null;
                }
                setStops([]);
                setPath(null);
                setStopsError(err instanceof Error ? err.message : "Failed to load stops.");
                return null;
            } finally {
                if (!silent && generation === stopsLoadGenerationRef.current) {
                    setStopsLoading(false);
                }
            }
        },
        [loadVariantPath],
    );

    useEffect(() => {
        if (!selectedVariantId || !reviewMapOpen) {
            if (!reviewMapOpen) {
                setStopsLoading(false);
            }
            if (!selectedVariantId) {
                setStops([]);
                setPath(null);
                stopsLoadedVariantRef.current = null;
            }
            return;
        }
        if (
            stopsLoadedVariantRef.current === selectedVariantId &&
            stops.length > 0
        ) {
            return;
        }
        const controller = new AbortController();
        void loadStops(selectedVariantId, controller.signal, false);
        return () => controller.abort();
    }, [selectedVariantId, reviewMapOpen, loadStops]);

    /** Silent re-fetch of the current variant's stops (after a mutation). */
    const refreshStops = useCallback(async () => {
        if (!selectedVariantId) return;
        await loadStops(selectedVariantId, undefined, true);
    }, [selectedVariantId, loadStops]);

    // --- Load read-only stop-quality signals for the current ordered stops.
    //     Non-blocking and secondary to the ordered-stop list: a failure leaves
    //     the list fully usable (the quality lines/warnings just don't show). ---
    const loadStopQuality = useCallback(
        async (variantId: string, signal: AbortSignal | undefined) => {
            setStopQualityLoading(true);
            try {
                const result = await getTransportVariantStopQuality(
                    variantId,
                    signal ? { signal } : undefined,
                );
                const next = new Map<string, TransportVariantStopQualityItem>();
                for (const item of result.items) {
                    next.set(item.route_stop_id, item);
                }
                setStopQuality(next);
            } catch (err) {
                if (isAbortError(err)) return;
                setStopQuality(new Map());
            } finally {
                setStopQualityLoading(false);
            }
        },
        [],
    );

    // Signature of the current membership (ids + order) so quality reloads only
    // when stops are actually added/removed/reordered, not on every render.
    const stopsSignature = useMemo(
        () => stops.map((s) => `${s.id}:${s.stop_sequence}`).join(","),
        [stops],
    );

    useEffect(() => {
        if (!selectedVariantId || !reviewMapOpen || stopsSignature === "") {
            setStopQuality(new Map());
            setStopQualityLoading(false);
            return;
        }
        const controller = new AbortController();
        void loadStopQuality(selectedVariantId, controller.signal);
        return () => controller.abort();
    }, [selectedVariantId, reviewMapOpen, stopsSignature, loadStopQuality]);

    /**
     * Apply a route_stop mutation response locally: replace the ordered stops (so
     * the panel + map overlay update from the returned 1..N list) and adjust the
     * displayed counts (selected variant stop_count + route total) by the delta.
     * No detail/variants/stops refetch — the response carries everything needed.
     * Path geometry is left untouched (a membership edit never changes it).
     */
    const applyMutationResult = useCallback(
        (
            result: TransportRouteStopMutationResult,
            options?: ApplyRouteStopMutationOptions,
        ) => {
            if (
                Array.isArray(result.ordered_stops) &&
                !isValidOrderedStopsMutationResponse(
                    result.ordered_stops,
                    result.route_stop_count,
                )
            ) {
                if (process.env.NODE_ENV === "development") {
                    console.warn(
                        "[transport] invalid ordered_stops mutation response; refetching stops",
                        result,
                    );
                }
                void refreshStops();
                return;
            }

            const currentVariant = variants.find((v) => v.public_id === selectedVariantId);
            const update = buildRouteStopMutationUpdate(
                result,
                selectedVariantId,
                currentVariant?.stop_count,
            );
            if (!update) {
                void refreshStops();
                return;
            }

            stopsLoadGenerationRef.current += 1;
            setStops(update.orderedStops);
            if (update.variantId) {
                stopsLoadedVariantRef.current = update.variantId;
            }

            setSelectedRouteStopId((prev) =>
                resolveSelectedRouteStopIdAfterMutation(
                    prev,
                    update.orderedStops,
                    options,
                ),
            );
            if (!update.variantId) {
                return;
            }
            setVariants((prev) =>
                prev.map((v) =>
                    v.public_id === update.variantId
                        ? { ...v, stop_count: update.nextRouteStopCount }
                        : v,
                ),
            );
            if (update.stopCountDelta !== 0) {
                setRoute((r) =>
                    r
                        ? {
                              ...r,
                              counts: {
                                  ...r.counts,
                                  stops: Math.max(0, r.counts.stops + update.stopCountDelta),
                              },
                          }
                        : r,
                );
            }
        },
        [selectedVariantId, variants, refreshStops],
    );

    /** After a successful insert: update ordered stops + map overlay + counts locally. */
    const handleStopInserted = useCallback(
        (result: TransportRouteStopMutationResult) => {
            setInsertContext(null);
            applyMutationResult(result, {
                selectRouteStopId: result.created_stop?.route_stop_id ?? null,
            });
        },
        [applyMutationResult],
    );


    // --- Ordered stops as preview points (lng/lat + sequence + name). --------
    const reviewMapSavedRouteStops = useMemo(
        () => routeStopItemsToPreviewStops(stops),
        [stops],
    );

    const previewGeom = useMemo(
        () => reviewMapPreviewGeomForRouteStop(previewGeomByRouteStopId, selectedRouteStopId),
        [previewGeomByRouteStopId, selectedRouteStopId],
    );

    const hasUnsavedMove = previewGeom !== null;

    const generatePathReadiness = useMemo(
        () => evaluateGeneratePathFromStopsReadiness(stops, false),
        [stops],
    );

    const reviewMapPathDirty = useMemo(() => {
        if (!reviewMapPathDraftCoords || !reviewMapPathBaselineCoords) {
            return false;
        }
        return !pathCoordsEqual(reviewMapPathDraftCoords, reviewMapPathBaselineCoords);
    }, [reviewMapPathDraftCoords, reviewMapPathBaselineCoords]);

    const reviewMapPathDraftGeometry = useMemo(
        () => coordsToLineStringGeometry(reviewMapPathDraftCoords ?? []),
        [reviewMapPathDraftCoords],
    );

    const selectedVariant = variants.find((v) => v.public_id === selectedVariantId) ?? null;
    const directionSwapPair = useMemo(() => getRouteDirectionSwapPair(variants), [variants]);
    const pathIsVerified = path?.review_status === "verified";
    const pathIsReviewPlaceholder = Boolean(
        path?.geometry &&
            !pathIsVerified &&
            (path.path_kind === "corridor_estimate" || path.review_status === "needs_review"),
    );
    const usesPlaceholderReviewPoints = stops.some(
        (stop) => stop.geometry_source === "route_stop_review_geom",
    );
    const hasPathOverlay = Boolean(path?.geometry);

    // --- Lightweight, non-blocking stop-sequence quality warnings. -----------
    // Pure read-only hints derived from the loaded stops + path; they never
    // gate editing. Skipped while a variant is unselected or stops are loading.
    const sequenceWarnings = useMemo<string[]>(() => {
        if (!selectedVariantId || stopsLoading) {
            return [];
        }
        const warnings: string[] = [];
        if (stops.length === 0) {
            warnings.push("No ordered stops yet.");
            if (hasPathOverlay) {
                warnings.push("Route path exists but no ordered stops are linked.");
            }
            return warnings;
        }
        if (stops.length === 1) {
            warnings.push("Only one stop in this sequence.");
        }
        const seen = new Set<string>();
        for (const s of stops) {
            if (s.is_loop_closure) {
                continue;
            }
            if (seen.has(s.stop.public_id)) {
                warnings.push("Duplicate stop appears in this sequence.");
                break;
            }
            seen.add(s.stop.public_id);
        }
        if (!hasPathOverlay) {
            warnings.push("Stop sequence guide only — no saved route path for this variant.");
        } else if (pathIsReviewPlaceholder) {
            warnings.push("Placeholder route path — confirm stop locations in Review Map.");
        }
        return warnings;
    }, [selectedVariantId, stopsLoading, stops, hasPathOverlay, pathIsReviewPlaceholder]);

    const selectVariant = useCallback((variantId: string) => {
        setSelectedVariantId(variantId);
        stopsLoadedVariantRef.current = null;
        setStops([]);
        setPath(null);
        setStopQuality(new Map());
        setStopsLoading(true);
        setStopsError("");
        setSelectedRouteStopId(null);
        setEditingVariant(false);
        setConfirmDeleteVariant(false);
        setVariantActionError("");
        setSelectedStopId(null);
        setStopActionError("");
        setRemoveTarget(null);
        setRemoveReason("");
        setReplaceTarget(null);
        setStopReviewBusy(null);
        setInsertContext(null);
        setUsageDialogTarget(null);
        setPermanentDeleteTarget(null);
        setPermanentDeleteError("");
        setPathMode(null);
        setDraftPath([]);
        setPathError("");
        setConfirmDeletePath(false);
    }, []);

    const getInsertFallbackPlaceholderPoint = useCallback(() => {
        return reviewMapCenterGetterRef.current?.() ?? null;
    }, []);

    const openInsert = useCallback(
        (context: InsertStopContext) => {
            // Stop placement and path drawing both use map clicks — never both.
            if (pathMode !== null || isReviewMapPathEditMode(reviewMapMode)) return;
            setStopActionError("");
            setInsertContext(context);
        },
        [pathMode, reviewMapMode],
    );

    const handleReviewMapInsertAtStart = useCallback(() => {
        openInsert(buildInsertAtStartContext(stops));
    }, [openInsert, stops]);

    const handleReviewMapInsertAfter = useCallback(
        (stop: TransportRouteStopItem, stopIndex: number) => {
            openInsert(buildInsertAfterContext(stop, stops[stopIndex + 1] ?? null));
        },
        [openInsert, stops],
    );

    const handleReviewMapCheckRoutes = useCallback((stop: TransportRouteStopItem) => {
        setUsageDialogTarget({
            publicId: stop.stop.public_id,
            name: stop.stop.name,
            mode: "usage",
        });
    }, []);

    const handleReviewMapDeleteStop = useCallback((stop: TransportRouteStopItem) => {
        setUsageDialogTarget({
            publicId: stop.stop.public_id,
            name: stop.stop.name,
            mode: "delete",
        });
    }, []);

    const handleUsageDialogDisconnected = useCallback(
        (result: TransportRouteStopMutationResult) => {
            applyMutationResult(result);
            reloadSelectedStopRouteUsage();
            showReviewMapToast("success", "Stop disconnected from route");
        },
        [applyMutationResult, reloadSelectedStopRouteUsage, showReviewMapToast],
    );

    const handleRouteUsageChanged = useCallback(() => {
        reloadSelectedStopRouteUsage();
    }, [reloadSelectedStopRouteUsage]);

    const handlePermanentDeleteRequest = useCallback(() => {
        const target = usageDialogTarget;
        if (!target) {
            return;
        }
        setUsageDialogTarget(null);
        setPermanentDeleteError("");
        setPermanentDeleteTarget({
            publicId: target.publicId,
            name: target.name,
        });
    }, [usageDialogTarget]);

    const cancelPermanentDeleteStop = useCallback(() => {
        if (permanentDeleting) {
            return;
        }
        setPermanentDeleteTarget(null);
        setPermanentDeleteError("");
    }, [permanentDeleting]);

    const confirmPermanentDeleteStop = useCallback(() => {
        const target = permanentDeleteTarget;
        if (!target) {
            return;
        }
        void (async () => {
            setPermanentDeleting(true);
            setPermanentDeleteError("");
            try {
                await permanentDeleteTransportStop(target.publicId);
                setPermanentDeleteTarget(null);
                setSelectedRouteStopId(null);
                setSelectedStopId((prev) => {
                    const selected = stops.find((stop) => stop.stop.public_id === target.publicId);
                    return selected && prev === selected.id ? null : prev;
                });

                const removedFromVariant = stops.filter(
                    (stop) => stop.stop.public_id === target.publicId,
                );
                if (removedFromVariant.length > 0) {
                    stopsLoadGenerationRef.current += 1;
                    const removedCount = removedFromVariant.length;
                    setStops((prev) =>
                        prev.filter((stop) => stop.stop.public_id !== target.publicId),
                    );
                    if (selectedVariantId) {
                        setVariants((prev) =>
                            prev.map((v) =>
                                v.public_id === selectedVariantId
                                    ? {
                                          ...v,
                                          stop_count: Math.max(0, v.stop_count - removedCount),
                                      }
                                    : v,
                            ),
                        );
                    }
                    setRoute((r) =>
                        r
                            ? {
                                  ...r,
                                  counts: {
                                      ...r.counts,
                                      stops: Math.max(0, r.counts.stops - removedCount),
                                  },
                              }
                            : r,
                    );
                } else {
                    try {
                        const [detail, variantList] = await Promise.all([
                            getTransportRouteDetail(publicId),
                            getTransportRouteVariants(publicId),
                        ]);
                        setRoute(detail);
                        setVariants(variantList.items);
                    } catch {
                        // Count refresh is best-effort after permanent delete.
                    }
                }

                afterSave?.();
                showReviewMapToast("success", "Stop deleted successfully.");
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                setPermanentDeleteError(formatReviewMapStopActionError(err));
            } finally {
                setPermanentDeleting(false);
            }
        })();
    }, [permanentDeleteTarget, afterSave, showReviewMapToast, stops, selectedVariantId, publicId]);

    const cancelInsert = useCallback(() => {
        if (stopMutating) return;
        setInsertContext(null);
    }, [stopMutating]);

    const requestRemoveStop = useCallback((stop: TransportRouteStopItem) => {
        setStopActionError("");
        setRemoveReason("");
        setRemoveTarget(stop);
    }, []);

    const cancelRemoveStop = useCallback(() => {
        if (stopMutating) return;
        setRemoveTarget(null);
        setRemoveReason("");
        setStopActionError("");
    }, [stopMutating]);

    const confirmRemoveStop = useCallback(() => {
        const stop = removeTarget;
        if (!stop) return;
        void (async () => {
            setStopMutating(true);
            setStopActionError("");
            try {
                const result = await removeTransportRouteStop(stop.id, removeReason);
                // Close the dialog first. It is a full-screen overlay stacked above
                // the route drawer, so it must never linger if applying the result
                // below throws (otherwise the drawer can't be closed).
                setSelectedStopId((prev) => (prev === stop.id ? null : prev));
                setRemoveTarget(null);
                setRemoveReason("");
                applyMutationResult(result);
                reloadSelectedStopRouteUsage();
                showReviewMapToast("success", "Stop removed from route");
            } catch (err) {
                if (isAbortError(err)) return;
                setStopActionError(formatReviewMapStopActionError(err));
            } finally {
                setStopMutating(false);
            }
        })();
    }, [removeTarget, removeReason, applyMutationResult, showReviewMapToast, reloadSelectedStopRouteUsage]);

    /**
     * Update a single route_stop's flags. PATCH returns the updated row, so we
     * patch just that stop in local state (flags only — geometry/name/sequence are
     * unchanged) instead of refetching the whole ordered list or the routes list.
     */
    const updateStopFlag = useCallback(
        (
            stop: TransportRouteStopItem,
            body: { pickup_type?: number; drop_off_type?: number; is_timing_point?: boolean },
        ) => {
            void (async () => {
                setStopMutating(true);
                setStopActionError("");
                try {
                    const updated = await updateTransportRouteStop(stop.id, body);
                    setStops((prev) =>
                        prev.map((s) =>
                            s.id === stop.id
                                ? {
                                      ...s,
                                      pickup_type: updated.pickup_type,
                                      drop_off_type: updated.drop_off_type,
                                      is_timing_point: updated.is_timing_point,
                                  }
                                : s,
                        ),
                    );
                } catch (err) {
                    if (isAbortError(err)) return;
                    setStopActionError(
                        err instanceof Error ? err.message : "Stop action failed.",
                    );
                } finally {
                    setStopMutating(false);
                }
            })();
        },
        [],
    );

    const handleRouteSaved = useCallback(
        (updated: TransportRouteDetail) => {
            setRoute(updated);
            setEditingRoute(false);
            afterSave?.();
        },
        [afterSave],
    );

    const handleMetadataSaved = useCallback(
        (updated: TransportRouteDetail) => {
            setRoute(updated);
            afterSave?.();
        },
        [afterSave],
    );

    const handleRouteReviewUpdated = useCallback(
        (updated: TransportRouteDetail) => {
            setRoute(updated);
            afterSave?.();
        },
        [afterSave],
    );

    const markStopReviewed = useCallback(
        async (stopPublicId: string) => {
            setStopReviewBusy(stopPublicId);
            try {
                const result = await applyTransportStopReviewAction(stopPublicId, "mark_reviewed");
                setStops((prev) =>
                    prev.map((row) =>
                        row.stop.public_id === stopPublicId
                            ? {
                                  ...row,
                                  stop: { ...row.stop, review_status: result.review_status },
                              }
                            : row,
                    ),
                );
            } catch (err) {
                if (isAbortError(err)) return;
                showReviewMapToast("error", formatReviewMapStopActionError(err));
                throw err;
            } finally {
                setStopReviewBusy(null);
            }
        },
        [showReviewMapToast],
    );

    const markSelectedStopReviewed = useCallback(async () => {
        const row = selectedRouteStopId
            ? stops.find((stop) => stop.id === selectedRouteStopId)
            : null;
        if (!row) {
            return;
        }
        await markStopReviewed(row.stop.public_id);
        showReviewMapToast("success", "Stop marked reviewed");
    }, [selectedRouteStopId, stops, markStopReviewed, showReviewMapToast]);

    const markVariantPathReviewed = useCallback(async () => {
        if (!path?.id) {
            return;
        }
        const result = await applyTransportRoutePathReviewAction(path.id, "mark_reviewed");
        setPath((prev) => (prev ? { ...prev, review_status: result.review_status } : prev));
        void loadReadiness();
        showReviewMapToast("success", "Route path marked reviewed");
    }, [path, loadReadiness, showReviewMapToast]);

    const markRouteReviewed = useCallback(async () => {
        if (!route) {
            return;
        }
        const result = await applyTransportRouteReviewAction(route.public_id, "mark_reviewed");
        setRoute({ ...route, review_status: result.review_status });
        void loadReadiness();
        showReviewMapToast("success", "Route marked reviewed");
    }, [route, loadReadiness, showReviewMapToast]);

    const refreshOrderedStops = useCallback(async (): Promise<TransportRouteStopItem[] | null> => {
        if (!selectedVariantId) return null;
        const items = await loadStops(selectedVariantId, undefined, true);
        if (selectedVariantId) {
            try {
                const quality = await getTransportVariantStopQuality(selectedVariantId);
                setStopQuality(new Map(quality.items.map((item) => [item.route_stop_id, item])));
            } catch {
                // non-fatal
            }
        }
        return items;
    }, [selectedVariantId, loadStops]);

    /**
     * Refresh route detail + variants after a variant create/update/delete, keeping
     * the route open. `selectId` controls selection: a public_id selects it (new
     * variant), `null` falls back to the first remaining variant (after delete),
     * and `undefined` keeps the current selection when it still exists.
     */
    const reloadRouteAndVariants = useCallback(
        async (selectId?: string | null, options?: { refreshList?: boolean }) => {
            const [detail, variantList] = await Promise.all([
                getTransportRouteDetail(publicId),
                getTransportRouteVariants(publicId),
            ]);
            setRoute(detail);
            setVariants(variantList.items);
            setSelectedVariantId((prev) => {
                if (selectId !== undefined) {
                    return selectId ?? variantList.items[0]?.public_id ?? null;
                }
                return variantList.items.some((v) => v.public_id === prev)
                    ? prev
                    : (variantList.items[0]?.public_id ?? null);
            });
            if (options?.refreshList) {
                afterSave?.();
            }
        },
        [publicId, afterSave],
    );

    const handleVariantCreated = useCallback(
        (created: TransportVariantSummary) => {
            setAddingVariant(false);
            setVariantActionError("");
            void reloadRouteAndVariants(created.public_id, { refreshList: true });
        },
        [reloadRouteAndVariants],
    );

    const handleVariantSaved = useCallback(
        (updated: TransportVariantSummary) => {
            setEditingVariant(false);
            setVariantActionError("");
            // Keep the edited variant selected; refresh detail + variants.
            void reloadRouteAndVariants(updated.public_id, { refreshList: true });
        },
        [reloadRouteAndVariants],
    );

    const confirmDeleteSelectedVariant = useCallback(() => {
        if (!selectedVariantId) return;
        void (async () => {
            setVariantMutating(true);
            setVariantActionError("");
            try {
                await deleteTransportRouteVariant(selectedVariantId);
                setConfirmDeleteVariant(false);
                setEditingVariant(false);
                // Variant is gone — fall back to the first remaining variant.
                await reloadRouteAndVariants(null, { refreshList: true });
            } catch (err) {
                if (isAbortError(err)) return;
                setVariantActionError(
                    err instanceof Error ? err.message : "Failed to delete variant.",
                );
            } finally {
                setVariantMutating(false);
            }
        })();
    }, [selectedVariantId, reloadRouteAndVariants]);

    const confirmSwapRouteDirection = useCallback(() => {
        void (async () => {
            setSwapDirectionBusy(true);
            setSwapDirectionError("");
            try {
                const result = await swapTransportRouteDirection(publicId);
                setVariants(result.variants);
                setSwapDirectionOpen(false);
                setEditingVariant(false);
                setVariantActionError("");
                const keepId =
                    selectedVariantId &&
                    result.variants.some((variant) => variant.public_id === selectedVariantId)
                        ? selectedVariantId
                        : (result.variants[0]?.public_id ?? null);
                if (keepId) {
                    setSelectedVariantId(keepId);
                }
                afterSave?.();
            } catch (err) {
                if (isAbortError(err)) return;
                setSwapDirectionError(
                    err instanceof Error ? err.message : "Failed to swap direction.",
                );
            } finally {
                setSwapDirectionBusy(false);
            }
        })();
    }, [publicId, selectedVariantId, afterSave]);

    // --- Route path drawing handlers. ----------------------------------------
    const startCreatePath = useCallback(() => {
        setPathError("");
        setConfirmDeletePath(false);
        setDraftPath([]);
        setPathMode("create");
        setReviewMapOpen(true);
    }, []);

    const startEditPath = useCallback(() => {
        setPathError("");
        setConfirmDeletePath(false);
        setDraftPath(lineStringDraftCoords(path?.geometry ?? null));
        setPathMode("edit");
        setReviewMapOpen(true);
    }, [path]);

    const addDraftPoint = useCallback((coords: { lng: number; lat: number }) => {
        setDraftPath((prev) => [...prev, [coords.lng, coords.lat]]);
    }, []);

    const undoDraftPoint = useCallback(() => {
        setDraftPath((prev) => prev.slice(0, -1));
    }, []);

    const clearDraft = useCallback(() => {
        setDraftPath([]);
    }, []);

    const cancelPathEdit = useCallback(() => {
        if (pathMutating) return;
        setPathMode(null);
        setDraftPath([]);
        setPathError("");
    }, [pathMutating]);

    const savePath = useCallback(() => {
        if (!selectedVariantId) return;
        if (draftPath.length < 2) {
            setPathError("Add at least 2 points before saving.");
            return;
        }
        void (async () => {
            setPathMutating(true);
            setPathError("");
            try {
                const result = await putTransportVariantPath(selectedVariantId, {
                    coordinates: draftPath,
                    path_kind: "manual",
                });
                setPathMode(null);
                setDraftPath([]);
                setPath(result.path);
                setVariants((prev) =>
                    prev.map((variant) =>
                        variant.public_id === selectedVariantId ? result.variant : variant,
                    ),
                );
                void loadStopQuality(selectedVariantId, undefined);
            } catch (err) {
                if (isAbortError(err)) return;
                setPathError(
                    err instanceof Error ? err.message : "Failed to save route path.",
                );
            } finally {
                setPathMutating(false);
            }
        })();
    }, [selectedVariantId, draftPath, loadStopQuality]);

    const confirmDeletePathNow = useCallback(() => {
        if (!selectedVariantId) return;
        void (async () => {
            setPathMutating(true);
            setPathError("");
            try {
                const result = await deleteTransportVariantPath(selectedVariantId);
                setConfirmDeletePath(false);
                setPath(result.path);
                setVariants((prev) =>
                    prev.map((variant) =>
                        variant.public_id === selectedVariantId ? result.variant : variant,
                    ),
                );
                void loadStopQuality(selectedVariantId, undefined);
            } catch (err) {
                if (isAbortError(err)) return;
                setPathError(
                    err instanceof Error ? err.message : "Failed to delete route path.",
                );
            } finally {
                setPathMutating(false);
            }
        })();
    }, [selectedVariantId, loadStopQuality]);

    // Display title: Myanmar name → English name → route code. Never a raw/
    // generated/imported name (those stay in the Names / debug sections only).
    const routeDisplayName = route
        ? getTransportDisplayNameFromNames(route.name_mm, route.name_en, route.route_code)
        : "";

    const checklistItems = useMemo(
        () =>
            route
                ? buildRouteReviewChecklist({
                      route,
                      variants,
                      stopsWithoutLocation: stops.filter((s) => !s.stop.geometry).length,
                      stopsNeedingReview: stops.filter(
                          (s) => s.stop.review_status === "needs_review",
                      ).length,
                      usesPlaceholderReviewPoints,
                  })
                : [],
        [route, variants, stops, usesPlaceholderReviewPoints],
    );

    const toggleReviewMap = useCallback(() => {
        setReviewMapOpen((open) => {
            const next = !open;
            if (!next) {
                setSelectedRouteStopId(null);
            } else if (!selectedVariantId && variants[0]) {
                setSelectedVariantId(variants[0].public_id);
            }
            return next;
        });
    }, [selectedVariantId, variants]);

    const openReviewMapForVariant = useCallback(
        (variantId: string) => {
            selectVariant(variantId);
            setSelectedRouteStopId(null);
            setReviewMapOpen(true);
        },
        [selectVariant],
    );

    const closeReviewMap = useCallback(() => {
        setReviewMapOpen(false);
        setSelectedRouteStopId(null);
        setPreviewGeomByRouteStopId({});
        setReviewMapMode(null);
        setReviewMapPathDraftCoords(null);
        setReviewMapPathBaselineCoords(null);
        setReviewMapSelectedPathVertexIndex(null);
        setReviewMapPathEditError("");
        if (pathMode !== null) {
            setPathMode(null);
            setDraftPath([]);
            setPathError("");
            setConfirmDeletePath(false);
        }
    }, [pathMode]);

    const enterReviewMapEditPath = useCallback(() => {
        if (!hasSavedRoutePathGeometry(path) || pathMode !== null) {
            return;
        }
        const baseline = lineStringDraftCoords(path?.geometry ?? null);
        if (baseline.length < 2) {
            return;
        }
        setReviewMapMode("edit_path");
        setSelectedRouteStopId(null);
        setReviewMapPathDraftCoords(baseline);
        setReviewMapPathBaselineCoords(baseline);
        setReviewMapSelectedPathVertexIndex(null);
        setReviewMapPathEditError("");
    }, [path, pathMode]);

    const cancelReviewMapEditPath = useCallback(() => {
        setReviewMapMode(null);
        setReviewMapPathDraftCoords(null);
        setReviewMapPathBaselineCoords(null);
        setReviewMapSelectedPathVertexIndex(null);
        setReviewMapPathEditError("");
    }, []);

    const handleReviewMapPathDraftChange = useCallback((coords: PathCoord[]) => {
        setReviewMapPathDraftCoords(coords);
        setReviewMapPathEditError("");
    }, []);

    const deleteReviewMapSelectedPathVertex = useCallback(() => {
        if (reviewMapSelectedPathVertexIndex === null || !reviewMapPathDraftCoords) {
            return;
        }
        const next = deletePathVertex(reviewMapPathDraftCoords, reviewMapSelectedPathVertexIndex);
        if (!next) {
            setReviewMapPathEditError("Route path must keep at least 2 vertices.");
            return;
        }
        setReviewMapPathDraftCoords(next);
        setReviewMapSelectedPathVertexIndex(
            Math.min(reviewMapSelectedPathVertexIndex, next.length - 1),
        );
        setReviewMapPathEditError("");
    }, [reviewMapPathDraftCoords, reviewMapSelectedPathVertexIndex]);

    const saveReviewMapPathEdit = useCallback(() => {
        if (
            !selectedVariantId ||
            !reviewMapPathDraftCoords ||
            reviewMapPathEditLoading ||
            !reviewMapPathDirty
        ) {
            return;
        }
        if (reviewMapPathDraftCoords.length < 2) {
            setReviewMapPathEditError("Route path needs at least 2 vertices.");
            return;
        }

        void (async () => {
            setReviewMapPathEditLoading(true);
            setReviewMapPathEditError("");
            try {
                const result = await putTransportVariantPath(selectedVariantId, {
                    coordinates: reviewMapPathDraftCoords,
                    path_kind: "manual_drawn",
                    manually_adjusted: true,
                });
                setPath(result.path);
                setVariants((prev) =>
                    prev.map((variant) =>
                        variant.public_id === selectedVariantId ? result.variant : variant,
                    ),
                );
                cancelReviewMapEditPath();
                showReviewMapToast("success", "Route path saved");
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                setReviewMapPathEditError(
                    err instanceof Error ? err.message : "Failed to save route path.",
                );
            } finally {
                setReviewMapPathEditLoading(false);
            }
        })();
    }, [
        selectedVariantId,
        reviewMapPathDraftCoords,
        reviewMapPathDirty,
        reviewMapPathEditLoading,
        cancelReviewMapEditPath,
        showReviewMapToast,
    ]);

    const handleStopTimingUpdated = useCallback(
        (result: TransportRouteStopMutationResult) => {
            applyMutationResult(result);
        },
        [applyMutationResult],
    );

    const handleVariantDepartureTimeUpdated = useCallback(
        (result: TransportRouteStopMutationResult, departureTimeText: string | null) => {
            applyMutationResult(result);
            const variantPublicId = result.variant_public_id;
            if (!variantPublicId) {
                return;
            }
            setVariants((prev) =>
                prev.map((variant) =>
                    variant.public_id === variantPublicId
                        ? { ...variant, departure_time_text: departureTimeText }
                        : variant,
                ),
            );
        },
        [applyMutationResult],
    );

    const handleReviewMapCandidateMapClick = useCallback(
        (
            coords: { lng: number; lat: number },
            _options?: { immediate: boolean },
        ) => {
            if (!selectedRouteStopId || pathMode !== null || isReviewMapPathEditMode(reviewMapMode)) {
                return;
            }
            setPreviewGeomByRouteStopId((prev) => ({
                ...prev,
                [selectedRouteStopId]: coords,
            }));
            searchNearbyCandidatesAtMapClick(coords);
        },
        [searchNearbyCandidatesAtMapClick, selectedRouteStopId, pathMode, reviewMapMode],
    );

    useEffect(() => {
        setPreviewGeomByRouteStopId({});
    }, [selectedRouteStopId]);

    const handleReviewMapSaveStopPreview = useCallback(() => {
        if (!selectedRouteStopId || !selectedRouteStop || !previewGeom) {
            return;
        }
        const { lng, lat } = previewGeom;
        void (async () => {
            setReviewMapStopPreviewSaveBusy(true);
            try {
                const result = await updateTransportStopLocation(
                    selectedRouteStop.stop.public_id,
                    { lng, lat },
                );
                setStops((prev) =>
                    applyStopLocationDetailToRouteStops(
                        prev,
                        selectedRouteStopId,
                        result.stop,
                    ),
                );
                setPreviewGeomByRouteStopId((prev) => {
                    const next = { ...prev };
                    delete next[selectedRouteStopId];
                    return next;
                });
                revertNearbySearchToSaved();
                showReviewMapToast("success", "Stop location saved");
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                showReviewMapToast(
                    "error",
                    err instanceof Error ? err.message : "Failed to save stop location.",
                );
            } finally {
                setReviewMapStopPreviewSaveBusy(false);
            }
        })();
    }, [
        previewGeom,
        selectedRouteStopId,
        revertNearbySearchToSaved,
        selectedRouteStop,
        showReviewMapToast,
    ]);

    const handleReviewMapRevertStopPreview = useCallback(() => {
        if (!selectedRouteStopId || !previewGeom) {
            return;
        }
        setPreviewGeomByRouteStopId((prev) => {
            const next = { ...prev };
            delete next[selectedRouteStopId];
            return next;
        });
        revertNearbySearchToSaved();
    }, [previewGeom, selectedRouteStopId, revertNearbySearchToSaved]);

    const handleNearbyCandidateSelect = useCallback((publicId: string | null) => {
        setSelectedNearbyCandidateId(publicId);
    }, [setSelectedNearbyCandidateId]);

    const handleReviewMapCandidateCheckRoutes = useCallback(
        (candidate: TransportNearbyStopCandidate) => {
            setUsageDialogTarget({
                publicId: candidate.publicId,
                name: candidateDisplayName(candidate),
                mode: "usage",
            });
        },
        [],
    );

    const refreshReviewMapAfterGlobalMerge = useCallback(
        async (survivingStopPublicId: string) => {
            const refreshed = await refreshOrderedStops();
            const surviving = refreshed?.find(
                (row) => row.stop.public_id === survivingStopPublicId,
            );
            if (surviving) {
                setSelectedRouteStopId(surviving.id);
            }
            reloadSelectedStopRouteUsage();
        },
        [refreshOrderedStops, reloadSelectedStopRouteUsage],
    );

    const handleGlobalMergeError = useCallback((error: unknown) => {
        if (isAbortError(error)) {
            return;
        }
        const message = formatTransportStopMergeErrorOverlay(error);
        if (!message) {
            return;
        }
        setMergeResultOverlay({ kind: "error", message });
    }, []);

    const handleGlobalMergeSuccess = useCallback(
        async (result: TransportStopMergeGlobalResult, currentStopPublicId: string) => {
            setMergeResultOverlay({ kind: "success", result, currentStopPublicId });
            setSelectedNearbyCandidateId(null);
            setCandidateCompareTarget(null);
            await refreshReviewMapAfterGlobalMerge(result.canonicalStop.publicId);
        },
        [
            setSelectedNearbyCandidateId,
            refreshReviewMapAfterGlobalMerge,
        ],
    );

    const openMergeCompareDialog = useCallback(
        (candidate: TransportNearbyStopCandidate, canonicalSide: "current" | "candidate") => {
            setMergeCompareInitialCanonicalSide(canonicalSide);
            setCandidateCompareTarget(candidate);
        },
        [],
    );

    const handleReviewMapCandidateKeepCurrent = useCallback(() => {
        const candidate = nearbyCandidates.find((item) => item.publicId === selectedNearbyCandidateId);
        if (!candidate) {
            return;
        }
        openMergeCompareDialog(candidate, "current");
    }, [nearbyCandidates, selectedNearbyCandidateId, openMergeCompareDialog]);

    const handleReviewMapCandidateKeepCandidate = useCallback(
        (candidate: TransportNearbyStopCandidate) => {
            openMergeCompareDialog(candidate, "candidate");
        },
        [openMergeCompareDialog],
    );

    const handleReviewMapCandidateCompareMerge = useCallback(
        (candidate: TransportNearbyStopCandidate) => {
            openMergeCompareDialog(candidate, "current");
        },
        [openMergeCompareDialog],
    );

    const dismissMergeResultOverlay = useCallback(() => {
        setMergeResultOverlay(null);
    }, []);

    const reviewMapCandidateSearchHint = useMemo(() => {
        if (pathMode !== null || isReviewMapPathEditMode(reviewMapMode)) {
            return null;
        }
        if (selectedRouteStopId) {
            return "Click the map to move this stop preview (not saved) and search nearby candidates.";
        }
        return "Select a stop from the list to search nearby candidates";
    }, [pathMode, reviewMapMode, selectedRouteStopId]);

    const reviewMapPathEditHint = useMemo(() => {
        if (!isReviewMapPathEditMode(reviewMapMode)) {
            return null;
        }
        if (reviewMapSelectedPathVertexIndex !== null) {
            return "Drag the vertex, click the map to move it, or Delete to remove it";
        }
        return "Click a vertex to select it, or click the path line to add a vertex";
    }, [reviewMapMode, reviewMapSelectedPathVertexIndex]);

    const openGeneratePathDialog = useCallback(() => {
        if (!generatePathReadiness.eligible) {
            return;
        }
        setGeneratePathError("");
        setGeneratePathWarnings([]);
        setGeneratePathOpen(true);
    }, [generatePathReadiness.eligible]);

    const cancelGeneratePath = useCallback(() => {
        if (generatePathLoading) {
            return;
        }
        setGeneratePathOpen(false);
        setGeneratePathError("");
        setGeneratePathWarnings([]);
    }, [generatePathLoading]);

    const confirmGeneratePath = useCallback(() => {
        if (!selectedVariantId || !generatePathReadiness.eligible || generatePathLoading) {
            return;
        }

        void (async () => {
            setGeneratePathLoading(true);
            setGeneratePathError("");
            setGeneratePathWarnings([]);
            try {
                const result = await generateTransportVariantPathFromStops(selectedVariantId);
                setPath({
                    path_kind: result.path_kind,
                    review_status: result.review_status,
                    distance_m: result.distance_m,
                    geometry: result.geometry,
                });
                setGeneratePathWarnings(result.warnings ?? []);
                setGeneratePathOpen(false);
                showReviewMapToast(
                    "success",
                    result.warnings.length > 0
                        ? "Path generated with warnings"
                        : "Auto-generated path saved",
                );
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                const message =
                    err instanceof Error ? err.message : "Failed to generate path from stops.";
                if (
                    message.toLowerCase().includes("not implemented") ||
                    message.includes("501")
                ) {
                    setGeneratePathError("Not implemented");
                } else {
                    setGeneratePathError(message);
                }
            } finally {
                setGeneratePathLoading(false);
            }
        })();
    }, [generatePathLoading, generatePathReadiness.eligible, selectedVariantId, showReviewMapToast]);

    const toggleEditInfo = useCallback(() => {
        setEditingRoute((prev) => !prev);
    }, []);

    const reloadReadiness = useCallback(() => loadReadiness(), [loadReadiness]);

    return (
        <>
            {!hideHeader && !onClose ? (
                <div className="mb-3">
                    <Link
                        href={transportPath("routes")}
                        className="text-sm text-gray-500 hover:text-gray-900"
                    >
                        ← Back to routes
                    </Link>
                </div>
            ) : null}

            <RouteDetailHeader
                route={route}
                routeDisplayName={routeDisplayName}
                routeLoading={routeLoading}
                reviewMapOpen={reviewMapOpen}
                editingRoute={editingRoute}
                onReviewMap={toggleReviewMap}
                onEditInfo={toggleEditInfo}
                onClose={onClose}
            />

            {routeError ? (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {routeError}
                </div>
            ) : null}

            {editingRoute && route ? (
                <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                        Edit route info
                    </h2>
                    <TransportRouteEditForm
                        route={route}
                        onCancel={() => setEditingRoute(false)}
                        onSaved={handleRouteSaved}
                    />
                </section>
            ) : (
                <div className="mt-2 space-y-2.5">
                    <RouteSummaryCard route={route} routeLoading={routeLoading} />
                    <TransportRouteMoreMetadataPanel
                        route={route}
                        routeLoading={routeLoading}
                        onSaved={handleMetadataSaved}
                    />
                    <RouteVariantsCard
                        variants={variants}
                        routeLoading={routeLoading}
                        addingVariant={addingVariant}
                        onOpenReviewMap={openReviewMapForVariant}
                        directionSwapPair={directionSwapPair}
                        onChangeDirection={() => {
                            setSwapDirectionError("");
                            setSwapDirectionOpen(true);
                        }}
                        onStartAddVariant={() => {
                            setVariantActionError("");
                            setAddingVariant(true);
                        }}
                        addVariantSlot={
                            <TransportVariantForm
                                routePublicId={publicId}
                                onCancel={() => setAddingVariant(false)}
                                onSaved={handleVariantCreated}
                            />
                        }
                    />
                    <RouteReviewChecklistCard
                        items={checklistItems}
                        loading={routeLoading}
                        readinessUnavailable={readinessUnavailable}
                        onRetryReadiness={reloadReadiness}
                        readinessRetrying={readinessLoading}
                    />
                    <CollapsibleSection
                        title="Advanced / Diagnostics"
                        description="Review workflow, path tools, and raw import diagnostics."
                        open={advancedOpen}
                        onToggle={() => setAdvancedOpen((open) => !open)}
                    >
                        <TransportRouteAdvancedDiagnosticsPanel
                            routePublicId={publicId}
                            open={advancedOpen}
                            clientWarnings={sequenceWarnings}
                            onRefreshReadiness={reloadReadiness}
                        />
                        {route ? (
                            <TransportRouteReviewPanel
                                route={route}
                                path={path}
                                onRouteUpdated={handleRouteReviewUpdated}
                                readiness={readiness}
                                readinessLoading={readinessLoading}
                                readinessUnavailable={readinessUnavailable}
                                onReadinessReload={reloadReadiness}
                            />
                        ) : null}

                        {selectedVariantId ? (
                            <AdvancedToolSection
                                accent="blue"
                                title="Route path editor"
                                description="Create or edit the verified path for the selected variant."
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    {hasPathOverlay ? (
                                        <>
                                            <TransportToolbarButton
                                                onClick={startEditPath}
                                            >
                                                Edit path
                                            </TransportToolbarButton>
                                            <TransportToolbarButton
                                                variant="danger"
                                                onClick={() => {
                                                    setPathError("");
                                                    setConfirmDeletePath(true);
                                                }}
                                            >
                                                Delete path
                                            </TransportToolbarButton>
                                        </>
                                    ) : (
                                        <TransportToolbarButton onClick={startCreatePath}>
                                            Create path
                                        </TransportToolbarButton>
                                    )}
                                </div>
                                {pathError ? (
                                    <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                        {pathError}
                                    </p>
                                ) : null}
                                {pathMode ? (
                                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                                        <span className="text-xs text-slate-500">
                                            {draftPath.length} point
                                            {draftPath.length === 1 ? "" : "s"} — click the Review
                                            Map to place vertices
                                        </span>
                                        <span className="flex-1" />
                                        <TransportToolbarButton
                                            onClick={undoDraftPoint}
                                            disabled={pathMutating || draftPath.length === 0}
                                        >
                                            Undo
                                        </TransportToolbarButton>
                                        <TransportToolbarButton
                                            onClick={cancelPathEdit}
                                            disabled={pathMutating}
                                        >
                                            Cancel
                                        </TransportToolbarButton>
                                        <TransportToolbarButton
                                            variant="accent"
                                            onClick={savePath}
                                            disabled={pathMutating || draftPath.length < 2}
                                        >
                                            {pathMutating ? "Saving…" : "Save path"}
                                        </TransportToolbarButton>
                                    </div>
                                ) : null}
                            </AdvancedToolSection>
                        ) : null}

                        {selectedVariant ? (
                            <AdvancedToolSection
                                accent="amber"
                                title={`Variant maintenance · ${selectedVariant.variant_code}`}
                            >
                                {!editingVariant ? (
                                    <div className="mb-3 flex flex-wrap justify-end gap-2">
                                        <TransportToolbarButton
                                            onClick={() => {
                                                setVariantActionError("");
                                                setConfirmDeleteVariant(false);
                                                setEditingVariant(true);
                                            }}
                                        >
                                            Edit variant
                                        </TransportToolbarButton>
                                        <TransportToolbarButton
                                            variant="danger"
                                            onClick={() => {
                                                setVariantActionError("");
                                                setConfirmDeleteVariant(true);
                                            }}
                                        >
                                            Delete variant
                                        </TransportToolbarButton>
                                    </div>
                                ) : null}
                                {variantActionError ? (
                                    <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                                        {variantActionError}
                                    </p>
                                ) : null}
                                {confirmDeleteVariant && !editingVariant ? (
                                    <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3">
                                        <p className="text-sm text-red-800">
                                            Soft-delete variant{" "}
                                            <span className="font-medium">
                                                {selectedVariant.variant_code}
                                            </span>
                                            ? It is hidden and marked inactive; ordered stops and
                                            paths are kept.
                                        </p>
                                        <div className="mt-2 flex justify-end gap-2">
                                            <TransportToolbarButton
                                                onClick={() => setConfirmDeleteVariant(false)}
                                                disabled={variantMutating}
                                            >
                                                Cancel
                                            </TransportToolbarButton>
                                            <TransportToolbarButton
                                                variant="danger"
                                                onClick={confirmDeleteSelectedVariant}
                                                disabled={variantMutating}
                                            >
                                                {variantMutating ? "Deleting…" : "Delete variant"}
                                            </TransportToolbarButton>
                                        </div>
                                    </div>
                                ) : null}
                                {editingVariant ? (
                                    <TransportVariantForm
                                        key={selectedVariant.public_id}
                                        variant={selectedVariant}
                                        lockDirection={directionSwapPair !== null}
                                        onCancel={() => setEditingVariant(false)}
                                        onSaved={handleVariantSaved}
                                    />
                                ) : (
                                    <div className="divide-y divide-gray-100 text-sm">
                                        <InfoRow
                                            label="Direction"
                                            value={selectedVariant.direction_name ?? "—"}
                                        />
                                        <InfoRow
                                            label="Headsign"
                                            value={selectedVariant.headsign ?? "—"}
                                        />
                                        <InfoRow
                                            label="Confidence"
                                            value={
                                                selectedVariant.confidence_score === null
                                                    ? "—"
                                                    : Math.round(selectedVariant.confidence_score)
                                            }
                                        />
                                    </div>
                                )}
                            </AdvancedToolSection>
                        ) : null}
                    </CollapsibleSection>
                </div>
            )}

            <TransportRouteReviewMapShell
                open={reviewMapOpen}
                onExit={closeReviewMap}
                routeCode={route?.route_code ?? ""}
                routeDisplayName={routeDisplayName}
                routeMode={route?.mode ?? null}
                variants={variants}
                selectedVariantId={selectedVariantId}
                onVariantChange={selectVariant}
                stops={stops}
                stopsLoading={stopsLoading}
                stopsError={stopsError}
                routePathInfo={path}
                routeStops={reviewMapSavedRouteStops}
                mapAutoFitKey={selectedVariantId}
                selectedRouteStopId={selectedRouteStopId}
                previewGeom={previewGeom}
                hasUnsavedMove={hasUnsavedMove}
                stopPreviewSaveBusy={reviewMapStopPreviewSaveBusy}
                onSaveStopPreview={handleReviewMapSaveStopPreview}
                onRevertStopPreview={handleReviewMapRevertStopPreview}
                onSelectStop={setSelectedRouteStopId}
                actionToast={reviewMapToast}
                candidateSearchHint={reviewMapCandidateSearchHint}
                nearbyCandidates={nearbyMapCandidates}
                nearbyCandidateCount={nearbyCandidates.length}
                nearbyCandidatesStatus={nearbyCandidatesStatus}
                onRetryNearbyCandidates={retryNearbyCandidates}
                selectedCandidateId={selectedNearbyCandidateId}
                onCandidateSelect={handleNearbyCandidateSelect}
                onCandidateSearchRequest={
                    pathMode === null &&
                    !isReviewMapPathEditMode(reviewMapMode) &&
                    selectedRouteStopId
                        ? handleReviewMapCandidateMapClick
                        : undefined
                }
                onCandidateCheckRoutes={handleReviewMapCandidateCheckRoutes}
                onCandidateKeepCurrent={handleReviewMapCandidateKeepCurrent}
                onCandidateKeepCandidate={handleReviewMapCandidateKeepCandidate}
                onCandidateCompareMerge={handleReviewMapCandidateCompareMerge}
                activeDetailSource={activeDetailSource}
                activeDetailUsageSummary={activeDetailUsageSummary}
                activeDetailUsageItems={activeDetailUsageItems}
                activeDetailUsageLoading={activeDetailUsageLoading}
                activeDetailUsageError={activeDetailUsageError}
                draftPath={pathMode ? draftPath : null}
                pathDrawing={pathMode !== null}
                onDraftPathAddPoint={pathMode ? addDraftPoint : undefined}
                pathDrawingHint={
                    pathMode ? "Click the map to add path points" : null
                }
                canGeneratePathFromStops={generatePathReadiness.eligible}
                generatePathFromStopsDisabledReason={
                    generatePathReadiness.eligible
                        ? undefined
                        : generatePathReadiness.reasons.join(" ")
                }
                onGeneratePathFromStops={openGeneratePathDialog}
                reviewMapMode={reviewMapMode}
                canEditPath={hasSavedRoutePathGeometry(path)}
                pathEditDraftCoords={reviewMapPathDraftCoords}
                pathEditDraftGeometry={reviewMapPathDraftGeometry}
                pathEditHasUnsavedChanges={reviewMapPathDirty}
                selectedPathVertexIndex={reviewMapSelectedPathVertexIndex}
                onEnterEditPath={enterReviewMapEditPath}
                onCancelEditPath={cancelReviewMapEditPath}
                onSavePathEdit={saveReviewMapPathEdit}
                onExitEditPath={cancelReviewMapEditPath}
                onPathVertexSelect={setReviewMapSelectedPathVertexIndex}
                onPathEditDraftChange={handleReviewMapPathDraftChange}
                onDeleteSelectedPathVertex={deleteReviewMapSelectedPathVertex}
                pathEditLoading={reviewMapPathEditLoading}
                pathEditError={reviewMapPathEditError}
                pathEditHint={reviewMapPathEditHint}
                routeReviewStatus={route?.review_status ?? "needs_review"}
                routePathInfoForReview={path}
                reviewReadiness={readiness}
                onMarkStopReviewed={markSelectedStopReviewed}
                onMarkPathReviewed={markVariantPathReviewed}
                onMarkRouteReviewed={markRouteReviewed}
                onOpenStopDetail={onOpenStopDetail}
                onStopTimingUpdated={handleStopTimingUpdated}
                onVariantDepartureTimeUpdated={handleVariantDepartureTimeUpdated}
                centerStopRequest={reviewMapCenterStopRequest}
                insertDisabled={
                    pathMode !== null ||
                    isReviewMapPathEditMode(reviewMapMode) ||
                    stopMutating ||
                    !selectedVariantId
                }
                onInsertAtStart={handleReviewMapInsertAtStart}
                onInsertAfter={handleReviewMapInsertAfter}
                onRemoveFromRoute={requestRemoveStop}
                onCheckRoutes={handleReviewMapCheckRoutes}
                onDeleteStop={handleReviewMapDeleteStop}
                routeUsageLoading={selectedStopRouteUsageLoading}
                deleteStopAllowed={selectedStopDeleteAllowed}
                deleteBlockMessage={selectedStopDeleteBlockMessage}
                mapCenterGetterRef={reviewMapCenterGetterRef}
            />

            <GeneratePathFromStopsDialog
                open={generatePathOpen}
                isBusy={generatePathLoading}
                error={generatePathError}
                warnings={generatePathWarnings}
                onConfirm={confirmGeneratePath}
                onCancel={cancelGeneratePath}
            />


            <RemoveRouteStopDialog
                open={removeTarget !== null}
                stopName={removeTarget?.stop.name ?? ""}
                reason={removeReason}
                isBusy={stopMutating}
                error={stopActionError}
                onReasonChange={setRemoveReason}
                onConfirm={confirmRemoveStop}
                onCancel={cancelRemoveStop}
            />

            <TransportStopUsageDialog
                open={usageDialogTarget !== null}
                stopPublicId={usageDialogTarget?.publicId ?? null}
                stopName={usageDialogTarget?.name ?? ""}
                mode={usageDialogTarget?.mode ?? "usage"}
                activeVariantPublicId={selectedVariantId}
                onDisconnected={handleUsageDialogDisconnected}
                onRouteUsageChanged={handleRouteUsageChanged}
                onPermanentDeleteRequest={handlePermanentDeleteRequest}
                permanentDeleteLoading={permanentDeleting}
                deleteBlockMessage={selectedStopDeleteBlockMessage}
                deleteAllowed={selectedStopDeleteAllowed}
                onClose={() => setUsageDialogTarget(null)}
            />

            <PermanentDeleteStopDialog
                open={permanentDeleteTarget !== null}
                stopName={permanentDeleteTarget?.name ?? ""}
                isBusy={permanentDeleting}
                error={permanentDeleteError}
                onConfirm={confirmPermanentDeleteStop}
                onCancel={cancelPermanentDeleteStop}
            />

            <SwapRouteDirectionDialog
                open={swapDirectionOpen}
                pair={directionSwapPair}
                routeCode={route?.route_code ?? ""}
                isBusy={swapDirectionBusy}
                error={swapDirectionError}
                onConfirm={confirmSwapRouteDirection}
                onCancel={() => {
                    if (!swapDirectionBusy) {
                        setSwapDirectionOpen(false);
                        setSwapDirectionError("");
                    }
                }}
            />

            <InsertRouteStopDialog
                open={insertContext !== null}
                context={insertContext}
                variantPublicId={selectedVariantId}
                routeMode={route?.mode ?? null}
                onCancel={cancelInsert}
                onInserted={handleStopInserted}
                getFallbackPlaceholderPoint={getInsertFallbackPlaceholderPoint}
            />

            {replaceTarget && selectedVariantId && route ? (
                <ReplaceRouteStopDialog
                    routeStop={replaceTarget}
                    variantPublicId={selectedVariantId}
                    mode={route.mode}
                    near={pointOf(replaceTarget)}
                    onClose={() => setReplaceTarget(null)}
                    onReplaced={refreshOrderedStops}
                />
            ) : null}

            {candidateCompareTarget && selectedRouteStop ? (
                <ReviewMapCandidateCompareDialog
                    open
                    currentStopPublicId={selectedRouteStop.stop.public_id}
                    candidate={candidateCompareTarget}
                    initialCanonicalSide={mergeCompareInitialCanonicalSide}
                    onClose={() => setCandidateCompareTarget(null)}
                    onMergeSuccess={handleGlobalMergeSuccess}
                    onMergeError={handleGlobalMergeError}
                />
            ) : null}

            <TransportStopMergeResultOverlay
                state={mergeResultOverlay}
                onDismiss={dismissMergeResultOverlay}
            />
        </>
    );
}
