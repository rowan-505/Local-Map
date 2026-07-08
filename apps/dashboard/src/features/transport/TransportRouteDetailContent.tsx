"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import {
    applyTransportRoutePathReviewAction,
    applyTransportRouteReviewAction,
    applyTransportStopReviewAction,
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
    updateTransportRouteStop,
    updateTransportStopLocation,
} from "./api";
import { transportModeLabel } from "./constants";
import { getTransportDisplayNameFromNames } from "./naming";
import InsertRouteStopDialog, {
    type InsertStopContext,
    type InsertStopLngLat,
} from "./InsertRouteStopDialog";
import RemoveRouteStopDialog from "./RemoveRouteStopDialog";
import GeneratePathFromStopsDialog from "./GeneratePathFromStopsDialog";
import TransportPreviewMap from "./TransportPreviewMap";
import TransportRouteReviewPanel from "./TransportRouteReviewPanel";
import TransportRouteReviewMapShell, {
    type ReviewMapSaveOptions,
} from "./TransportRouteReviewMapShell";
import {
    buildRouteReviewChecklist,
    CollapsibleSection,
    RouteDetailHeader,
    RouteReviewChecklistCard,
    RouteSummaryCard,
    RouteVariantsCard,
} from "./TransportRouteDetailCards";
import { evaluateGeneratePathFromStopsReadiness } from "./reviewMapPathGeneration";
import { routeStopItemsToPreviewStops } from "./transportPreviewStops";
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
    StopGeometryStatus,
    TransportOrderedStopLite,
    TransportRouteDetail,
    TransportRouteStopItem,
    TransportRouteStopMutationResult,
    TransportRoutePath,
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


/**
 * Map a lightweight mutation-response stop into the richer ordered-stop item the
 * panel + map already render, so a mutation can update local state without a
 * heavy refetch. The mutation response intentionally omits distance_from_start_m
 * (not displayed here) and path geometry (unchanged by a membership edit).
 */
function orderedStopLiteToItem(s: TransportOrderedStopLite): TransportRouteStopItem {
    const geometry =
        s.longitude !== null && s.latitude !== null
            ? { type: "Point" as const, coordinates: [s.longitude, s.latitude] }
            : null;
    return {
        id: s.route_stop_id,
        stop_sequence: s.stop_sequence,
        pickup_type: s.pickup_type,
        drop_off_type: s.drop_off_type,
        is_timing_point: s.is_timing_point,
        distance_from_start_m: null,
        geometry_source: s.geometry_source,
        stop: {
            public_id: s.stop_public_id,
            name: s.display_name,
            name_mm: s.name_mm,
            name_en: s.name_en,
            mode: s.mode,
            stop_type: s.stop_type,
            geometry,
            review_status: s.review_status,
        },
    };
}

function patchRouteStopGeometry(
    stops: readonly TransportRouteStopItem[],
    routeStopId: string,
    lng: number,
    lat: number,
): TransportRouteStopItem[] {
    return stops.map((s) =>
        s.id !== routeStopId
            ? s
            : {
                  ...s,
                  geometry_source: "stop_geom",
                  stop: {
                      ...s.stop,
                      geometry: { type: "Point", coordinates: [lng, lat] },
                  },
              },
    );
}

function pointFromStopDetail(stop: {
    longitude: number | null;
    latitude: number | null;
    geometry: { type: string; coordinates: unknown } | null;
}): { lng: number; lat: number } | null {
    if (stop.geometry?.type === "Point" && Array.isArray(stop.geometry.coordinates)) {
        const lng = Number(stop.geometry.coordinates[0]);
        const lat = Number(stop.geometry.coordinates[1]);
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
            return { lng, lat };
        }
    }
    if (stop.longitude !== null && stop.latitude !== null) {
        const lng = Number(stop.longitude);
        const lat = Number(stop.latitude);
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
            return { lng, lat };
        }
    }
    return null;
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

