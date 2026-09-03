"use client";

import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState, type MutableRefObject, type UIEvent } from "react";

import TransportPreviewMap, { type TransportPreviewStop } from "./TransportPreviewMap";
import TransportMapLayerToggle from "./TransportMapLayerToggle";
import { useTransportDashboardBasemapMode } from "./transportBasemapMode";
import TransportReviewMapReviewActions from "./TransportReviewMapReviewActions";
import ReviewMapActionToast from "./ReviewMapActionToast";
import type { ReviewMapNearbyCandidatesSearchStatus } from "./reviewMapNearbyCandidatesSearch";
import ReviewMapStopInsertGap from "./ReviewMapStopInsertGap";
import ReviewMapStopTimingEditor from "./ReviewMapStopTimingEditor";
import { supportsVariantTimetable } from "@local-map/transport-timetable";
import ReviewMapVariantDepartureTimeEditor from "./ReviewMapVariantDepartureTimeEditor";
import {
    buildVariantTimetableSchedule,
    resolveVariantDepartureAnchor,
    type VariantTimetableStopSchedule,
} from "./routeStopTimetableDisplay";
import TransportRouteStopTimingRow from "./TransportRouteStopTimingRow";
import TransportStopContextCard, {
    type TransportStopContextCardMode,
} from "./TransportStopContextCard";
import { type TransportMapStopDetailCardAction } from "./TransportMapStopDetailCard";
import {
    calculatedTimetableRowHasDisplayData,
    getCalculatedTimetableRowSegments,
} from "./routeStopTimetableDisplay";
import { formatRouteUsageSummary } from "./routeUsageSummaryDisplay";
import { isReviewMapPathEditMode, type ReviewMapMode } from "./reviewMapMode";
import type { ReviewMapActionToastState } from "./reviewMapActionFeedback";
import {
    candidateRouteStopInsertDisabled,
    type CandidateRouteStopInsertPosition,
} from "./candidateRouteStopInsert";
import { DELETE_BLOCKED_MESSAGE } from "./TransportStopUsageDialog";
import type {
    GeoJsonGeometry,
    RouteReviewReadiness,
    TransportNearbyStopCandidate,
    TransportRouteStopMutationResult,
    TransportRoutePath,
    TransportRouteStopItem,
    TransportStopRouteUsageDetailItem,
    TransportStopRouteUsageSummary,
    TransportVariantSummary,
} from "./types";
import {
    hasSavedRoutePathGeometry,
    resolveRoutePathDisplayKind,
    routePathDisplayLabel,
    routePathLineStyle,
} from "./routePathDisplay";
import { generatePathFromStopsCopy } from "./reviewMapPathGeneration";
import {
    isCanonicalYbsRoute,
    oppositeYbsVariant,
    variantDirectionLabel,
    ybsVariantOptionLabel,
} from "./variantDirection";

const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

const NAV_BTN_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";

const TOOLBAR_BTN_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";

const TOOLBAR_GROUP_CLASS = "flex shrink-0 items-center gap-1.5";

const VIRTUAL_STOP_LIST_THRESHOLD = 150;
const VIRTUAL_STOP_ROW_HEIGHT = 64;
const VIRTUAL_STOP_INSERT_GAP_HEIGHT = 22;
const VIRTUAL_STOP_OVERSCAN = 8;

function stopRowStatus(stop: TransportRouteStopItem): string {
    if (!stop.stop.geometry) {
        return "No location";
    }
    if (stop.geometry_source === "route_stop_review_geom") {
        return "Review point";
    }
    if (stop.stop.review_status === "reviewed" || stop.stop.review_status === "verified") {
        return "Reviewed";
    }
    return "Saved";
}

/** Compact "+320 m" / "+1.2 km" distance-from-previous label. */
function formatDistanceFromPrev(meters: number): string {
    if (meters >= 1000) {
        return `+${(meters / 1000).toFixed(1)} km`;
    }
    return `+${Math.round(meters)} m`;
}

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function resolveNextStopId(
    stops: readonly TransportRouteStopItem[],
    selectedRouteStopId: string | null,
): string | null {
    if (stops.length === 0) {
        return null;
    }
    const idx = selectedRouteStopId ? stops.findIndex((s) => s.id === selectedRouteStopId) : -1;
    if (idx < 0) {
        return stops[0]?.id ?? null;
    }
    if (idx >= stops.length - 1) {
        return stops[idx]?.id ?? null;
    }
    return stops[idx + 1]?.id ?? null;
}

function resolvePrevStopId(
    stops: readonly TransportRouteStopItem[],
    selectedRouteStopId: string | null,
): string | null {
    if (stops.length === 0) {
        return null;
    }
    const idx = selectedRouteStopId ? stops.findIndex((s) => s.id === selectedRouteStopId) : stops.length;
    if (idx <= 0) {
        return stops[0]?.id ?? null;
    }
    return stops[idx - 1]?.id ?? null;
}

const ReviewMapStopRow = memo(function ReviewMapStopRow({
    stop,
    selected,
    movedUnsaved,
    distanceFromPrev,
    rowHeight,
    schedule,
    disabled = false,
    onSelect,
}: {
    readonly stop: TransportRouteStopItem;
    readonly selected: boolean;
    readonly movedUnsaved: boolean;
    readonly distanceFromPrev: string | null;
    readonly rowHeight: number;
    readonly schedule: VariantTimetableStopSchedule;
    readonly disabled?: boolean;
    readonly onSelect: (routeStopId: string) => void;
}) {
    const status = movedUnsaved ? "Moved, not saved" : stopRowStatus(stop);

    return (
        <button
            type="button"
            id={`review-map-stop-${stop.id}`}
            onClick={() => {
                if (!disabled) {
                    onSelect(stop.id);
                }
            }}
            disabled={disabled}
            style={{ height: rowHeight }}
            className={`flex w-full items-start border-b border-gray-100 px-3 py-1.5 text-left text-sm transition-colors ${
                disabled ? "cursor-not-allowed opacity-50" : "hover:bg-gray-50"
            } ${
                selected
                    ? "border-l-2 border-l-blue-600 bg-blue-50 ring-1 ring-inset ring-blue-300"
                    : movedUnsaved
                      ? "border-l-2 border-l-amber-400"
                      : ""
            }`}
        >
            <TransportRouteStopTimingRow
                stop={stop}
                schedule={schedule}
                selected={selected}
                movedUnsaved={movedUnsaved}
                statusText={status}
                distanceFromPrev={distanceFromPrev}
            />
        </button>
    );
});

