"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import {
    deleteTransportRouteVariant,
    deleteTransportVariantPath,
    getTransportRouteDetail,
    getTransportRouteVariants,
    getTransportVariantOrderedStops,
    getTransportVariantStops,
    getTransportVariantStopQuality,
    putTransportVariantPath,
    removeTransportRouteStop,
    updateTransportRouteStop,
} from "./api";
import { transportModeLabel, transportReviewStatusLabel } from "./constants";
import { getTransportDisplayNameFromNames } from "./naming";
import InsertRouteStopDialog, {
    type InsertStopContext,
    type InsertStopLngLat,
} from "./InsertRouteStopDialog";
import RemoveRouteStopDialog from "./RemoveRouteStopDialog";
import TransportPreviewMap, { type TransportPreviewStop } from "./TransportPreviewMap";
import { TransportRouteEditForm, TransportVariantForm } from "./transportEditForms";
import type {
    TransportOrderedStopLite,
    TransportRouteDetail,
    TransportRouteStopItem,
    TransportRouteStopMutationResult,
    TransportRoutePath,
    TransportVariantStopQualityItem,
    TransportVariantSummary,
} from "./types";

const MAP_DEFAULT_ZOOM = 11;

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
        stop: {
            public_id: s.stop_public_id,
            name: s.display_name,
            name_mm: s.name_mm,
            name_en: s.name_en,
            mode: s.mode,
            stop_type: s.stop_type,
            geometry,
        },
    };
}

const PICKUP_DROP_OPTIONS = [
    { value: 0, label: "0 · Regular" },
    { value: 1, label: "1 · None" },
    { value: 2, label: "2 · Phone agency" },
    { value: 3, label: "3 · Coordinate w/ driver" },
] as const;

function reviewStatusBadgeClass(status: string): string {
    switch (status) {
        case "verified":
            return "bg-emerald-50 text-emerald-800 ring-emerald-100";
        case "reviewed":
            return "bg-blue-50 text-blue-800 ring-blue-100";
        case "needs_review":
            return "bg-amber-50 text-amber-900 ring-amber-100";
        case "rejected":
            return "bg-red-50 text-red-800 ring-red-100";
        case "manual_protected":
            return "bg-purple-50 text-purple-800 ring-purple-100";
        default:
            return "bg-gray-100 text-gray-700 ring-gray-200";
    }
}