/** Compact stop reference stored in the insert context (no geometry/flags). */
function stopRef(item: TransportRouteStopItem) {
    return { id: item.id, name: item.stop.name, stop_sequence: item.stop_sequence };
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

/** Midpoint of two points; falls back to whichever single point is available. */
function midpoint(
    a: { lng: number; lat: number } | null,
    b: { lng: number; lat: number } | null
): { lng: number; lat: number } | null {
    if (a && b) {
        return { lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 };
    }
    return a ?? b ?? null;
}

/**
 * Low-noise, full-width dashed button used between/around ordered stops to start
 * an insert. Styling stays muted until hover so the list does not feel cluttered.
 */
function InsertStopButton({
    label,
    onClick,
    disabled,
}: {
    readonly label: string;
    readonly onClick: () => void;
    readonly disabled?: boolean;
}) {
    return (
        <div className="px-3 py-1">
            <button
                type="button"
                disabled={disabled}
                onClick={onClick}
                className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-400 hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {label}
            </button>
        </div>
    );
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

    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
    const [stopMutating, setStopMutating] = useState(false);
    const [stopActionError, setStopActionError] = useState("");

    const [removeTarget, setRemoveTarget] = useState<TransportRouteStopItem | null>(null);
    const [removeReason, setRemoveReason] = useState("");
    const [replaceTarget, setReplaceTarget] = useState<TransportRouteStopItem | null>(null);
    const [stopReviewBusy, setStopReviewBusy] = useState<string | null>(null);

    const [insertContext, setInsertContext] = useState<InsertStopContext | null>(null);
    // New-stop draft location (create-stop flow), shared with the map for click-to-place.
    const [newStopPoint, setNewStopPoint] = useState<InsertStopLngLat | null>(null);
    const [pickingLocation, setPickingLocation] = useState(false);

    // --- Route path drawing (selected variant). ------------------------------
    // `pathMode` null = idle; "create"/"edit" = drawing. `draftPath` holds the
    // ordered [lng, lat] vertices being placed via map clicks.
    const [pathMode, setPathMode] = useState<"create" | "edit" | null>(null);
    const [draftPath, setDraftPath] = useState<Array<[number, number]>>([]);
    const [pathMutating, setPathMutating] = useState(false);
    const [pathError, setPathError] = useState("");
    const [confirmDeletePath, setConfirmDeletePath] = useState(false);

    const [reviewMapOpen, setReviewMapOpen] = useState(false);
    const [reviewMapSelectedStopId, setReviewMapSelectedStopId] = useState<string | null>(null);
    const [reviewMapStopDrafts, setReviewMapStopDrafts] = useState<
        Record<string, { lng: number; lat: number }>
    >({});
    const [reviewMapSaveLoading, setReviewMapSaveLoading] = useState(false);
    const [reviewMapSaveError, setReviewMapSaveError] = useState("");
    const [reviewMapSaveSuccess, setReviewMapSaveSuccess] = useState<string | null>(null);
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
    const [readinessError, setReadinessError] = useState("");

    const loadReadiness = useCallback(async (signal?: AbortSignal) => {
        setReadinessLoading(true);
        setReadinessError("");
        try {
            const result = await getTransportRouteReviewReadiness(
                publicId,
                signal ? { signal } : undefined,
            );
            setReadiness(result);
        } catch (err) {
            if (isAbortError(err)) return;
            setReadinessError(
                err instanceof Error ? err.message : "Failed to load review readiness.",
            );
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
        setNewStopPoint(null);
        setPickingLocation(false);
        setPathMode(null);
        setDraftPath([]);
        setPathError("");
        setConfirmDeletePath(false);
        setReviewMapOpen(false);
        setReviewMapSelectedStopId(null);
        setReviewMapStopDrafts({});
        setAdvancedOpen(false);
        setReadiness(null);
        setReadinessError("");

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
                setRouteError(err instanceof Error ? err.message : "Failed to load route.");
            } finally {
                setRouteLoading(false);
            }
        })();

        return () => controller.abort();
    }, [publicId]);

    useEffect(() => {
        const controller = new AbortController();
        void loadReadiness(controller.signal);
        return () => controller.abort();
    }, [loadReadiness]);

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
        async (variantId: string, signal: AbortSignal | undefined, silent: boolean) => {
            if (!silent) setStopsLoading(true);
            setStopsError("");
            try {
                const result = await getTransportVariantOrderedStops(
                    variantId,
                    signal ? { signal } : undefined,
                );
                setStops(result.ordered_stops.map(orderedStopLiteToItem));
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
            } catch (err) {
                if (isAbortError(err)) return;
                setStops([]);
                setPath(null);
                setStopsError(err instanceof Error ? err.message : "Failed to load stops.");
            } finally {
                if (!silent) setStopsLoading(false);
            }
        },
        [loadVariantPath],
    );

    useEffect(() => {
        if (!selectedVariantId || !reviewMapOpen) {
            if (!selectedVariantId) {
                setStops([]);
                setPath(null);
            }
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
        (result: TransportRouteStopMutationResult) => {
            // Safe fallback: if the backend response is missing the updated ordered
            // stops, refetch ONLY the selected variant's ordered stops (no detail /
            // variants / routes-list refetch).
            if (!Array.isArray(result.ordered_stops)) {
                void refreshStops();
                return;
            }

            setStops(result.ordered_stops.map(orderedStopLiteToItem));

            const variantId = result.variant_public_id ?? selectedVariantId;
            if (!variantId) return;
            const current = variants.find((v) => v.public_id === variantId);
            const delta = current ? result.route_stop_count - current.stop_count : 0;
            setVariants((prev) =>
                prev.map((v) =>
                    v.public_id === variantId
                        ? { ...v, stop_count: result.route_stop_count }
                        : v,
                ),
            );
            if (delta !== 0) {
                setRoute((r) =>
                    r
                        ? {
                              ...r,
                              counts: {
                                  ...r.counts,
                                  stops: Math.max(0, r.counts.stops + delta),
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
            // Close the insert dialog/picker first. These are full-screen overlays
            // stacked above the route drawer, so they must never linger if applying
            // the result below throws (otherwise the drawer can't be closed).
            setInsertContext(null);
            setPickingLocation(false);
            setNewStopPoint(null);
            applyMutationResult(result);
        },
        [applyMutationResult],
    );


    // --- Ordered stops as preview points (lng/lat + sequence + name). --------
    const reviewMapSavedRouteStops = useMemo(
        () => routeStopItemsToPreviewStops(stops),
        [stops],
    );

    const reviewMapMovedStopIds = useMemo(
        () => new Set(Object.keys(reviewMapStopDrafts)),
        [reviewMapStopDrafts],
    );

    const reviewMapSelectedStopHasUnsaved = Boolean(
        reviewMapSelectedStopId && reviewMapStopDrafts[reviewMapSelectedStopId],
    );

    const reviewMapHasUnsavedMoves = reviewMapMovedStopIds.size > 0;

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

    const generatePathReadiness = useMemo(
        () => evaluateGeneratePathFromStopsReadiness(stops, reviewMapHasUnsavedMoves),
        [stops, reviewMapHasUnsavedMoves],
    );

    const selectedVariant = variants.find((v) => v.public_id === selectedVariantId) ?? null;
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
        setNewStopPoint(null);
        setPickingLocation(false);
        setPathMode(null);
        setDraftPath([]);
        setPathError("");
        setConfirmDeletePath(false);
        setReviewMapSelectedStopId(null);
        setReviewMapStopDrafts({});
    }, []);

    const openInsert = useCallback(
        (context: InsertStopContext) => {
            // Stop placement and path drawing both use map clicks — never both.
            if (pathMode !== null) return;
            setStopActionError("");
            setNewStopPoint(null);
            setPickingLocation(false);
            setInsertContext(context);
        },
        [pathMode],
    );

    const cancelInsert = useCallback(() => {
        if (stopMutating) return;
        setInsertContext(null);
        setNewStopPoint(null);
        setPickingLocation(false);
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
                // Update ordered stops + map overlay + counts from the response; no
                // detail/variants/stops refetch.
                applyMutationResult(result);
            } catch (err) {
                if (isAbortError(err)) return;
                setStopActionError(
                    err instanceof Error ? err.message : "Stop action failed.",
                );
            } finally {
                setStopMutating(false);
            }
        })();
    }, [removeTarget, removeReason, applyMutationResult]);

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
            setStopActionError("");
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
                setStopActionError(
                    err instanceof Error ? err.message : "Failed to mark stop reviewed."
                );
                throw err;
            } finally {
                setStopReviewBusy(null);
            }
        },
        []
    );

    const markSelectedStopReviewed = useCallback(async () => {
        const row = reviewMapSelectedStopId
            ? stops.find((stop) => stop.id === reviewMapSelectedStopId)
            : null;
        if (!row) {
            return;
        }
        await markStopReviewed(row.stop.public_id);
        setReviewMapSaveSuccess("Stop marked reviewed");
        window.setTimeout(() => setReviewMapSaveSuccess(null), 3200);
    }, [reviewMapSelectedStopId, stops, markStopReviewed]);

    const markVariantPathReviewed = useCallback(async () => {
        if (!path?.id) {
            return;
        }
        const result = await applyTransportRoutePathReviewAction(path.id, "mark_reviewed");
        setPath((prev) => (prev ? { ...prev, review_status: result.review_status } : prev));
        void loadReadiness();
        setReviewMapSaveSuccess("Route path marked reviewed");
        window.setTimeout(() => setReviewMapSaveSuccess(null), 3200);
    }, [path, loadReadiness]);

    const markRouteReviewed = useCallback(async () => {
        if (!route) {
            return;
        }
        const result = await applyTransportRouteReviewAction(route.public_id, "mark_reviewed");
        setRoute({ ...route, review_status: result.review_status });
        void loadReadiness();
        setReviewMapSaveSuccess("Route marked reviewed");
        window.setTimeout(() => setReviewMapSaveSuccess(null), 3200);
    }, [route, loadReadiness]);

    const refreshOrderedStops = useCallback(() => {
        if (!selectedVariantId) return;
        void loadStops(selectedVariantId, undefined, true);
        if (selectedVariantId) {
            void (async () => {
                try {
                    const quality = await getTransportVariantStopQuality(selectedVariantId);
                    setStopQuality(new Map(quality.items.map((item) => [item.route_stop_id, item])));
                } catch {
                    // non-fatal
                }
            })();
        }
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
                      readiness,
                      stopsWithoutLocation: stops.filter((s) => !s.stop.geometry).length,
                      usesPlaceholderReviewPoints,
                  })
                : [],
        [route, variants, readiness, stops, usesPlaceholderReviewPoints],
    );

    const toggleReviewMap = useCallback(() => {
        setReviewMapOpen((open) => {
            const next = !open;
            if (!next) {
                setReviewMapSelectedStopId(null);
                setReviewMapStopDrafts({});
            } else if (!selectedVariantId && variants[0]) {
                setSelectedVariantId(variants[0].public_id);
            }
            return next;
        });
    }, [selectedVariantId, variants]);

    const openReviewMapForVariant = useCallback(
        (variantId: string) => {
            selectVariant(variantId);
            setReviewMapSelectedStopId(null);
            setReviewMapStopDrafts({});
            setReviewMapOpen(true);
        },
        [selectVariant],
    );

    const closeReviewMap = useCallback(() => {
        setReviewMapOpen(false);
        setReviewMapSelectedStopId(null);
        setReviewMapStopDrafts({});
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
        setReviewMapSelectedStopId(null);
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
                setReviewMapSaveSuccess("Route path saved");
                window.setTimeout(() => setReviewMapSaveSuccess(null), 3200);
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
    ]);

    const revertReviewMapStopMoves = useCallback((routeStopId?: string) => {
        setReviewMapSaveError("");
        if (routeStopId) {
            setReviewMapStopDrafts((prev) => {
                if (!prev[routeStopId]) {
                    return prev;
                }
                const next = { ...prev };
                delete next[routeStopId];
                return next;
            });
            return;
        }
        setReviewMapStopDrafts({});
    }, []);

    const saveReviewMapStopMoves = useCallback(
        (options?: ReviewMapSaveOptions) => {
            const routeStopId = options?.routeStopId ?? reviewMapSelectedStopId;
            if (!routeStopId || reviewMapSaveLoading) {
                return;
            }
            const coords = reviewMapStopDrafts[routeStopId];
            if (!coords) {
                return;
            }

            void (async () => {
                setReviewMapSaveLoading(true);
                setReviewMapSaveError("");
                setReviewMapSaveSuccess(null);

                const row = stops.find((s) => s.id === routeStopId);
                if (!row) {
                    setReviewMapSaveError("No stop to save.");
                    setReviewMapSaveLoading(false);
                    return;
                }

                try {
                    const result = await updateTransportStopLocation(row.stop.public_id, {
                        lng: coords.lng,
                        lat: coords.lat,
                    });

                    const savedPoint = pointFromStopDetail(result.stop);
                    const savedLng = savedPoint?.lng ?? coords.lng;
                    const savedLat = savedPoint?.lat ?? coords.lat;

                    setStops((prev) =>
                        patchRouteStopGeometry(prev, routeStopId, savedLng, savedLat),
                    );
                    setReviewMapStopDrafts((prev) => {
                        if (!prev[routeStopId]) {
                            return prev;
                        }
                        const next = { ...prev };
                        delete next[routeStopId];
                        return next;
                    });

                    if (options?.thenSelectStopId !== undefined) {
                        setReviewMapSelectedStopId(options.thenSelectStopId);
                        if (options.thenSelectStopId) {
                            setReviewMapCenterStopRequest({
                                id: Date.now(),
                                stopId: options.thenSelectStopId,
                            });
                        }
                    }

                    setReviewMapSaveSuccess("Stop location saved");
                    window.setTimeout(() => setReviewMapSaveSuccess(null), 3200);
                } catch (err) {
                    if (isAbortError(err)) {
                        return;
                    }
                    setReviewMapSaveError(
                        err instanceof Error ? err.message : "Failed to save stop location.",
                    );
                } finally {
                    setReviewMapSaveLoading(false);
                }
            })();
        },
        [reviewMapStopDrafts, reviewMapSaveLoading, reviewMapSelectedStopId, stops],
    );

    const saveReviewMapStopAndNext = useCallback(() => {
        if (!reviewMapSelectedStopHasUnsaved || reviewMapSaveLoading || !reviewMapSelectedStopId) {
            return;
        }
        const idx = stops.findIndex((s) => s.id === reviewMapSelectedStopId);
        const nextStopId =
            idx < 0
                ? (stops[0]?.id ?? null)
                : idx >= stops.length - 1
                  ? (stops[idx]?.id ?? null)
                  : (stops[idx + 1]?.id ?? null);
        saveReviewMapStopMoves({
            routeStopId: reviewMapSelectedStopId,
            thenSelectStopId: nextStopId,
        });
    }, [
        reviewMapSelectedStopHasUnsaved,
        reviewMapSaveLoading,
        reviewMapSelectedStopId,
        stops,
        saveReviewMapStopMoves,
    ]);

    const handleReviewMapStopMovePreview = useCallback(
        (coords: { lng: number; lat: number }) => {
            if (!reviewMapSelectedStopId || pathMode !== null || isReviewMapPathEditMode(reviewMapMode)) {
                return;
            }
            const row = stops.find((s) => s.id === reviewMapSelectedStopId);
            if (!row) {
                return;
            }

            const geometry = row.stop.geometry;
            const origLng =
                geometry?.type === "Point" && Array.isArray(geometry.coordinates)
                    ? Number(geometry.coordinates[0])
                    : NaN;
            const origLat =
                geometry?.type === "Point" && Array.isArray(geometry.coordinates)
                    ? Number(geometry.coordinates[1])
                    : NaN;

            const matchesOriginal =
                Number.isFinite(origLng) &&
                Number.isFinite(origLat) &&
                Math.abs(origLng - coords.lng) < 1e-7 &&
                Math.abs(origLat - coords.lat) < 1e-7;

            setReviewMapStopDrafts((prev) => {
                if (matchesOriginal) {
                    if (!prev[reviewMapSelectedStopId]) {
                        return prev;
                    }
                    const next = { ...prev };
                    delete next[reviewMapSelectedStopId];
                    return next;
                }
                return { ...prev, [reviewMapSelectedStopId]: coords };
            });
            setReviewMapSaveError("");
        },
        [reviewMapSelectedStopId, stops, pathMode, reviewMapMode],
    );

    const reviewMapStopMoveHint = useMemo(() => {
        if (pathMode !== null || isReviewMapPathEditMode(reviewMapMode)) {
            return null;
        }
        if (reviewMapSelectedStopId) {
            return "Click the map to move this stop (preview only, not saved)";
        }
        return "Select a stop from the list, then click the map to move it";
    }, [pathMode, reviewMapMode, reviewMapSelectedStopId]);

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
                setReviewMapSaveSuccess(
                    result.warnings.length > 0
                        ? "Path generated with warnings"
                        : "Auto-generated path saved",
                );
                window.setTimeout(() => setReviewMapSaveSuccess(null), 3200);
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
    }, [generatePathLoading, generatePathReadiness.eligible, selectedVariantId]);

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
                <div className="mt-3 space-y-3">
                    <RouteSummaryCard route={route} routeLoading={routeLoading} />
                    <RouteVariantsCard
                        variants={variants}
                        routeLoading={routeLoading}
                        addingVariant={addingVariant}
                        onOpenReviewMap={openReviewMapForVariant}
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
                        loading={readinessLoading}
                    />
                    <CollapsibleSection
                        title="Advanced / Diagnostics"
                        description="Source data, review workflow, variant maintenance, and technical warnings."
                        open={advancedOpen}
                        onToggle={() => setAdvancedOpen((open) => !open)}
                    >
                        {readinessError ? (
                            <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                                {readinessError}
                            </p>
                        ) : null}
                        {readiness && readiness.blockers.length > 0 ? (
                            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                <p className="font-medium">Verification blockers</p>
                                <ul className="mt-1 list-inside list-disc space-y-0.5">
                                    {readiness.blockers.map((b) => (
                                        <li key={b}>{b}</li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                        {readiness && readiness.warnings.length > 0 ? (
                            <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                <p className="font-medium">Technical warnings</p>
                                <ul className="mt-1 list-inside list-disc space-y-0.5">
                                    {readiness.warnings.map((w) => (
                                        <li key={w}>{w}</li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                        {route && route.names.length > 0 ? (
                            <div className="mb-3">
                                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                                    Alternate names
                                </p>
                                <ul className="space-y-1 text-sm text-gray-700">
                                    {route.names.map((n, i) => (
                                        <li key={`${n.name}-${i}`} className="flex items-center gap-2">
                                            <span>{n.name}</span>
                                            <span className="text-xs text-gray-400">
                                                {n.language_code}
                                                {n.is_primary ? " · primary" : ""}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                        {route && route.sources.length > 0 ? (
                            <div className="mb-3">
                                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                                    Source links
                                </p>
                                <ul className="space-y-2 text-sm text-gray-700">
                                    {route.sources.map((s, i) => (
                                        <li
                                            key={`${s.source_name}-${s.external_id ?? i}`}
                                            className="rounded-md border border-gray-100 bg-gray-50 px-2.5 py-2 text-xs"
                                        >
                                            <p className="font-medium text-gray-900">{s.source_name}</p>
                                            <p className="text-gray-600">
                                                {s.source_kind}
                                                {s.external_id ? ` · ${s.external_id}` : ""}
                                                {s.is_primary ? " · primary" : ""}
                                            </p>
                                            {s.source_url ? (
                                                <p className="truncate text-gray-500">{s.source_url}</p>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <p className="mb-3 text-sm text-gray-500">No source links on this route.</p>
                        )}
                        {path?.normalized_data ? (
                            <details className="mb-3 text-xs">
                                <summary className="cursor-pointer font-medium text-gray-700">
                                    Path normalized_data
                                </summary>
                                <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-800">
                                    {JSON.stringify(path.normalized_data, null, 2)}
                                </pre>
                            </details>
                        ) : null}
                        {sequenceWarnings.length > 0 ? (
                            <ul className="mb-3 list-inside list-disc text-xs text-amber-900">
                                {sequenceWarnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                ))}
                            </ul>
                        ) : null}
                        {route ? (
                            <TransportRouteReviewPanel
                                route={route}
                                path={path}
                                onRouteUpdated={handleRouteReviewUpdated}
                                readiness={readiness}
                                readinessLoading={readinessLoading}
                                readinessError={readinessError}
                                onReadinessReload={reloadReadiness}
                            />
                        ) : null}

                        {selectedVariantId ? (
                            <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Route path editor
                                </h3>
                                <p className="mt-1 text-xs text-gray-500">
                                    Create or edit the verified path for the selected variant.
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {hasPathOverlay ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={startEditPath}
                                                disabled={pickingLocation}
                                                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                Edit path
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setPathError("");
                                                    setConfirmDeletePath(true);
                                                }}
                                                disabled={pickingLocation}
                                                className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                Delete path
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={startCreatePath}
                                            disabled={pickingLocation}
                                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Create path
                                        </button>
                                    )}
                                </div>
                                {pathError ? (
                                    <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                                        {pathError}
                                    </p>
                                ) : null}
                                {pathMode ? (
                                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                                        <span className="text-xs text-gray-500">
                                            {draftPath.length} point
                                            {draftPath.length === 1 ? "" : "s"} — click the Review
                                            Map to place vertices
                                        </span>
                                        <span className="flex-1" />
                                        <button
                                            type="button"
                                            onClick={undoDraftPoint}
                                            disabled={pathMutating || draftPath.length === 0}
                                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            Undo
                                        </button>
                                        <button
                                            type="button"
                                            onClick={cancelPathEdit}
                                            disabled={pathMutating}
                                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={savePath}
                                            disabled={pathMutating || draftPath.length < 2}
                                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                        >
                                            {pathMutating ? "Saving…" : "Save path"}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {selectedVariant ? (
                            <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                                <div className="mb-2 flex items-center justify-between">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Variant maintenance · {selectedVariant.variant_code}
                                    </h3>
                                    {!editingVariant ? (
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setVariantActionError("");
                                                    setConfirmDeleteVariant(false);
                                                    setEditingVariant(true);
                                                }}
                                                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                Edit variant
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setVariantActionError("");
                                                    setConfirmDeleteVariant(true);
                                                }}
                                                className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                                            >
                                                Delete variant
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
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
                                            <button
                                                type="button"
                                                disabled={variantMutating}
                                                onClick={() => setConfirmDeleteVariant(false)}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                disabled={variantMutating}
                                                onClick={confirmDeleteSelectedVariant}
                                                className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
                                            >
                                                {variantMutating ? "Deleting…" : "Delete variant"}
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                                {editingVariant ? (
                                    <TransportVariantForm
                                        key={selectedVariant.public_id}
                                        variant={selectedVariant}
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
                            </section>
                        ) : null}
                    </CollapsibleSection>
                </div>
            )}

            <TransportRouteReviewMapShell
                open={reviewMapOpen}
                onExit={closeReviewMap}
                routeCode={route?.route_code ?? ""}
                routeDisplayName={routeDisplayName}
                variants={variants}
                selectedVariantId={selectedVariantId}
                onVariantChange={selectVariant}
                stops={stops}
                stopsLoading={stopsLoading}
                stopsError={stopsError}
                routePathInfo={path}
                routeStops={reviewMapSavedRouteStops}
                stopMoveDrafts={reviewMapStopDrafts}
                mapAutoFitKey={selectedVariantId}
                selectedStopId={reviewMapSelectedStopId}
                onSelectStop={setReviewMapSelectedStopId}
                movedStopIds={reviewMapMovedStopIds}
                hasUnsavedChanges={reviewMapHasUnsavedMoves}
                selectedStopHasUnsaved={reviewMapSelectedStopHasUnsaved}
                saveLoading={reviewMapSaveLoading}
                saveError={reviewMapSaveError}
                saveSuccessMessage={reviewMapSaveSuccess}
                onSave={saveReviewMapStopMoves}
                onSaveAndNext={saveReviewMapStopAndNext}
                onRevert={revertReviewMapStopMoves}
                onStopMovePreview={
                    pathMode === null &&
                    !isReviewMapPathEditMode(reviewMapMode) &&
                    reviewMapSelectedStopId &&
                    !reviewMapSaveLoading
                        ? handleReviewMapStopMovePreview
                        : undefined
                }
                stopMoveHint={reviewMapStopMoveHint}
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
                centerStopRequest={reviewMapCenterStopRequest}
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

            {pickingLocation ? (
                <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
                    <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm shadow-lg">
                        <span className="text-slate-700">
                            {newStopPoint
                                ? `Location set: ${newStopPoint.lng.toFixed(5)}, ${newStopPoint.lat.toFixed(5)}`
                                : "Click the route map to set the new stop location"}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPickingLocation(false)}
                            disabled={!newStopPoint}
                            className="rounded-full bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                        >
                            Done
                        </button>
                        <button
                            type="button"
                            onClick={() => setPickingLocation(false)}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Back to form
                        </button>
                    </div>
                </div>
            ) : null}

            <InsertRouteStopDialog
                open={insertContext !== null}
                context={insertContext}
                variantPublicId={selectedVariantId}
                routeMode={route?.mode ?? null}
                draftPoint={newStopPoint}
                onDraftPointChange={setNewStopPoint}
                picking={pickingLocation}
                onStartPick={() => setPickingLocation(true)}
                onCancel={cancelInsert}
                onInserted={handleStopInserted}
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
        </>
    );
}