function ReviewMapLayerControls({
    showStopSequenceGuide,
    onShowStopSequenceGuideChange,
    showRoutePath,
    onShowRoutePathChange,
    hasSavedRoutePath,
    routePathLabel,
    stacked = false,
}: {
    readonly showStopSequenceGuide: boolean;
    readonly onShowStopSequenceGuideChange: (checked: boolean) => void;
    readonly showRoutePath: boolean;
    readonly onShowRoutePathChange: (checked: boolean) => void;
    readonly hasSavedRoutePath: boolean;
    readonly routePathLabel: string;
    readonly stacked?: boolean;
}) {
    const layoutClass = stacked ? "flex flex-col gap-2" : "flex items-center gap-3";
    return (
        <div className={layoutClass}>
            <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-gray-700">
                <input
                    type="checkbox"
                    checked={showStopSequenceGuide}
                    onChange={(e) => onShowStopSequenceGuideChange(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                />
                <span title="Dashed line with arrows · not saved">Stop sequence guide</span>
            </label>
            <label
                className={`flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-700 ${
                    hasSavedRoutePath ? "cursor-pointer" : "cursor-not-allowed opacity-70"
                }`}
            >
                <input
                    type="checkbox"
                    checked={showRoutePath && hasSavedRoutePath}
                    disabled={!hasSavedRoutePath}
                    onChange={(e) => onShowRoutePathChange(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                />
                <span
                    title={
                        hasSavedRoutePath
                            ? `Saved route path · ${routePathLabel}`
                            : "No saved route path for this variant"
                    }
                >
                    {hasSavedRoutePath ? "Route path" : "Route path: No path"}
                </span>
            </label>
        </div>
    );
}

function ReviewMapPathControls({
    onGeneratePathFromStops,
    generatePathDisabled,
    generatePathTitle,
    generatePathButtonLabel,
    onEnterEditPath,
    editPathDisabled,
    editPathTitle,
    pathEditActive,
    stacked = false,
}: {
    readonly onGeneratePathFromStops?: () => void;
    readonly generatePathDisabled: boolean;
    readonly generatePathTitle: string;
    readonly generatePathButtonLabel: string;
    readonly onEnterEditPath?: () => void;
    readonly editPathDisabled: boolean;
    readonly editPathTitle: string;
    readonly pathEditActive: boolean;
    readonly stacked?: boolean;
}) {
    const layoutClass = stacked ? "flex flex-col gap-1.5" : "flex items-center gap-1.5";
    return (
        <div className={layoutClass}>
            {onGeneratePathFromStops ? (
                <button
                    type="button"
                    onClick={onGeneratePathFromStops}
                    disabled={generatePathDisabled}
                    title={generatePathTitle}
                    className={`${TOOLBAR_BTN_CLASS} ${stacked ? "w-full text-left" : ""}`}
                >
                    {generatePathButtonLabel}
                </button>
            ) : null}
            {onEnterEditPath && !pathEditActive ? (
                <button
                    type="button"
                    onClick={onEnterEditPath}
                    disabled={editPathDisabled}
                    title={editPathTitle}
                    className={`${TOOLBAR_BTN_CLASS} ${stacked ? "w-full text-left" : ""}`}
                >
                    Edit path
                </button>
            ) : null}
        </div>
    );
}

export type TransportRouteReviewMapShellProps = {
    readonly canWrite: boolean;
    readonly open: boolean;
    readonly onExit: () => void;
    readonly routeCode: string;
    readonly routeDisplayName: string;
    readonly routeMode?: string | null;
    readonly variants: readonly TransportVariantSummary[];
    readonly selectedVariantId: string | null;
    readonly onVariantChange: (variantPublicId: string) => void;
    readonly stops: readonly TransportRouteStopItem[];
    readonly stopsLoading: boolean;
    readonly stopsError: string;
    readonly routePathInfo: TransportRoutePath | null;
    readonly routeStops: readonly TransportPreviewStop[];
    readonly mapAutoFitKey: string | null;
    /** Route occurrence id (`transport.route_stops.id`) — not a nearby candidate. */
    readonly selectedRouteStopId: string | null;
    /** Unsaved map-click geometry for the selected route stop. */
    readonly previewGeom?: { lng: number; lat: number } | null;
    readonly hasUnsavedMove?: boolean;
    readonly stopPreviewSaveBusy?: boolean;
    readonly onSaveStopPreview?: () => void;
    readonly onRevertStopPreview?: () => void;
    readonly onSelectStop: (routeStopId: string | null) => void;
    readonly actionToast?: ReviewMapActionToastState;
    readonly candidateSearchHint?: string | null;
    readonly nearbyCandidates?: readonly TransportNearbyStopCandidate[];
    readonly nearbyCandidateCount?: number;
    readonly nearbyCandidatesStatus?: ReviewMapNearbyCandidatesSearchStatus;
    readonly onRetryNearbyCandidates?: () => void;
    readonly selectedCandidateId?: string | null;
    readonly onCandidateSelect?: (publicId: string | null) => void;
    readonly onCandidateSearchRequest?: (
        coords: { lng: number; lat: number },
        options: { immediate: boolean },
    ) => void;
    readonly onCandidateCheckRoutes?: (candidate: TransportNearbyStopCandidate) => void;
    readonly onCandidateInsert?: (
        candidate: TransportNearbyStopCandidate,
        position: CandidateRouteStopInsertPosition,
    ) => void;
    readonly onCandidateKeepCurrent?: () => void;
    readonly onCandidateKeepCandidate?: (candidate: TransportNearbyStopCandidate) => void;
    readonly onCandidateCompareMerge?: (candidate: TransportNearbyStopCandidate) => void;
    readonly candidateActionBusy?: boolean;
    /** Which entity drives the detail card content. */
    readonly activeDetailSource?: "route_stop" | "nearby_candidate" | null;
    readonly activeDetailUsageSummary?: TransportStopRouteUsageSummary | null;
    readonly activeDetailUsageItems?: readonly TransportStopRouteUsageDetailItem[];
    readonly activeDetailUsageLoading?: boolean;
    readonly activeDetailUsageError?: string | null;
    readonly draftPath?: ReadonlyArray<[number, number]> | null;
    readonly pathDrawing?: boolean;
    readonly onDraftPathAddPoint?: (coords: { lng: number; lat: number }) => void;
    readonly pathDrawingHint?: string | null;
    readonly canGeneratePathFromStops?: boolean;
    readonly generatePathFromStopsDisabledReason?: string;
    readonly onGeneratePathFromStops?: () => void;
    readonly reviewMapMode?: ReviewMapMode;
    readonly canEditPath?: boolean;
    readonly pathEditDraftCoords?: ReadonlyArray<[number, number]> | null;
    readonly pathEditDraftGeometry?: GeoJsonGeometry | null;
    readonly pathEditHasUnsavedChanges?: boolean;
    readonly selectedPathVertexIndex?: number | null;
    readonly onEnterEditPath?: () => void;
    readonly onCancelEditPath?: () => void;
    readonly onSavePathEdit?: () => void;
    readonly onExitEditPath?: () => void;
    readonly onPathVertexSelect?: (vertexIndex: number) => void;
    readonly onPathEditDraftChange?: (coords: Array<[number, number]>) => void;
    readonly onAddPathVertex?: () => void;
    readonly onUndoPathEdit?: () => void;
    readonly canUndoPathEdit?: boolean;
    readonly onDeleteSelectedPathVertex?: () => void;
    readonly pathEditLoading?: boolean;
    readonly pathEditError?: string;
    readonly pathEditHint?: string | null;
    readonly routeReviewStatus?: string;
    readonly routePathInfoForReview?: TransportRoutePath | null;
    readonly reviewReadiness?: RouteReviewReadiness | null;
    readonly onMarkStopReviewed?: () => Promise<void>;
    readonly onMarkPathReviewed?: () => Promise<void>;
    readonly onMarkRouteReviewed?: () => Promise<void>;
    /** Opens the transport stop detail drawer for the selected stop's public id. */
    readonly onOpenStopDetail?: (stopPublicId: string) => void;
    /** Called after timing fields are saved for a route stop row. */
    readonly onStopTimingUpdated?: (result: TransportRouteStopMutationResult) => void;
    /** Called after variant departure time is saved. */
    readonly onVariantDepartureTimeUpdated?: (
        result: TransportRouteStopMutationResult,
        departureTimeText: string | null,
    ) => void;
    /** Increment id to center the map on stopId after Save & Next. */
    readonly centerStopRequest?: { readonly id: number; readonly stopId: string } | null;
    readonly insertDisabled?: boolean;
    readonly onInsertAtStart?: () => void;
    readonly onInsertAfter?: (stop: TransportRouteStopItem, stopIndex: number) => void;
    readonly onRemoveFromRoute?: (stop: TransportRouteStopItem) => void;
    readonly onCheckRoutes?: (stop: TransportRouteStopItem) => void;
    readonly onDeleteStop?: (stop: TransportRouteStopItem) => void;
    readonly routeUsageLoading?: boolean;
    readonly deleteStopAllowed?: boolean;
    readonly deleteBlockMessage?: string | null;
    readonly pickingInsertLocation?: boolean;
    readonly insertPickPoint?: { readonly lng: number; readonly lat: number } | null;
    readonly onInsertPickPointChange?: (coords: { lng: number; lat: number }) => void;
    readonly mapCenterGetterRef?: MutableRefObject<
        (() => { lng: number; lat: number } | null) | null
    >;
};

/**
 * Fullscreen review-map overlay for a route variant. Mounts one MapLibre instance
 * while open; unmounts on exit so the basemap is not kept alive behind the drawer.
 */
export default function TransportRouteReviewMapShell({
    canWrite,
    open,
    onExit,
    routeCode,
    routeDisplayName,
    routeMode = null,
    variants,
    selectedVariantId,
    onVariantChange,
    stops,
    stopsLoading,
    stopsError,
    routePathInfo,
    routeStops,
    mapAutoFitKey,
    selectedRouteStopId,
    previewGeom = null,
    hasUnsavedMove = false,
    stopPreviewSaveBusy = false,
    onSaveStopPreview,
    onRevertStopPreview,
    onSelectStop,
    actionToast = null,
    candidateSearchHint = null,
    nearbyCandidates = [],
    nearbyCandidateCount,
    nearbyCandidatesStatus = "idle",
    onRetryNearbyCandidates,
    selectedCandidateId = null,
    onCandidateSelect,
    onCandidateSearchRequest,
    onCandidateCheckRoutes,
    onCandidateInsert,
    onCandidateKeepCurrent,
    onCandidateKeepCandidate,
    onCandidateCompareMerge,
    candidateActionBusy = false,
    activeDetailSource = null,
    activeDetailUsageSummary = null,
    activeDetailUsageItems = [],
    activeDetailUsageLoading = false,
    activeDetailUsageError = null,
    draftPath = null,
    pathDrawing = false,
    onDraftPathAddPoint,
    pathDrawingHint = null,
    canGeneratePathFromStops = false,
    generatePathFromStopsDisabledReason = "",
    onGeneratePathFromStops,
    reviewMapMode = null,
    canEditPath = false,
    pathEditDraftCoords = null,
    pathEditDraftGeometry = null,
    pathEditHasUnsavedChanges = false,
    selectedPathVertexIndex = null,
    onEnterEditPath,
    onCancelEditPath,
    onSavePathEdit,
    onExitEditPath,
    onPathVertexSelect,
    onPathEditDraftChange,
    onAddPathVertex,
    onUndoPathEdit,
    canUndoPathEdit = false,
    onDeleteSelectedPathVertex,
    pathEditLoading = false,
    pathEditError = "",
    pathEditHint = null,
    routeReviewStatus = "needs_review",
    routePathInfoForReview = null,
    reviewReadiness = null,
    onMarkStopReviewed,
    onMarkPathReviewed,
    onMarkRouteReviewed,
    onOpenStopDetail,
    onStopTimingUpdated,
    onVariantDepartureTimeUpdated,
    centerStopRequest = null,
    insertDisabled = false,
    onInsertAtStart,
    onInsertAfter,
    onRemoveFromRoute,
    onCheckRoutes,
    onDeleteStop,
    routeUsageLoading = false,
    deleteStopAllowed = false,
    deleteBlockMessage = null,
    pickingInsertLocation = false,
    insertPickPoint = null,
    onInsertPickPointChange,
    mapCenterGetterRef,
}: TransportRouteReviewMapShellProps) {
    const titleId = useId();
    const { basemapMode, setBasemapMode, satelliteAvailable } = useTransportDashboardBasemapMode();
    const stopListScrollRef = useRef<HTMLDivElement | null>(null);
    const [stopListScrollTop, setStopListScrollTop] = useState(0);
    const [stopListViewportHeight, setStopListViewportHeight] = useState(480);

    const [showStopSequenceGuide, setShowStopSequenceGuide] = useState(true);
    const [showRoutePath, setShowRoutePath] = useState(true);
    const [mapToolsOpen, setMapToolsOpen] = useState(false);
    const [fitRequest, setFitRequest] = useState<{
        id: number;
        mode: "variant" | "stop";
        stopId: string | null;
    }>({ id: 0, mode: "variant", stopId: null });
    const [stopReviewBusy, setStopReviewBusy] = useState(false);

    const pathEditActive = isReviewMapPathEditMode(reviewMapMode);

    const selectedIndex = useMemo(
        () => (selectedRouteStopId ? stops.findIndex((s) => s.id === selectedRouteStopId) : -1),
        [stops, selectedRouteStopId],
    );

    const resolvedNearbyCandidateCount = nearbyCandidateCount ?? nearbyCandidates.length;

    const selectedCandidate = useMemo(
        () =>
            selectedCandidateId
                ? (nearbyCandidates.find(
                      (candidate) => candidate.publicId === selectedCandidateId,
                  ) ?? null)
                : null,
        [nearbyCandidates, selectedCandidateId],
    );

    /**
     * The card shows candidate details only when the active detail source says so
     * and the candidate is still present in the current search results.
     */
    const activeCandidateDetail =
        activeDetailSource === "nearby_candidate" ? selectedCandidate : null;

    const selectedVariant = useMemo(
        () => variants.find((variant) => variant.public_id === selectedVariantId) ?? null,
        [selectedVariantId, variants],
    );
    const canonicalYbs = isCanonicalYbsRoute(routeMode, routeCode);
    const oppositeVariant = useMemo(
        () => (canonicalYbs ? oppositeYbsVariant(variants, selectedVariantId) : null),
        [canonicalYbs, selectedVariantId, variants],
    );
    const variantDepartureTimeText = selectedVariant?.departure_time_text ?? null;
    const variantDepartureAnchor = useMemo(
        () => resolveVariantDepartureAnchor(variantDepartureTimeText),
        [variantDepartureTimeText],
    );
    const variantTimetableSchedule = useMemo(
        () => buildVariantTimetableSchedule(variantDepartureAnchor, stops),
        [stops, variantDepartureAnchor],
    );

    const routePathDisplayKind = useMemo(
        () => resolveRoutePathDisplayKind(routePathInfo),
        [routePathInfo],
    );
    const routePathLabel = routePathDisplayLabel(routePathDisplayKind);
    const savedRoutePathStyle = useMemo(
        () => routePathLineStyle(routePathDisplayKind),
        [routePathDisplayKind],
    );
    const hasSavedRoutePath = hasSavedRoutePathGeometry(routePathInfo);
    const visibleRoutePathGeometry =
        showRoutePath && hasSavedRoutePath ? (routePathInfo?.geometry ?? null) : null;

    const generatePathCopy = generatePathFromStopsCopy(hasSavedRoutePath);
    const generatePathDisabled =
        !canWrite || !canGeneratePathFromStops || pathDrawing || pathEditActive;
    const generatePathTitle = !canWrite
        ? "Read-only viewers cannot generate route paths"
        : canGeneratePathFromStops
          ? generatePathCopy.enabledTitle
          : generatePathFromStopsDisabledReason || "Cannot generate path yet";

    const editPathDisabled = !canWrite || !canEditPath || pathDrawing || pathEditActive;
    const editPathTitle = !canWrite
        ? "Read-only viewers cannot edit route paths"
        : canEditPath
          ? "Edit the saved route path"
          : "Save a route path before editing";

    const canGoPrev = stops.length > 0 && selectedIndex > 0;
    const canGoNext = stops.length > 0 && (selectedIndex < 0 || selectedIndex < stops.length - 1);

    const handleFit = useCallback(() => {
        setFitRequest((prev) => ({
            id: prev.id + 1,
            mode: selectedRouteStopId ? "stop" : "variant",
            stopId: selectedRouteStopId,
        }));
    }, [selectedRouteStopId]);

    const fitTooltip = selectedRouteStopId
        ? "Center selected stop (F)"
        : "Fit route: all stops, sequence guide, and path if visible (F)";

    useEffect(() => {
        if (!open || !centerStopRequest?.stopId) {
            return;
        }
        setFitRequest({
            id: centerStopRequest.id,
            mode: "stop",
            stopId: centerStopRequest.stopId,
        });
    }, [open, centerStopRequest?.id, centerStopRequest?.stopId]);

    const applySelectStop = useCallback(
        (stopId: string | null) => {
            onSelectStop(stopId);
        },
        [onSelectStop],
    );

    const requestSelectStop = useCallback(
        (stopId: string | null) => {
            if (pathEditActive || pathEditLoading) {
                return;
            }
            if (stopId === selectedRouteStopId) {
                if (activeDetailSource === "nearby_candidate") {
                    onCandidateSelect?.(null);
                    return;
                }
                applySelectStop(null);
                return;
            }
            applySelectStop(stopId);
        },
        [
            activeDetailSource,
            applySelectStop,
            onCandidateSelect,
            pathEditActive,
            pathEditLoading,
            selectedRouteStopId,
        ],
    );

    const goToPrevStop = useCallback(() => {
        requestSelectStop(resolvePrevStopId(stops, selectedRouteStopId));
    }, [requestSelectStop, stops, selectedRouteStopId]);

    const goToNextStop = useCallback(() => {
        requestSelectStop(resolveNextStopId(stops, selectedRouteStopId));
    }, [requestSelectStop, stops, selectedRouteStopId]);

    // Distance from the previous stop, derived once per stops load from the
    // cumulative distance_from_start_m values (no per-row computation).
    const distanceFromPrevLabels = useMemo(() => {
        const labels = new Map<string, string>();
        for (let i = 1; i < stops.length; i++) {
            const prev = stops[i - 1]?.distance_from_start_m;
            const curr = stops[i]?.distance_from_start_m;
            if (prev !== null && prev !== undefined && curr !== null && curr !== undefined) {
                const delta = curr - prev;
                if (Number.isFinite(delta) && delta >= 0) {
                    labels.set(stops[i]!.id, formatDistanceFromPrev(delta));
                }
            }
        }
        return labels;
    }, [stops]);

    const handleMarkSelectedStopReviewed = useCallback(() => {
        if (!onMarkStopReviewed) {
            return;
        }
        setStopReviewBusy(true);
        void onMarkStopReviewed().finally(() => setStopReviewBusy(false));
    }, [onMarkStopReviewed]);

    const stopListRowHeight = VIRTUAL_STOP_ROW_HEIGHT;
    const showStopSequenceActions = Boolean(onInsertAtStart || onInsertAfter);
    const canEditStopSequence = canWrite && showStopSequenceActions && !insertDisabled;
    const stopListUnitHeight = showStopSequenceActions
        ? stopListRowHeight + VIRTUAL_STOP_INSERT_GAP_HEIGHT
        : stopListRowHeight;
    const insertAtStartGapHeight =
        showStopSequenceActions && onInsertAtStart ? VIRTUAL_STOP_INSERT_GAP_HEIGHT : 0;

    const virtualizeStopList = stops.length > VIRTUAL_STOP_LIST_THRESHOLD;
    const virtualStopWindow = useMemo(() => {
        if (!virtualizeStopList) {
            return { start: 0, end: stops.length, offsetY: 0, totalHeight: 0 };
        }
        const start = Math.max(
            0,
            Math.floor(Math.max(0, stopListScrollTop - insertAtStartGapHeight) / stopListUnitHeight) -
                VIRTUAL_STOP_OVERSCAN,
        );
        const visibleCount =
            Math.ceil(stopListViewportHeight / stopListUnitHeight) + VIRTUAL_STOP_OVERSCAN * 2;
        const end = Math.min(stops.length, start + visibleCount);
        return {
            start,
            end,
            offsetY: start * stopListUnitHeight + (start > 0 ? insertAtStartGapHeight : 0),
            totalHeight: stops.length * stopListUnitHeight + insertAtStartGapHeight,
        };
    }, [
        insertAtStartGapHeight,
        stopListUnitHeight,
        stopListScrollTop,
        stopListViewportHeight,
        stops.length,
        virtualizeStopList,
    ]);

    const handleStopListScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
        setStopListScrollTop(event.currentTarget.scrollTop);
    }, []);

    useEffect(() => {
        if (!open || !virtualizeStopList) {
            return;
        }
        const node = stopListScrollRef.current;
        if (!node) {
            return;
        }
        const updateHeight = () => {
            setStopListViewportHeight(node.clientHeight || 480);
        };
        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(node);
        return () => observer.disconnect();
    }, [open, virtualizeStopList, stops.length]);

    useEffect(() => {
        if (!open || !selectedRouteStopId) {
            return;
        }
        if (virtualizeStopList && stopListScrollRef.current) {
            const idx = stops.findIndex((stop) => stop.id === selectedRouteStopId);
            if (idx < 0) {
                return;
            }
            const rowTop = insertAtStartGapHeight + idx * stopListUnitHeight;
            const rowBottom = rowTop + stopListRowHeight;
            const viewport = stopListScrollRef.current;
            const viewTop = viewport.scrollTop;
            const viewBottom = viewTop + viewport.clientHeight;
            if (rowTop < viewTop || rowBottom > viewBottom) {
                viewport.scrollTop = Math.max(0, rowTop - stopListRowHeight);
                setStopListScrollTop(viewport.scrollTop);
            }
            return;
        }
        document
            .getElementById(`review-map-stop-${selectedRouteStopId}`)
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [
        insertAtStartGapHeight,
        open,
        selectedRouteStopId,
        stopListRowHeight,
        stopListUnitHeight,
        stops,
        virtualizeStopList,
    ]);

    useEffect(() => {
        if (!open) {
            setStopListScrollTop(0);
            setMapToolsOpen(false);
        }
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (isTypingTarget(e.target)) {
                return;
            }
            if (e.metaKey || e.ctrlKey || e.altKey) {
                return;
            }

            const key = e.key.toLowerCase();
            if (key === "escape") {
                if (pathEditActive && pathEditHasUnsavedChanges && onCancelEditPath) {
                    e.preventDefault();
                    onCancelEditPath();
                    return;
                }
                if (pathEditActive && onExitEditPath) {
                    e.preventDefault();
                    onExitEditPath();
                    return;
                }
                onExit();
                return;
            }

            if (pathEditActive) {
                if (pathEditActive && (key === "delete" || key === "backspace") && onDeleteSelectedPathVertex) {
                    if (selectedPathVertexIndex !== null && (pathEditDraftCoords?.length ?? 0) > 2) {
                        e.preventDefault();
                        onDeleteSelectedPathVertex();
                    }
                }
                return;
            }

            if (key === "n") {
                e.preventDefault();
                goToNextStop();
                return;
            }
            if (key === "p") {
                e.preventDefault();
                goToPrevStop();
                return;
            }
            if (key === "f") {
                e.preventDefault();
                handleFit();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [
        open,
        onExit,
        goToNextStop,
        goToPrevStop,
        handleFit,
        pathEditActive,
        pathEditHasUnsavedChanges,
        onCancelEditPath,
        onExitEditPath,
        onDeleteSelectedPathVertex,
        selectedPathVertexIndex,
        pathEditDraftCoords,
    ]);

    const selectedRouteStop =
        selectedRouteStopId !== null
            ? (stops.find((row) => row.id === selectedRouteStopId) ?? null)
            : null;

    const selectedRouteStopReviewed =
        selectedRouteStop?.stop.review_status === "reviewed" ||
        selectedRouteStop?.stop.review_status === "verified";
    const routeStopActionBlocked = !canWrite || pathEditLoading || stopPreviewSaveBusy;
    const routeStopDeleteTitle = routeUsageLoading
        ? "Checking delete eligibility..."
        : deleteBlockMessage
          ? deleteBlockMessage
          : deleteStopAllowed
            ? "Delete this stop"
            : DELETE_BLOCKED_MESSAGE;

    const routeStopPrimaryActions = useMemo<TransportMapStopDetailCardAction[]>(() => {
        if (!selectedRouteStop) {
            return [];
        }
        const actions: TransportMapStopDetailCardAction[] = [];
        if (onSaveStopPreview) {
            actions.push({
                label: stopPreviewSaveBusy ? "Saving..." : "Save",
                onClick: onSaveStopPreview,
                disabled: !hasUnsavedMove || routeStopActionBlocked,
                variant: "primary",
                title: hasUnsavedMove ? "Save preview location" : "No unsaved preview location",
            });
        }
        if (onRevertStopPreview) {
            actions.push({
                label: "Revert",
                onClick: onRevertStopPreview,
                disabled: !hasUnsavedMove || routeStopActionBlocked,
                title: hasUnsavedMove ? "Discard preview location" : "No unsaved preview location",
            });
        }
        return actions;
    }, [
        hasUnsavedMove,
        onRevertStopPreview,
        onSaveStopPreview,
        routeStopActionBlocked,
        selectedRouteStop,
        stopPreviewSaveBusy,
    ]);

    const routeStopMainActions = useMemo<TransportMapStopDetailCardAction[]>(() => {
        if (!selectedRouteStop) {
            return [];
        }
        const actions: TransportMapStopDetailCardAction[] = [];
        if (onMarkStopReviewed) {
            actions.push({
                label: stopReviewBusy ? "Saving..." : "Mark reviewed",
                onClick: handleMarkSelectedStopReviewed,
                disabled:
                    routeStopActionBlocked || stopReviewBusy || selectedRouteStopReviewed,
                title: selectedRouteStopReviewed
                    ? "Stop is already reviewed"
                    : "Mark this stop reviewed",
            });
        }
        if (onCheckRoutes) {
            actions.push({
                label: "Check routes",
                onClick: () => onCheckRoutes(selectedRouteStop),
                disabled: routeStopActionBlocked,
            });
        }
        if (onOpenStopDetail) {
            actions.push({
                label: "Open stop detail",
                onClick: () => onOpenStopDetail(selectedRouteStop.stop.public_id),
                disabled: pathEditLoading || stopPreviewSaveBusy,
            });
        }
        return actions;
    }, [
        handleMarkSelectedStopReviewed,
        onCheckRoutes,
        onMarkStopReviewed,
        onOpenStopDetail,
        pathEditLoading,
        routeStopActionBlocked,
        selectedRouteStop,
        selectedRouteStopReviewed,
        stopPreviewSaveBusy,
        stopReviewBusy,
    ]);

    const routeStopDestructiveActions = useMemo<TransportMapStopDetailCardAction[]>(() => {
        if (!selectedRouteStop) {
            return [];
        }
        const actions: TransportMapStopDetailCardAction[] = [];
        if (onRemoveFromRoute) {
            actions.push({
                label: "Remove from route",
                onClick: () => onRemoveFromRoute(selectedRouteStop),
                disabled: routeStopActionBlocked,
                title: "Remove from this route variant only",
                variant: "destructive",
            });
        }
        if (onDeleteStop) {
            actions.push({
                label: routeUsageLoading ? "Checking..." : "Delete stop",
                onClick: () => onDeleteStop(selectedRouteStop),
                disabled: routeStopActionBlocked || routeUsageLoading || !deleteStopAllowed,
                title: routeStopDeleteTitle,
                variant: "destructive",
            });
        }
        return actions;
    }, [
        deleteStopAllowed,
        onDeleteStop,
        onRemoveFromRoute,
        routeStopActionBlocked,
        routeStopDeleteTitle,
        routeUsageLoading,
        selectedRouteStop,
    ]);

    const candidateCheckRoutesAction = useMemo<TransportMapStopDetailCardAction | null>(() => {
        if (!activeCandidateDetail || !onCandidateCheckRoutes) {
            return null;
        }
        return {
            label: "Check routes",
            onClick: () => onCandidateCheckRoutes(activeCandidateDetail),
        };
    }, [activeCandidateDetail, onCandidateCheckRoutes]);

    const candidateInsertActions = useMemo<TransportMapStopDetailCardAction[]>(() => {
        if (!activeCandidateDetail || !selectedRouteStop || !onCandidateInsert || !canWrite) {
            return [];
        }
        const disabled = candidateRouteStopInsertDisabled({
            canWrite,
            busy: insertDisabled,
            selectedVariantId,
            selectedRouteStopId,
        });
        const sequence = selectedRouteStop.stop_sequence;
        return [
            {
                label: `Add before #${sequence}`,
                onClick: () => onCandidateInsert(activeCandidateDetail, "before"),
                disabled,
            },
            {
                label: `Add after #${sequence}`,
                onClick: () => onCandidateInsert(activeCandidateDetail, "after"),
                disabled,
            },
        ];
    }, [
        activeCandidateDetail,
        canWrite,
        insertDisabled,
        onCandidateInsert,
        selectedRouteStop,
        selectedRouteStopId,
        selectedVariantId,
    ]);

    const candidateKeepCurrentAction = useMemo<TransportMapStopDetailCardAction | null>(() => {
        if (!activeCandidateDetail || !onCandidateKeepCurrent) {
            return null;
        }
        return {
            label: "Keep current stop",
            onClick: onCandidateKeepCurrent,
            disabled: !canWrite,
            title: !canWrite ? "Read-only viewers cannot change stop review decisions" : undefined,
        };
    }, [activeCandidateDetail, canWrite, onCandidateKeepCurrent]);

    const candidateKeepCandidateAction = useMemo<TransportMapStopDetailCardAction | null>(() => {
        if (!activeCandidateDetail || !onCandidateKeepCandidate) {
            return null;
        }
        return {
            label: "Keep candidate stop",
            onClick: () => onCandidateKeepCandidate(activeCandidateDetail),
            disabled: !canWrite,
            title: !canWrite ? "Read-only viewers cannot replace route stops" : undefined,
            variant: "primary",
        };
    }, [activeCandidateDetail, canWrite, onCandidateKeepCandidate]);

    const candidateCompareMergeAction = useMemo<TransportMapStopDetailCardAction | null>(() => {
        if (!activeCandidateDetail || !onCandidateCompareMerge) {
            return null;
        }
        return {
            label: "Compare & merge",
            onClick: () => onCandidateCompareMerge(activeCandidateDetail),
            disabled: !canWrite,
            title: !canWrite ? "Read-only viewers cannot merge stops" : undefined,
        };
    }, [activeCandidateDetail, canWrite, onCandidateCompareMerge]);

    const contextCardMode: TransportStopContextCardMode =
        activeDetailSource === "nearby_candidate"
            ? "nearby_candidate_stop"
            : "selected_route_stop";

    const selectedStopTimetableText = useMemo(() => {
        if (!selectedRouteStop || selectedIndex < 0) {
            return null;
        }
        const schedule = variantTimetableSchedule[selectedIndex];
        if (!schedule || !calculatedTimetableRowHasDisplayData(selectedRouteStop, schedule)) {
            return null;
        }
        return getCalculatedTimetableRowSegments(selectedRouteStop, schedule)
            .map((segment) => segment.text)
            .join(" · ");
    }, [selectedIndex, selectedRouteStop, variantTimetableSchedule]);

    const selectedStopRouteUsageText = useMemo(() => {
        if (activeDetailUsageError) {
            return "Unavailable";
        }
        if (activeDetailUsageLoading || !activeDetailUsageSummary) {
            return null;
        }
        return formatRouteUsageSummary(activeDetailUsageSummary);
    }, [activeDetailUsageError, activeDetailUsageLoading, activeDetailUsageSummary]);

    const candidateUsageError =
        activeDetailUsageError && activeDetailSource === "nearby_candidate"
            ? "Could not load route usage."
            : null;

    if (!open) {
        return null;
    }

    const renderStopInsertGap = (title: string, onClick: () => void) => (
        <ReviewMapStopInsertGap
            title={title}
            disabled={!canEditStopSequence || pathEditActive || pathEditLoading}
            onClick={onClick}
        />
    );

    const renderStopRow = (stop: TransportRouteStopItem, stopIndex: number) => (
        <ReviewMapStopRow
            key={stop.id}
            stop={stop}
            selected={!pathEditActive && stop.id === selectedRouteStopId}
            movedUnsaved={stop.id === selectedRouteStopId && hasUnsavedMove}
            distanceFromPrev={distanceFromPrevLabels.get(stop.id) ?? null}
            rowHeight={stopListRowHeight}
            schedule={variantTimetableSchedule[stopIndex]!}
            disabled={pathEditActive}
            onSelect={requestSelectStop}
        />
    );

    const renderInsertAtStartGap = () =>
        onInsertAtStart && showStopSequenceActions
            ? renderStopInsertGap("Insert stop at start", onInsertAtStart)
            : null;

    const renderStopWithGap = (stop: TransportRouteStopItem, stopIndex: number) => (
        <Fragment key={stop.id}>
            {renderStopRow(stop, stopIndex)}
            {showStopSequenceActions
                ? renderStopInsertGap(
                      stopIndex === stops.length - 1 ? "Add final stop" : "Insert stop here",
                      () => onInsertAfter?.(stop, stopIndex),
                  )
                : null}
        </Fragment>
    );

    const mapCandidateSearchRequest =
        !pathDrawing &&
        !isReviewMapPathEditMode(reviewMapMode) &&
        !pickingInsertLocation &&
        onCandidateSearchRequest
            ? onCandidateSearchRequest
            : undefined;

    const mapInteractionHint = pickingInsertLocation
        ? "Click the map to set the new stop location"
        : pathEditActive
          ? null
          : candidateSearchHint;

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col bg-gray-100"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
        >
            {/* Top bar */}
            <header className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-200 bg-white px-3 py-2 shadow-sm">
                {/* Left: route identity + variant */}
                <div className="flex min-w-0 flex-1 basis-[min(100%,42rem)] items-center gap-2">
                    <span className="shrink-0 rounded bg-gray-900 px-1.5 py-0.5 text-xs font-semibold text-white">
                        {routeCode}
                    </span>
                    <span
                        id={titleId}
                        className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900"
                        title={routeDisplayName}
                    >
                        {routeDisplayName}
                    </span>
                    {variants.length > 0 ? (
                        <label className="shrink-0">
                            <span className="sr-only">Variant</span>
                            <select
                                className={`${SELECT_CLASS} w-[min(360px,40vw)] min-w-[240px] py-1 text-xs`}
                                value={selectedVariantId ?? ""}
                                onChange={(e) => onVariantChange(e.target.value)}
                            >
                                {variants.map((v) => (
                                    <option key={v.public_id} value={v.public_id}>
                                        {canonicalYbs
                                            ? ybsVariantOptionLabel(routeCode, v)
                                            : `${v.variant_code}${v.direction_name ? ` · ${v.direction_name}` : ""}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}
                    {canonicalYbs && selectedVariant && oppositeVariant ? (
                        <button
                            type="button"
                            onClick={() => onVariantChange(oppositeVariant.public_id)}
                            className={NAV_BTN_CLASS}
                            title="Select the opposite YBS route variant; its route, stops, path, and timing data load together"
                        >
                            Switch to {variantDirectionLabel(oppositeVariant, true)}
                        </button>
                    ) : null}
                </div>

                {/* Middle: unsaved + fit + layer toggles */}
                <div className={`${TOOLBAR_GROUP_CLASS} flex-wrap`}>
                    <button
                        type="button"
                        onClick={handleFit}
                        className={TOOLBAR_BTN_CLASS}
                        title={fitTooltip}
                    >
                        Fit
                    </button>

                    <TransportMapLayerToggle
                        value={basemapMode}
                        onChange={setBasemapMode}
                        satelliteAvailable={satelliteAvailable}
                        className="shrink-0"
                    />

                    <div className="hidden items-center gap-3 lg:flex">
                        <ReviewMapLayerControls
                            showStopSequenceGuide={showStopSequenceGuide}
                            onShowStopSequenceGuideChange={setShowStopSequenceGuide}
                            showRoutePath={showRoutePath}
                            onShowRoutePathChange={setShowRoutePath}
                            hasSavedRoutePath={hasSavedRoutePath}
                            routePathLabel={routePathLabel}
                        />
                    </div>
                </div>

                {/* Path actions */}
                <div className="hidden shrink-0 items-center gap-1.5 md:flex">
                    <ReviewMapPathControls
                        onGeneratePathFromStops={onGeneratePathFromStops}
                        generatePathDisabled={generatePathDisabled}
                        generatePathTitle={generatePathTitle}
                        generatePathButtonLabel={generatePathCopy.buttonLabel}
                        onEnterEditPath={onEnterEditPath}
                        editPathDisabled={editPathDisabled}
                        editPathTitle={editPathTitle}
                        pathEditActive={pathEditActive}
                    />
                </div>

                {/* Narrow: layer + path menu */}
                <div className="relative lg:hidden">
                    <button
                        type="button"
                        onClick={() => setMapToolsOpen((open) => !open)}
                        className={TOOLBAR_BTN_CLASS}
                        aria-expanded={mapToolsOpen}
                        aria-haspopup="menu"
                    >
                        Map tools
                    </button>
                    {mapToolsOpen ? (
                        <>
                            <button
                                type="button"
                                className="fixed inset-0 z-10 cursor-default"
                                aria-label="Close map tools menu"
                                onClick={() => setMapToolsOpen(false)}
                            />
                            <div
                                role="menu"
                                className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-gray-200 bg-white p-3 shadow-lg"
                            >
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                    Layers
                                </p>
                                <ReviewMapLayerControls
                                    showStopSequenceGuide={showStopSequenceGuide}
                                    onShowStopSequenceGuideChange={setShowStopSequenceGuide}
                                    showRoutePath={showRoutePath}
                                    onShowRoutePathChange={setShowRoutePath}
                                    hasSavedRoutePath={hasSavedRoutePath}
                                    routePathLabel={routePathLabel}
                                    stacked
                                />
                                <p className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                    Path
                                </p>
                                <ReviewMapPathControls
                                    onGeneratePathFromStops={onGeneratePathFromStops}
                                    generatePathDisabled={generatePathDisabled}
                                    generatePathTitle={generatePathTitle}
                                    generatePathButtonLabel={generatePathCopy.buttonLabel}
                                    onEnterEditPath={onEnterEditPath}
                                    editPathDisabled={editPathDisabled}
                                    editPathTitle={editPathTitle}
                                    pathEditActive={pathEditActive}
                                    stacked
                                />
                            </div>
                        </>
                    ) : null}
                </div>

                {/* Right: exit */}
                <div className={`${TOOLBAR_GROUP_CLASS} ml-auto`}>
                    <button type="button" onClick={onExit} className={TOOLBAR_BTN_CLASS}>
                        Exit
                    </button>
                </div>
            </header>

            {pathEditActive ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-pink-200 bg-pink-50 px-4 py-2.5">
                    <span className="text-sm font-medium text-pink-950">Path edit mode</span>
                    {pathEditHasUnsavedChanges ? (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                            Unsaved path changes
                        </span>
                    ) : null}
                    {selectedPathVertexIndex !== null ? (
                        <span className="rounded-md bg-white px-2 py-0.5 text-xs font-medium text-pink-900 ring-1 ring-pink-200">
                            Vertex #{selectedPathVertexIndex + 1}
                        </span>
                    ) : (
                        <span className="text-xs text-pink-800">No vertex selected</span>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        {onAddPathVertex ? (
                            <button
                                type="button"
                                onClick={onAddPathVertex}
                                disabled={
                                    !canWrite ||
                                    pathEditLoading ||
                                    selectedPathVertexIndex === null ||
                                    (pathEditDraftCoords?.length ?? 0) < 2
                                }
                                title={
                                    selectedPathVertexIndex === null
                                        ? "Select a vertex first"
                                        : "Insert a vertex at the midpoint of the next segment"
                                }
                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Add vertex
                            </button>
                        ) : null}
                        {onUndoPathEdit ? (
                            <button
                                type="button"
                                onClick={onUndoPathEdit}
                                disabled={!canWrite || pathEditLoading || !canUndoPathEdit}
                                title="Undo the last path edit"
                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Undo
                            </button>
                        ) : null}
                        {onDeleteSelectedPathVertex ? (
                            <button
                                type="button"
                                onClick={onDeleteSelectedPathVertex}
                                disabled={
                                    !canWrite ||
                                    pathEditLoading ||
                                    selectedPathVertexIndex === null ||
                                    (pathEditDraftCoords?.length ?? 0) <= 2
                                }
                                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Delete vertex
                            </button>
                        ) : null}
                        {onSavePathEdit ? (
                            <button
                                type="button"
                                onClick={onSavePathEdit}
                                disabled={!canWrite || pathEditLoading || !pathEditHasUnsavedChanges}
                                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {pathEditLoading ? "Saving…" : "Save path"}
                            </button>
                        ) : null}
                        {onCancelEditPath ? (
                            <button
                                type="button"
                                onClick={onCancelEditPath}
                                disabled={pathEditLoading}
                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Cancel
                            </button>
                        ) : null}
                        {onExitEditPath ? (
                            <button
                                type="button"
                                onClick={onExitEditPath}
                                disabled={pathEditLoading}
                                className="rounded-md border border-pink-300 bg-white px-3 py-1.5 text-sm font-medium text-pink-900 hover:bg-pink-100/60 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Exit edit mode
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {pathEditError ? (
                <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                    {pathEditError}
                </div>
            ) : null}

            {/* Main: map + stop list */}
            <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
                <ReviewMapActionToast toast={actionToast} />
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col p-3">
                    <TransportPreviewMap
                        chromeless
                        showBasemapToggle={false}
                        basemapMode={basemapMode}
                        onBasemapModeChange={setBasemapMode}
                        className="h-full"
                        heightClassName="h-full min-h-[280px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 lg:min-h-0"
                        externalId={selectedVariantId}
                        routePath={
                            pathEditActive && pathEditDraftGeometry
                                ? pathEditDraftGeometry
                                : pathEditActive && hasSavedRoutePath
                                  ? (routePathInfo?.geometry ?? null)
                                  : visibleRoutePathGeometry
                        }
                        routePathLineStyle={
                            pathEditActive && hasSavedRoutePath
                                ? savedRoutePathStyle
                                : showRoutePath && hasSavedRoutePath
                                  ? savedRoutePathStyle
                                  : null
                        }
                        routePathLegendLabel={
                            pathEditActive && hasSavedRoutePath
                                ? routePathLabel
                                : showRoutePath && hasSavedRoutePath
                                  ? routePathLabel
                                  : null
                        }
                        routeStops={routeStops}
                        showStopSequenceGuide={showStopSequenceGuide}
                        allowStopSequenceGuideWithPath
                        autoFitKey={mapAutoFitKey}
                        fitRequestId={fitRequest.id}
                        fitRequestMode={fitRequest.mode}
                        fitRequestStopId={fitRequest.stopId}
                        initialZoom={11}
                        selectedStopId={pathEditActive ? null : selectedRouteStopId}
                        selectedStopPreviewPoint={pathEditActive ? null : previewGeom}
                        selectedRouteStopPublicId={
                            pathEditActive ? null : (selectedRouteStop?.stop.public_id ?? null)
                        }
                        candidateSearchHint={mapInteractionHint}
                        nearbyCandidates={nearbyCandidates}
                        selectedCandidateId={selectedCandidateId}
                        onCandidateSelect={onCandidateSelect}
                        onCandidateSearchRequest={mapCandidateSearchRequest}
                        editablePoint={canWrite && pickingInsertLocation ? insertPickPoint : null}
                        pointDraggable={canWrite && pickingInsertLocation}
                        onPointChange={canWrite && pickingInsertLocation ? onInsertPickPointChange : undefined}
                        editingHint={
                            pickingInsertLocation
                                ? "Click the map to set the new stop location"
                                : pathDrawingHint
                        }
                        pathEditActive={pathEditActive}
                        pathEditDraftCoords={pathEditDraftCoords}
                        selectedPathVertexIndex={selectedPathVertexIndex}
                        onPathVertexSelect={pathEditActive ? onPathVertexSelect : undefined}
                        onPathEditDraftChange={pathEditActive ? onPathEditDraftChange : undefined}
                        pathEditHint={pathEditActive ? pathEditHint : null}
                        draftPath={draftPath}
                        pathDrawing={pathDrawing}
                        onDraftPathAddPoint={canWrite ? onDraftPathAddPoint : undefined}
                        mapCenterGetterRef={mapCenterGetterRef}
                        emptyHint={
                            variants.length === 0
                                ? "No variants to display."
                                : "No route path or ordered stops available"
                        }
                    />

                    {selectedRouteStop && !pathEditActive ? (
                        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex w-auto max-w-[calc(100%-1.5rem)] flex-col sm:inset-3 sm:bottom-auto sm:left-3 sm:right-auto sm:top-3 sm:w-[min(100%,380px)] sm:max-w-[420px]">
                            <div
                                className={`pointer-events-auto w-full overflow-hidden rounded-lg bg-white/95 shadow-lg backdrop-blur-sm ${
                                    contextCardMode === "nearby_candidate_stop"
                                        ? "border border-purple-200"
                                        : "border border-gray-200"
                                }`}
                            >
                                <TransportStopContextCard
                                    mode={contextCardMode}
                                    busy={
                                        pathEditLoading ||
                                        stopPreviewSaveBusy ||
                                        candidateActionBusy
                                    }
                                    stopSequence={selectedRouteStop.stop_sequence}
                                    nameMm={
                                        selectedRouteStop.stop.name_mm ??
                                        selectedRouteStop.stop.name
                                    }
                                    nameEn={selectedRouteStop.stop.name_en}
                                    reviewStatus={selectedRouteStop.stop.review_status ?? null}
                                    hasUnsavedMove={hasUnsavedMove}
                                    routeUsageText={selectedStopRouteUsageText}
                                    routeUsageLoading={
                                        contextCardMode === "selected_route_stop" &&
                                        activeDetailUsageLoading &&
                                        !activeDetailUsageError
                                    }
                                    timetableText={selectedStopTimetableText}
                                    nearbyCandidateCount={resolvedNearbyCandidateCount}
                                    nearbyCandidatesStatus={nearbyCandidatesStatus}
                                    onRetryNearbyCandidates={onRetryNearbyCandidates}
                                    candidate={activeCandidateDetail}
                                    candidateUsageSummary={
                                        contextCardMode === "nearby_candidate_stop"
                                            ? activeDetailUsageSummary
                                            : null
                                    }
                                    candidateUsageLoading={
                                        contextCardMode === "nearby_candidate_stop" &&
                                        activeDetailUsageLoading
                                    }
                                    candidateUsageError={candidateUsageError}
                                    primaryActions={routeStopPrimaryActions}
                                    mainActions={routeStopMainActions}
                                    destructiveActions={routeStopDestructiveActions}
                                    candidateInsertActions={candidateInsertActions}
                                    candidateCheckRoutesAction={candidateCheckRoutesAction}
                                    candidateKeepCurrentAction={candidateKeepCurrentAction}
                                    candidateKeepCandidateAction={candidateKeepCandidateAction}
                                    candidateCompareMergeAction={candidateCompareMergeAction}
                                    onBackToSelectedStop={
                                        contextCardMode === "nearby_candidate_stop"
                                            ? () => onCandidateSelect?.(null)
                                            : undefined
                                    }
                                    deleteBlockMessage={deleteBlockMessage}
                                    extraControls={
                                        onStopTimingUpdated && selectedIndex >= 0 ? (
                                            <ReviewMapStopTimingEditor
                                                stop={selectedRouteStop}
                                                stops={stops}
                                                stopIndex={selectedIndex}
                                                persistedSchedule={
                                                    variantTimetableSchedule[selectedIndex]!
                                                }
                                                departureTimeText={variantDepartureAnchor}
                                                disabled={
                                                    !canWrite || pathEditLoading || stopPreviewSaveBusy
                                                }
                                                onUpdated={onStopTimingUpdated}
                                            />
                                        ) : null
                                    }
                                />
                            </div>
                        </div>
                    ) : null}
                </div>

                <aside className="flex w-full shrink-0 flex-col border-t border-gray-200 bg-white lg:w-[360px] lg:border-l lg:border-t-0">
                    <TransportReviewMapReviewActions
                        selectedStop={selectedRouteStop}
                        path={routePathInfoForReview}
                        routeReviewStatus={routeReviewStatus}
                        readiness={reviewReadiness}
                        pathEditActive={pathEditActive}
                        busy={pathEditLoading}
                        disabled={!canWrite}
                        showStopAction={false}
                        onMarkStopReviewed={onMarkStopReviewed}
                        onMarkPathReviewed={onMarkPathReviewed}
                        onMarkRouteReviewed={onMarkRouteReviewed}
                    />
                    <div className="border-b border-gray-100 px-3 py-2">
                        <div className="flex items-center gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Ordered stops
                            </h3>
                            <span className="text-xs tabular-nums text-gray-500">
                                {selectedRouteStop && !pathEditActive
                                    ? `#${selectedRouteStop.stop_sequence} / ${stops.length}`
                                    : stops.length}
                            </span>
                            <div className="ml-auto flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={goToPrevStop}
                                    disabled={!canGoPrev || pathEditLoading || pathEditActive}
                                    className={NAV_BTN_CLASS}
                                    title="Previous stop (P)"
                                >
                                    ←
                                </button>
                                <button
                                    type="button"
                                    onClick={goToNextStop}
                                    disabled={!canGoNext || pathEditLoading || pathEditActive}
                                    className={NAV_BTN_CLASS}
                                    title="Next stop (N)"
                                >
                                    →
                                </button>
                            </div>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-400">
                            {pathEditActive
                                ? "Stop editing is paused while path edit mode is active"
                                : "N next · P prev · F fit"}
                        </p>
                        {selectedVariantId &&
                        onVariantDepartureTimeUpdated &&
                        supportsVariantTimetable(routeMode) ? (
                            <div className="mt-2">
                                <ReviewMapVariantDepartureTimeEditor
                                    variantPublicId={selectedVariantId}
                                    departureTimeText={variantDepartureTimeText}
                                    disabled={!canWrite || pathEditLoading || pathEditActive}
                                    onUpdated={onVariantDepartureTimeUpdated}
                                />
                            </div>
                        ) : null}
                    </div>

                    {stopsError ? (
                        <div className="m-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {stopsError}
                        </div>
                    ) : null}

                    {stopsLoading ? (
                        <div className="space-y-2 p-4">
                            {[0, 1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />
                            ))}
                        </div>
                    ) : !selectedVariantId ? (
                        <p className="px-4 py-8 text-center text-sm text-gray-500">
                            Select a variant to view its stops.
                        </p>
                    ) : stops.length === 0 ? (
                        <div className="px-4 py-8 text-center">
                            <p className="text-sm text-gray-500">This variant has no ordered stops.</p>
                            {onInsertAtStart ? (
                                <button
                                    type="button"
                                    disabled={!canEditStopSequence || pathEditActive || pathEditLoading}
                                    onClick={onInsertAtStart}
                                    className="mt-3 rounded-md border border-dashed border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Add first stop
                                </button>
                            ) : null}
                        </div>
                    ) : (
                        <div
                            ref={stopListScrollRef}
                            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                            onScroll={virtualizeStopList ? handleStopListScroll : undefined}
                        >
                            {virtualizeStopList ? (
                                <div
                                    style={{ height: virtualStopWindow.totalHeight }}
                                    className="relative"
                                >
                                    <div
                                        style={{
                                            transform: `translateY(${virtualStopWindow.offsetY}px)`,
                                        }}
                                    >
                                        {virtualStopWindow.start === 0
                                            ? renderInsertAtStartGap()
                                            : null}
                                        {stops
                                            .slice(virtualStopWindow.start, virtualStopWindow.end)
                                            .map((stop, sliceIndex) => {
                                                const stopIndex =
                                                    virtualStopWindow.start + sliceIndex;
                                                return renderStopWithGap(stop, stopIndex);
                                            })}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {renderInsertAtStartGap()}
                                    {stops.map((stop, stopIndex) =>
                                        renderStopWithGap(stop, stopIndex),
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}