function StatusBadge({ status }: { readonly status: string }) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${reviewStatusBadgeClass(status)}`}
        >
            {transportReviewStatusLabel(status)}
        </span>
    );
}

function InfoRow({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
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
    hideHeader = false,
}: TransportRouteDetailContentProps) {
    const [route, setRoute] = useState<TransportRouteDetail | null>(null);
    const [routeLoading, setRouteLoading] = useState(true);
    const [routeError, setRouteError] = useState("");

    const [variants, setVariants] = useState<readonly TransportVariantSummary[]>([]);
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
        setInsertContext(null);
        setNewStopPoint(null);
        setPickingLocation(false);
        setPathMode(null);
        setDraftPath([]);
        setPathError("");
        setConfirmDeletePath(false);

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

    // --- Load the verified route path overlay (solid line + distance). Secondary
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
                if (result.has_verified_path) {
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
        if (!selectedVariantId) {
            setStops([]);
            setPath(null);
            return;
        }
        const controller = new AbortController();
        void loadStops(selectedVariantId, controller.signal, false);
        return () => controller.abort();
    }, [selectedVariantId, loadStops]);

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
        if (!selectedVariantId || stopsSignature === "") {
            setStopQuality(new Map());
            setStopQualityLoading(false);
            return;
        }
        const controller = new AbortController();
        void loadStopQuality(selectedVariantId, controller.signal);
        return () => controller.abort();
    }, [selectedVariantId, stopsSignature, loadStopQuality]);

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
    const routeStops = useMemo<TransportPreviewStop[]>(() => {
        const out: TransportPreviewStop[] = [];
        for (const s of stops) {
            const g = s.stop.geometry;
            if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) {
                continue;
            }
            const lng = Number(g.coordinates[0]);
            const lat = Number(g.coordinates[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                continue;
            }
            out.push({ lng, lat, sequence: s.stop_sequence, name: s.stop.name });
        }
        return out;
    }, [stops]);

    const selectedVariant = variants.find((v) => v.public_id === selectedVariantId) ?? null;
    const hasVerifiedPath = Boolean(path?.geometry);

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
            if (hasVerifiedPath) {
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
        if (!hasVerifiedPath) {
            warnings.push("Stop sequence preview only — not verified route path.");
        }
        return warnings;
    }, [selectedVariantId, stopsLoading, stops, hasVerifiedPath]);

    const selectVariant = useCallback((variantId: string) => {
        setSelectedVariantId(variantId);
        setEditingVariant(false);
        setConfirmDeleteVariant(false);
        setVariantActionError("");
        setSelectedStopId(null);
        setStopActionError("");
        setRemoveTarget(null);
        setRemoveReason("");
        setInsertContext(null);
        setNewStopPoint(null);
        setPickingLocation(false);
        setPathMode(null);
        setDraftPath([]);
        setPathError("");
        setConfirmDeletePath(false);
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

    /**
     * Refresh route detail + variants after a variant create/update/delete, keeping
     * the route open. `selectId` controls selection: a public_id selects it (new
     * variant), `null` falls back to the first remaining variant (after delete),
     * and `undefined` keeps the current selection when it still exists.
     */
    const reloadRouteAndVariants = useCallback(
        async (selectId?: string | null) => {
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
            afterSave?.();
        },
        [publicId, afterSave],
    );

    const handleVariantCreated = useCallback(
        (created: TransportVariantSummary) => {
            setAddingVariant(false);
            setVariantActionError("");
            void reloadRouteAndVariants(created.public_id);
        },
        [reloadRouteAndVariants],
    );

    const handleVariantSaved = useCallback(
        (updated: TransportVariantSummary) => {
            setEditingVariant(false);
            setVariantActionError("");
            // Keep the edited variant selected; refresh detail + variants.
            void reloadRouteAndVariants(updated.public_id);
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
                await reloadRouteAndVariants(null);
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
    }, []);

    const startEditPath = useCallback(() => {
        setPathError("");
        setConfirmDeletePath(false);
        setDraftPath(lineStringDraftCoords(path?.geometry ?? null));
        setPathMode("edit");
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
                await reloadRouteAndVariants(selectedVariantId);
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
    }, [selectedVariantId, draftPath, reloadRouteAndVariants, loadStopQuality]);

    const confirmDeletePathNow = useCallback(() => {
        if (!selectedVariantId) return;
        void (async () => {
            setPathMutating(true);
            setPathError("");
            try {
                const result = await deleteTransportVariantPath(selectedVariantId);
                setConfirmDeletePath(false);
                setPath(result.path);
                await reloadRouteAndVariants(selectedVariantId);
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
    }, [selectedVariantId, reloadRouteAndVariants, loadStopQuality]);

    // Display title: Myanmar name → English name → route code. Never a raw/
    // generated/imported name (those stay in the Names / debug sections only).
    const routeDisplayName = route
        ? getTransportDisplayNameFromNames(route.name_mm, route.name_en, route.route_code)
        : "";

    return (
        <>
            {/* Header */}
            {!hideHeader ? (
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4">
                    <div className="min-w-0">
                        {onClose ? (
                            <button
                                type="button"
                                onClick={onClose}
                                className="text-sm text-gray-500 hover:text-gray-900"
                            >
                                ← Back to routes
                            </button>
                        ) : (
                            <Link
                                href={transportPath("routes")}
                                className="text-sm text-gray-500 hover:text-gray-900"
                            >
                                ← Back to routes
                            </Link>
                        )}
                        {routeLoading ? (
                            <div className="mt-2 h-7 w-64 animate-pulse rounded bg-gray-200" />
                        ) : route ? (
                            <div className="mt-1 flex flex-wrap items-center gap-3">
                                <h1 className="text-2xl font-bold text-gray-900">
                                    <span className="rounded bg-gray-900 px-2 py-0.5 text-white">
                                        {route.route_code}
                                    </span>{" "}
                                    {routeDisplayName}
                                </h1>
                                <StatusBadge status={route.review_status} />
                                <span className="text-sm text-gray-500">
                                    {transportModeLabel(route.mode)} · {route.route_kind}
                                </span>
                                {route.is_active ? (
                                    <span className="text-sm text-emerald-700">Active</span>
                                ) : (
                                    <span className="text-sm text-gray-400">Inactive</span>
                                )}
                            </div>
                        ) : null}
                    </div>
                </header>
            ) : null}

            {routeError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {routeError}
                </div>
            ) : null}

            {/* Workspace grid: left info+variants · center map · right stops */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)_360px]">
                {/* Left: route info + variants */}
                <aside className="space-y-4">
                    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                Route info
                            </h2>
                            {route && !editingRoute ? (
                                <button
                                    type="button"
                                    onClick={() => setEditingRoute(true)}
                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Edit
                                </button>
                            ) : null}
                        </div>
                        {routeLoading ? (
                            <div className="space-y-2">
                                {[0, 1, 2, 3].map((i) => (
                                    <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />
                                ))}
                            </div>
                        ) : route && editingRoute ? (
                            <TransportRouteEditForm
                                route={route}
                                onCancel={() => setEditingRoute(false)}
                                onSaved={handleRouteSaved}
                            />
                        ) : route ? (
                            <>
                                <div className="divide-y divide-gray-100">
                                    <InfoRow label="Display name" value={routeDisplayName} />
                                    <InfoRow label="Myanmar name" value={route.name_mm ?? "—"} />
                                    <InfoRow label="English name" value={route.name_en ?? "—"} />
                                    <InfoRow label="Route code" value={route.route_code} />
                                    <InfoRow label="Origin" value={route.origin_name ?? "—"} />
                                    <InfoRow
                                        label="Destination"
                                        value={route.destination_name ?? "—"}
                                    />
                                    <InfoRow label="Operator" value={route.operator?.name || "—"} />
                                    <InfoRow
                                        label="Confidence"
                                        value={
                                            route.confidence_score === null
                                                ? "—"
                                                : Math.round(route.confidence_score)
                                        }
                                    />
                                    <InfoRow label="Variants" value={route.counts.variants} />
                                    <InfoRow label="Stops" value={route.counts.stops} />
                                    <InfoRow label="Paths" value={route.counts.paths} />
                                </div>
                                {route.names && route.names.length > 0 ? (
                                    <div className="mt-3 border-t border-gray-100 pt-3">
                                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Names
                                        </p>
                                        <ul className="space-y-1 text-sm text-gray-700">
                                            {route.names.slice(0, 6).map((n, i) => (
                                                <li
                                                    key={`${n.name}-${i}`}
                                                    className="flex items-center gap-2"
                                                >
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
                            </>
                        ) : null}
                    </section>

                    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                Variants {variants.length > 0 ? `(${variants.length})` : ""}
                            </h2>
                            {route && !addingVariant ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setVariantActionError("");
                                        setAddingVariant(true);
                                    }}
                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    + Add variant
                                </button>
                            ) : null}
                        </div>
                        {addingVariant ? (
                            <div className="border-b border-gray-100 bg-gray-50/60 p-4">
                                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                                    New variant
                                </p>
                                <TransportVariantForm
                                    routePublicId={publicId}
                                    onCancel={() => setAddingVariant(false)}
                                    onSaved={handleVariantCreated}
                                />
                            </div>
                        ) : null}
                        {routeLoading ? (
                            <div className="space-y-2 p-4">
                                {[0, 1].map((i) => (
                                    <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />
                                ))}
                            </div>
                        ) : variants.length === 0 ? (
                            <p className="px-4 py-6 text-center text-sm text-gray-500">
                                No variants for this route.
                            </p>
                        ) : (
                            <ul className="max-h-[320px] overflow-y-auto">
                                {variants.map((v) => {
                                    const active = v.public_id === selectedVariantId;
                                    return (
                                        <li key={v.public_id}>
                                            <button
                                                type="button"
                                                onClick={() => selectVariant(v.public_id)}
                                                className={`flex w-full flex-col items-start gap-1 border-b border-gray-100 px-4 py-3 text-left text-sm hover:bg-gray-50 ${active ? "bg-blue-50/60" : ""}`}
                                            >
                                                <div className="flex w-full items-center justify-between gap-2">
                                                    <span className="font-medium text-gray-900">
                                                        {v.variant_code}
                                                        {v.direction_name
                                                            ? ` · ${v.direction_name}`
                                                            : ""}
                                                    </span>
                                                    {v.path_status === "has_path" ? (
                                                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-100">
                                                            Path
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-100">
                                                            No path
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-xs text-gray-500">
                                                    {v.headsign || v.destination_name || "—"}
                                                </span>
                                                <span className="text-xs text-gray-400">
                                                    {v.stop_count} stops · {formatDistance(v.distance_m)}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>

                    {selectedVariant ? (
                        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="mb-2 flex items-center justify-between">
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                    Selected variant
                                </h2>
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
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setVariantActionError("");
                                                setConfirmDeleteVariant(true);
                                            }}
                                            className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                                        >
                                            Delete
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
                                <div className="divide-y divide-gray-100">
                                    <InfoRow label="Variant code" value={selectedVariant.variant_code} />
                                    <InfoRow
                                        label="Direction"
                                        value={selectedVariant.direction_name ?? "—"}
                                    />
                                    <InfoRow
                                        label="Headsign"
                                        value={selectedVariant.headsign ?? "—"}
                                    />
                                    <InfoRow
                                        label="Duration"
                                        value={
                                            selectedVariant.estimated_duration_min === null
                                                ? "—"
                                                : `${selectedVariant.estimated_duration_min} min`
                                        }
                                    />
                                    <InfoRow
                                        label="Review status"
                                        value={transportReviewStatusLabel(
                                            selectedVariant.review_status
                                        )}
                                    />
                                    <InfoRow
                                        label="Confidence"
                                        value={
                                            selectedVariant.confidence_score === null
                                                ? "—"
                                                : Math.round(selectedVariant.confidence_score)
                                        }
                                    />
                                    <InfoRow
                                        label="Active"
                                        value={selectedVariant.is_active ? "Active" : "Inactive"}
                                    />
                                </div>
                            )}
                        </section>
                    ) : null}
                </aside>

                {/* Center: persistent map */}
                <section className="flex flex-col gap-2">
                    <TransportPreviewMap
                        title={route ? `${route.route_code} · ${routeDisplayName}` : "Route"}
                        externalId={selectedVariant?.public_id ?? route?.public_id ?? null}
                        subtitle={
                            selectedVariant
                                ? selectedVariant.headsign ??
                                  selectedVariant.direction_name ??
                                  selectedVariant.variant_code
                                : null
                        }
                        routePath={path?.geometry ?? null}
                        routeStops={routeStops}
                        autoFitKey={selectedVariantId}
                        initialZoom={MAP_DEFAULT_ZOOM}
                        editablePoint={pickingLocation ? newStopPoint : null}
                        editablePointColor="#16a34a"
                        pointDraggable={pickingLocation}
                        onPointChange={pickingLocation ? setNewStopPoint : undefined}
                        draftPath={pathMode ? draftPath : null}
                        pathDrawing={pathMode !== null}
                        onDraftPathAddPoint={pathMode ? addDraftPoint : undefined}
                        editingHint={
                            pathMode
                                ? "Click the map to add path points"
                                : pickingLocation
                                  ? "Click the map to set the new stop location"
                                  : null
                        }
                        emptyHint={
                            variants.length === 0
                                ? "No variants to display on the map."
                                : "No route path or ordered stops available"
                        }
                    />

                    {/* Legend / path provenance + load status. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs">
                        {selectedVariantId && stops.length > 0 ? (
                            hasVerifiedPath ? (
                                <span className="flex items-center gap-2 text-gray-700">
                                    <span className="inline-block h-1 w-5 rounded bg-[#2563eb]" />
                                    Verified route path
                                    {path?.distance_m
                                        ? ` · ${formatDistance(path.distance_m)}`
                                        : ""}
                                </span>
                            ) : (
                                <span className="flex items-center gap-2 text-amber-900">
                                    <span
                                        className="inline-block h-0 w-5 border-t-2 border-dashed border-[#d97706]"
                                        aria-hidden
                                    />
                                    Stop sequence preview only — not verified route path
                                </span>
                            )
                        ) : null}
                        {stopsLoading ? (
                            <span className="text-gray-500">Loading stops…</span>
                        ) : null}
                    </div>

                    {/* Route path editor (selected variant only). */}
                    {selectedVariantId ? (
                        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Route path
                                </h3>
                                {pathMode ? (
                                    <span className="text-xs text-gray-500">
                                        {draftPath.length} point
                                        {draftPath.length === 1 ? "" : "s"}
                                    </span>
                                ) : null}
                            </div>

                            {pathError ? (
                                <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                                    {pathError}
                                </p>
                            ) : null}

                            {pathMode ? (
                                <>
                                    <p className="mt-2 text-xs text-gray-600">
                                        Click the map to add points. Need at least 2
                                        points to save. No road snapping — vertices are
                                        saved exactly as placed.
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={undoDraftPoint}
                                            disabled={pathMutating || draftPath.length === 0}
                                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Undo last
                                        </button>
                                        <button
                                            type="button"
                                            onClick={clearDraft}
                                            disabled={pathMutating || draftPath.length === 0}
                                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Clear draft
                                        </button>
                                        <span className="flex-1" />
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
                                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {pathMutating ? "Saving…" : "Save path"}
                                        </button>
                                    </div>
                                </>
                            ) : confirmDeletePath ? (
                                <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
                                    <p className="text-xs text-red-800">
                                        Delete this route path? The stop sequence and
                                        stops are kept.
                                    </p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDeletePath(false)}
                                            disabled={pathMutating}
                                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={confirmDeletePathNow}
                                            disabled={pathMutating}
                                            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
                                        >
                                            {pathMutating ? "Deleting…" : "Delete path"}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {hasVerifiedPath ? (
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
                                    {pickingLocation ? (
                                        <span className="text-xs text-gray-400">
                                            Finish placing the stop first
                                        </span>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    ) : null}
                </section>

                {/* Right: ordered stops list */}
                <aside className="rounded-lg border border-gray-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                            Ordered stops
                        </h2>
                        {selectedVariant ? (
                            <span className="flex items-center gap-2 text-xs text-gray-400">
                                {stopQualityLoading ? (
                                    <span className="text-gray-400">checking…</span>
                                ) : null}
                                <span>{stops.length}</span>
                            </span>
                        ) : null}
                    </div>

                    {sequenceWarnings.length > 0 ? (
                        <ul className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                            {sequenceWarnings.map((warning) => (
                                <li key={warning} className="flex items-start gap-1.5">
                                    <span aria-hidden className="mt-px">
                                        ⚠
                                    </span>
                                    <span>{warning}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}

                    {selectedVariantId && stops.length > 0 ? (
                        <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                            Changing stop order affects this route variant only.
                        </p>
                    ) : null}

                    {stopsError ? (
                        <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {stopsError}
                        </div>
                    ) : null}
                    {stopActionError && removeTarget === null ? (
                        <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {stopActionError}
                        </div>
                    ) : null}

                    {stopsLoading ? (
                        <div className="space-y-2 p-4">
                            {[0, 1, 2, 3, 4].map((i) => (
                                <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
                            ))}
                        </div>
                    ) : !selectedVariantId ? (
                        <p className="px-4 py-6 text-center text-sm text-gray-500">
                            Select a variant to view its stops.
                        </p>
                    ) : stops.length === 0 ? (
                        <div className="px-1 py-4">
                            <p className="px-3 pb-2 text-center text-sm text-gray-500">
                                This variant has no ordered stops.
                            </p>
                            <InsertStopButton
                                label="+ Add first stop"
                                disabled={stopMutating}
                                onClick={() =>
                                    openInsert({
                                        uiPosition: "first",
                                        apiPosition: "start",
                                        anchorRouteStopId: null,
                                        previousStop: null,
                                        nextStop: null,
                                        near: null,
                                    })
                                }
                            />
                        </div>
                    ) : (
                        <div className="max-h-[60vh] overflow-y-auto">
                            <InsertStopButton
                                label="+ Insert stop at start"
                                disabled={stopMutating}
                                onClick={() =>
                                    openInsert({
                                        uiPosition: "start",
                                        apiPosition: "start",
                                        anchorRouteStopId: null,
                                        previousStop: null,
                                        nextStop: stopRef(stops[0]),
                                        near: pointOf(stops[0]),
                                    })
                                }
                            />
                            {stops.map((s, i) => {
                                const isSelected = s.id === selectedStopId;
                                const nextStop = stops[i + 1] ?? null;
                                const isLast = i === stops.length - 1;
                                const quality = stopQuality.get(s.id);
                                const qualityLine = stopQualitySummary(quality, hasVerifiedPath);
                                const nearbyDuplicates = quality?.nearby_duplicate_count ?? 0;
                                const exactDuplicate = quality?.is_exact_duplicate_in_variant ?? false;
                                return (
                                    <Fragment key={s.id}>
                                    <div className="border-b border-gray-100">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setSelectedStopId(isSelected ? null : s.id)
                                            }
                                            className={`flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50 ${isSelected ? "bg-blue-50/60" : ""}`}
                                        >
                                            <span className="mt-0.5 inline-flex h-6 min-w-9 flex-none items-center justify-center rounded-md bg-blue-100 px-1.5 text-xs font-semibold tabular-nums text-blue-800">
                                                #{s.stop_sequence}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-medium text-gray-900">
                                                    {s.stop.name}
                                                </p>
                                                <p className="truncate text-xs text-gray-500">
                                                    {transportModeLabel(s.stop.mode)} ·{" "}
                                                    {s.stop.stop_type}
                                                    {s.stop.geometry ? "" : " · no location"}
                                                    {s.is_timing_point ? " · timing point" : ""}
                                                </p>
                                                {qualityLine ? (
                                                    <p className="truncate text-xs text-gray-500">
                                                        {qualityLine}
                                                    </p>
                                                ) : null}
                                                {nearbyDuplicates > 0 || exactDuplicate ? (
                                                    <p className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                                                        {exactDuplicate ? (
                                                            <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700 ring-1 ring-red-100">
                                                                ⚠ Duplicate in variant
                                                            </span>
                                                        ) : null}
                                                        {nearbyDuplicates > 0 ? (
                                                            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 ring-1 ring-amber-100">
                                                                ⚠ {nearbyDuplicates} nearby stop
                                                                {nearbyDuplicates === 1 ? "" : "s"}
                                                            </span>
                                                        ) : null}
                                                    </p>
                                                ) : null}
                                            </div>
                                        </button>

                                        {isSelected ? (
                                            <div className="space-y-3 border-t border-gray-100 bg-gray-50/70 px-4 py-3">
                                                <div className="flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        disabled={stopMutating}
                                                        onClick={() => requestRemoveStop(s)}
                                                        className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>

                                                <div className="grid grid-cols-2 gap-2">
                                                    <label className="flex flex-col gap-1">
                                                        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                                            Pickup type
                                                        </span>
                                                        <select
                                                            disabled={stopMutating}
                                                            value={s.pickup_type}
                                                            onChange={(e) =>
                                                                updateStopFlag(s, {
                                                                    pickup_type: Number(
                                                                        e.target.value,
                                                                    ),
                                                                })
                                                            }
                                                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 disabled:opacity-50"
                                                        >
                                                            {PICKUP_DROP_OPTIONS.map((o) => (
                                                                <option key={o.value} value={o.value}>
                                                                    {o.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label className="flex flex-col gap-1">
                                                        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                                            Drop-off type
                                                        </span>
                                                        <select
                                                            disabled={stopMutating}
                                                            value={s.drop_off_type}
                                                            onChange={(e) =>
                                                                updateStopFlag(s, {
                                                                    drop_off_type: Number(
                                                                        e.target.value,
                                                                    ),
                                                                })
                                                            }
                                                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 disabled:opacity-50"
                                                        >
                                                            {PICKUP_DROP_OPTIONS.map((o) => (
                                                                <option key={o.value} value={o.value}>
                                                                    {o.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                </div>

                                                <label className="flex items-center gap-2 text-xs text-gray-700">
                                                    <input
                                                        type="checkbox"
                                                        disabled={stopMutating}
                                                        checked={s.is_timing_point}
                                                        onChange={(e) =>
                                                            updateStopFlag(s, {
                                                                is_timing_point: e.target.checked,
                                                            })
                                                        }
                                                        className="h-4 w-4 rounded border-gray-300"
                                                    />
                                                    Timing point
                                                </label>

                                                <Link
                                                    href={transportPath(
                                                        `stops/${s.stop.public_id}`,
                                                    )}
                                                    className="inline-block text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline"
                                                >
                                                    Edit stop location in Stop detail →
                                                </Link>
                                            </div>
                                        ) : null}
                                    </div>

                                    {isLast ? (
                                        <InsertStopButton
                                            label="+ Add stop at end"
                                            disabled={stopMutating}
                                            onClick={() =>
                                                openInsert({
                                                    uiPosition: "end",
                                                    apiPosition: "end",
                                                    anchorRouteStopId: null,
                                                    previousStop: stopRef(s),
                                                    nextStop: null,
                                                    near: pointOf(s),
                                                })
                                            }
                                        />
                                    ) : (
                                        <InsertStopButton
                                            label="+ Insert stop here"
                                            disabled={stopMutating}
                                            onClick={() =>
                                                openInsert({
                                                    uiPosition: "between",
                                                    apiPosition: "after",
                                                    anchorRouteStopId: s.id,
                                                    previousStop: stopRef(s),
                                                    nextStop: nextStop
                                                        ? stopRef(nextStop)
                                                        : null,
                                                    near: midpoint(
                                                        pointOf(s),
                                                        nextStop ? pointOf(nextStop) : null,
                                                    ),
                                                })
                                            }
                                        />
                                    )}
                                    </Fragment>
                                );
                            })}
                        </div>
                    )}
                </aside>
            </div>

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
        </>
    );
}
