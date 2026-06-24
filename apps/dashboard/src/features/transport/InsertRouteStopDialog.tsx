"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import {
    createAndInsertRouteStop,
    insertExistingRouteStop,
    searchTransportStops,
} from "./api";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_STOP_TYPE_OPTIONS,
    transportModeLabel,
    transportReviewStatusLabel,
} from "./constants";
import type {
    CreateAndInsertRouteStopBody,
    InsertExistingRouteStopBody,
    TransportStopSearchItem,
} from "./types";

/** A compact stop reference used to describe the insert position in the dialog. */
type InsertStopRef = {
    readonly id: string;
    readonly name: string;
    readonly stop_sequence: number;
};

export type InsertStopLngLat = { readonly lng: number; readonly lat: number };

/**
 * Where a new stop will be inserted in the selected variant. The frontend never
 * computes a final stop_sequence; it only records a relative position (and an
 * anchor route_stop id when needed) that the insert API resolves server-side.
 *
 *  - uiPosition: which insert button was used (drives the human title).
 *  - apiPosition: the value sent to POST .../stops/insert-existing.
 *  - anchorRouteStopId: route_stops.id the insert anchors to (before/after only).
 *  - previousStop / nextStop: neighbours for context display, when available.
 *  - near: optional lng/lat used to seed nearby search (start→first stop,
 *    end→last stop, between→midpoint of neighbours); null when no context.
 */
export type InsertStopContext = {
    readonly uiPosition: "start" | "between" | "end" | "first";
    readonly apiPosition: "start" | "end" | "before" | "after";
    readonly anchorRouteStopId: string | null;
    readonly previousStop: InsertStopRef | null;
    readonly nextStop: InsertStopRef | null;
    readonly near: InsertStopLngLat | null;
};

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 25;
const NEARBY_RADIUS_M = 2000;
/** Radius used to warn about likely-duplicate stops near a new stop's location. */
const DUP_RADIUS_M = 200;
const DUP_LIMIT = 5;

type Tab = "existing" | "create";

function titleFor(context: InsertStopContext): string {
    switch (context.uiPosition) {
        case "first":
            return "Add first stop";
        case "start":
            return "Insert stop at start";
        case "between":
            return context.previousStop && context.nextStop
                ? `Insert stop between ${context.previousStop.name} and ${context.nextStop.name}`
                : "Insert stop here";
        case "end":
        default:
            return "Add stop at end";
    }
}

function formatDistance(meters: number | null): string | null {
    if (meters === null || !Number.isFinite(meters)) {
        return null;
    }
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function isValidLng(value: number): boolean {
    return Number.isFinite(value) && value >= -180 && value <= 180;
}

function isValidLat(value: number): boolean {
    return Number.isFinite(value) && value >= -90 && value <= 90;
}

/**
 * Insert Stop modal for the Route Detail page.
 *
 * Two ways to add a stop:
 *   1. "Choose existing stop" (default, primary): search existing stops by
 *      name/code or nearby, confirm, then call insert-existing.
 *   2. "Create new stop" (secondary): only when no correct existing stop exists.
 *      Minimal fields (localized names, mode, stop_type, location). Location is
 *      set by clicking the route map (handled by the parent via onStartPick) or
 *      by typing lon/lat. A nearby-duplicate warning nudges reuse. On confirm it
 *      creates the stop + inserts it in one backend transaction.
 *
 * The backend owns stop_sequence in both flows. On success the parent refreshes
 * the ordered stops + map overlay + counts. Closing is non-destructive.
 */
export default function InsertRouteStopDialog({
    open,
    context,
    variantPublicId,
    routeMode,
    draftPoint,
    onDraftPointChange,
    picking,
    onStartPick,
    onCancel,
    onInserted,
}: {
    readonly open: boolean;
    readonly context: InsertStopContext | null;
    readonly variantPublicId: string | null;
    /** Default mode for a newly created stop (the route's mode). */
    readonly routeMode: string | null;
    /** Lifted new-stop location, shared between map picking and manual entry. */
    readonly draftPoint: InsertStopLngLat | null;
    readonly onDraftPointChange: (point: InsertStopLngLat | null) => void;
    /** True while the parent map is in click-to-place mode (modal hidden). */
    readonly picking: boolean;
    /** Ask the parent to enter map click-to-place mode. */
    readonly onStartPick: () => void;
    readonly onCancel: () => void;
    /** Called after a successful insert so the host can refresh stops/map/counts. */
    readonly onInserted: () => void | Promise<void>;
}) {
    const titleId = useId();
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [tab, setTab] = useState<Tab>("existing");

    // --- Existing-stop search state. -----------------------------------------
    const [search, setSearch] = useState("");
    const [results, setResults] = useState<readonly TransportStopSearchItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchError, setSearchError] = useState("");
    const [selected, setSelected] = useState<TransportStopSearchItem | null>(null);

    // --- Create-stop form state (location lives in draftPoint, lifted up). ----
    const [nameMm, setNameMm] = useState("");
    const [nameEn, setNameEn] = useState("");
    const [mode, setMode] = useState("bus");
    const [stopType, setStopType] = useState("stop");
    const [lngText, setLngText] = useState("");
    const [latText, setLatText] = useState("");
    const [nearbyDup, setNearbyDup] = useState<readonly TransportStopSearchItem[]>([]);
    const [dupLoading, setDupLoading] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");

    // Reset everything whenever the modal opens (or the insert position changes).
    useEffect(() => {
        if (!open) {
            return;
        }
        setTab("existing");
        setSearch("");
        setResults([]);
        setSearchError("");
        setSelected(null);
        setNameMm("");
        setNameEn("");
        setMode(routeMode ?? "bus");
        setStopType("stop");
        setLngText("");
        setLatText("");
        setNearbyDup([]);
        setDupLoading(false);
        setSubmitting(false);
        setSubmitError("");
        onDraftPointChange(null);
        const t = window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return () => window.clearTimeout(t);
        // onDraftPointChange is stable; routeMode change shouldn't reset an open form.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, context]);

    // Keep the lon/lat text inputs in sync when the location is set elsewhere
    // (e.g. picked on the map). Manual typing updates draftPoint directly below.
    useEffect(() => {
        if (draftPoint) {
            setLngText(draftPoint.lng.toFixed(6));
            setLatText(draftPoint.lat.toFixed(6));
        }
    }, [draftPoint]);

    // Escape closes the modal (unless an insert is in flight or we're picking).
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !submitting && !picking) {
                onCancel();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, submitting, picking, onCancel]);

    const near = context?.near ?? null;
    const trimmedSearch = search.trim();
    const hasQuery = trimmedSearch.length > 0;
    const canSearch = hasQuery || near !== null;

    // Debounced existing-stop search (only relevant on the existing tab).
    useEffect(() => {
        if (!open || !context || tab !== "existing") {
            return;
        }
        if (!canSearch) {
            setResults([]);
            setSearchError("");
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        setSearchError("");
        const handle = window.setTimeout(() => {
            void (async () => {
                try {
                    const params = hasQuery
                        ? { search: trimmedSearch, limit: SEARCH_LIMIT }
                        : {
                              nearLng: near?.lng,
                              nearLat: near?.lat,
                              radiusMeters: NEARBY_RADIUS_M,
                              limit: SEARCH_LIMIT,
                          };
                    const res = await searchTransportStops(
                        {
                            ...params,
                            ...(variantPublicId
                                ? { excludeRouteVariantPublicId: variantPublicId }
                                : {}),
                        },
                        { signal: controller.signal }
                    );
                    setResults(res.items);
                } catch (err) {
                    if (isAbortError(err)) return;
                    setResults([]);
                    setSearchError(err instanceof Error ? err.message : "Search failed.");
                } finally {
                    setLoading(false);
                }
            })();
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            controller.abort();
            window.clearTimeout(handle);
        };
    }, [open, context, tab, canSearch, hasQuery, trimmedSearch, near, variantPublicId]);

    // Debounced nearby-duplicate check for the new-stop location (create tab).
    useEffect(() => {
        if (!open || tab !== "create" || !draftPoint) {
            setNearbyDup([]);
            setDupLoading(false);
            return;
        }
        const controller = new AbortController();
        setDupLoading(true);
        const handle = window.setTimeout(() => {
            void (async () => {
                try {
                    const res = await searchTransportStops(
                        {
                            nearLng: draftPoint.lng,
                            nearLat: draftPoint.lat,
                            radiusMeters: DUP_RADIUS_M,
                            limit: DUP_LIMIT,
                            ...(variantPublicId
                                ? { excludeRouteVariantPublicId: variantPublicId }
                                : {}),
                        },
                        { signal: controller.signal }
                    );
                    setNearbyDup(res.items);
                } catch (err) {
                    if (isAbortError(err)) return;
                    setNearbyDup([]);
                } finally {
                    setDupLoading(false);
                }
            })();
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            controller.abort();
            window.clearTimeout(handle);
        };
    }, [open, tab, draftPoint, variantPublicId]);

    const confirmInsertExisting = useCallback(async () => {
        if (!context || !variantPublicId || !selected) {
            return;
        }
        setSubmitting(true);
        setSubmitError("");
        try {
            const body: InsertExistingRouteStopBody = {
                stopPublicId: selected.public_id,
                position: context.apiPosition,
                ...(context.anchorRouteStopId
                    ? { anchorRouteStopId: context.anchorRouteStopId }
                    : {}),
            };
            await insertExistingRouteStop(variantPublicId, body);
            await onInserted();
            onCancel();
        } catch (err) {
            if (isAbortError(err)) return;
            setSubmitError(err instanceof Error ? err.message : "Failed to insert stop.");
            setSubmitting(false);
        }
    }, [context, variantPublicId, selected, onInserted, onCancel]);

    const trimmedMm = nameMm.trim();
    const trimmedEn = nameEn.trim();
    const hasName = trimmedMm.length > 0 || trimmedEn.length > 0;
    const hasValidPoint =
        draftPoint !== null && isValidLng(draftPoint.lng) && isValidLat(draftPoint.lat);
    const canCreate = hasName && hasValidPoint && mode.length > 0 && stopType.length > 0;

    const confirmCreate = useCallback(async () => {
        if (!context || !variantPublicId || !draftPoint || !canCreate) {
            return;
        }
        setSubmitting(true);
        setSubmitError("");
        try {
            const body: CreateAndInsertRouteStopBody = {
                ...(trimmedMm ? { name_mm: trimmedMm } : {}),
                ...(trimmedEn ? { name_en: trimmedEn } : {}),
                mode,
                stop_type: stopType,
                longitude: draftPoint.lng,
                latitude: draftPoint.lat,
                position: context.apiPosition,
                ...(context.anchorRouteStopId
                    ? { anchorRouteStopId: context.anchorRouteStopId }
                    : {}),
            };
            await createAndInsertRouteStop(variantPublicId, body);
            await onInserted();
            onCancel();
        } catch (err) {
            if (isAbortError(err)) return;
            setSubmitError(err instanceof Error ? err.message : "Failed to create and insert stop.");
            setSubmitting(false);
        }
    }, [
        context,
        variantPublicId,
        draftPoint,
        canCreate,
        trimmedMm,
        trimmedEn,
        mode,
        stopType,
        onInserted,
        onCancel,
    ]);

    const applyLngLatText = useCallback(
        (nextLng: string, nextLat: string) => {
            const lng = Number(nextLng);
            const lat = Number(nextLat);
            if (nextLng.trim() !== "" && nextLat.trim() !== "" && isValidLng(lng) && isValidLat(lat)) {
                onDraftPointChange({ lng, lat });
            }
        },
        [onDraftPointChange]
    );

    // Hidden (but mounted) while picking on the map so form state is preserved.
    if (!open || !context || picking) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            role="presentation"
            onClick={() => {
                if (!submitting) {
                    onCancel();
                }
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-slate-100 px-5 py-4">
                    <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                        {titleFor(context)}
                    </h2>
                    <div className="mt-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
                        <button
                            type="button"
                            disabled={submitting}
                            onClick={() => {
                                setSubmitError("");
                                setTab("existing");
                            }}
                            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                                tab === "existing"
                                    ? "bg-white text-slate-900 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                            }`}
                        >
                            Choose existing stop
                        </button>
                        <button
                            type="button"
                            disabled={submitting}
                            onClick={() => {
                                setSubmitError("");
                                setSelected(null);
                                setTab("create");
                            }}
                            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                                tab === "create"
                                    ? "bg-white text-slate-900 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                            }`}
                        >
                            Create new stop
                        </button>
                    </div>
                    {tab === "create" ? (
                        <p className="mt-2 text-xs text-slate-500">
                            Use an existing stop when one exists. Only create a new stop if none
                            is correct.
                        </p>
                    ) : null}
                </div>

                {/* ── EXISTING-STOP: confirm step ──────────────────────────── */}
                {tab === "existing" && selected ? (
                    <div className="flex flex-1 flex-col gap-4 px-5 py-5">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <p className="text-sm font-medium text-slate-900">
                                {selected.display_name}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                                {transportModeLabel(selected.mode)} · {selected.stop_type}
                            </p>
                        </div>
                        <p className="text-sm text-slate-700">
                            Insert this stop into this route variant?
                        </p>
                        {submitError ? (
                            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                {submitError}
                            </div>
                        ) : null}
                        <div className="mt-auto flex justify-end gap-2">
                            <button
                                type="button"
                                disabled={submitting}
                                onClick={() => {
                                    setSelected(null);
                                    setSubmitError("");
                                }}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                disabled={submitting || !variantPublicId}
                                onClick={() => void confirmInsertExisting()}
                                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                            >
                                {submitting ? "Inserting…" : "Insert stop"}
                            </button>
                        </div>
                    </div>
                ) : null}

                {/* ── EXISTING-STOP: search step ───────────────────────────── */}
                {tab === "existing" && !selected ? (
                    <div className="flex flex-1 flex-col overflow-hidden px-5 py-4">
                        <input
                            ref={searchInputRef}
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search stops by name or code…"
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                        />
                        {!hasQuery && near ? (
                            <p className="mt-2 text-xs text-slate-500">
                                Showing stops near this position. Type to search by name/code.
                            </p>
                        ) : null}

                        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                            {loading ? (
                                <div className="space-y-2">
                                    {[0, 1, 2, 3].map((i) => (
                                        <div
                                            key={i}
                                            className="h-12 animate-pulse rounded bg-gray-100"
                                        />
                                    ))}
                                </div>
                            ) : searchError ? (
                                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                    {searchError}
                                </div>
                            ) : !canSearch ? (
                                <p className="px-1 py-6 text-center text-sm text-gray-500">
                                    Type a stop name or code to search.
                                </p>
                            ) : results.length === 0 ? (
                                <p className="px-1 py-6 text-center text-sm text-gray-500">
                                    No matching stops found.
                                </p>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {results.map((r) => {
                                        const distance = formatDistance(r.distance_m);
                                        return (
                                            <li key={r.public_id}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setSubmitError("");
                                                        setSelected(r);
                                                    }}
                                                    className="flex w-full items-start justify-between gap-3 px-1 py-2.5 text-left hover:bg-gray-50"
                                                >
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-sm font-medium text-gray-900">
                                                            {r.display_name}
                                                        </span>
                                                        <span className="block truncate text-xs text-gray-500">
                                                            {transportModeLabel(r.mode)} ·{" "}
                                                            {r.stop_type}
                                                            {" · "}
                                                            {transportReviewStatusLabel(
                                                                r.review_status
                                                            )}
                                                            {r.confidence_score === null
                                                                ? ""
                                                                : ` · conf ${Math.round(r.confidence_score)}`}
                                                        </span>
                                                    </span>
                                                    {distance ? (
                                                        <span className="flex-none whitespace-nowrap text-xs font-medium text-slate-400">
                                                            {distance}
                                                        </span>
                                                    ) : null}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        <div className="mt-4 flex justify-end">
                            <button
                                type="button"
                                onClick={onCancel}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : null}

                {/* ── CREATE NEW STOP ──────────────────────────────────────── */}
                {tab === "create" ? (
                    <div className="flex flex-1 flex-col overflow-y-auto px-5 py-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                                Myanmar name
                                <input
                                    type="text"
                                    value={nameMm}
                                    onChange={(e) => setNameMm(e.target.value)}
                                    placeholder="မြန်မာ အမည်"
                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                                English name
                                <input
                                    type="text"
                                    value={nameEn}
                                    onChange={(e) => setNameEn(e.target.value)}
                                    placeholder="English name"
                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                                Mode
                                <select
                                    value={mode}
                                    onChange={(e) => setMode(e.target.value)}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                                >
                                    {TRANSPORT_MODE_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                                Stop type
                                <select
                                    value={stopType}
                                    onChange={(e) => setStopType(e.target.value)}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                                >
                                    {TRANSPORT_STOP_TYPE_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <div className="mt-4">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-slate-600">Location</span>
                                <button
                                    type="button"
                                    onClick={onStartPick}
                                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    Pick on map
                                </button>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-3">
                                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                                    Longitude
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step="any"
                                        value={lngText}
                                        onChange={(e) => {
                                            setLngText(e.target.value);
                                            applyLngLatText(e.target.value, latText);
                                        }}
                                        placeholder="96.123456"
                                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                                    Latitude
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step="any"
                                        value={latText}
                                        onChange={(e) => {
                                            setLatText(e.target.value);
                                            applyLngLatText(lngText, e.target.value);
                                        }}
                                        placeholder="16.123456"
                                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                                    />
                                </label>
                            </div>
                            <p className="mt-1.5 text-xs text-slate-400">
                                Click “Pick on map” then click the route map, or type coordinates.
                            </p>
                        </div>

                        {/* Nearby-duplicate warning. */}
                        {hasValidPoint && (dupLoading || nearbyDup.length > 0) ? (
                            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                                {dupLoading ? (
                                    "Checking for nearby existing stops…"
                                ) : (
                                    <>
                                        <p className="font-medium">
                                            Nearby existing stops found. Use an existing stop if
                                            possible to avoid duplicates.
                                        </p>
                                        <ul className="mt-2 space-y-1">
                                            {nearbyDup.map((r) => {
                                                const distance = formatDistance(r.distance_m);
                                                return (
                                                    <li key={r.public_id}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setSubmitError("");
                                                                setSelected(r);
                                                                setTab("existing");
                                                            }}
                                                            className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-amber-100"
                                                        >
                                                            <span className="min-w-0 flex-1 truncate">
                                                                {r.display_name}
                                                            </span>
                                                            {distance ? (
                                                                <span className="flex-none text-amber-700">
                                                                    {distance}
                                                                </span>
                                                            ) : null}
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </>
                                )}
                            </div>
                        ) : null}

                        {submitError ? (
                            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                {submitError}
                            </div>
                        ) : null}

                        <div className="mt-4 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                disabled={submitting}
                                onClick={onCancel}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={submitting || !canCreate || !variantPublicId}
                                onClick={() => void confirmCreate()}
                                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                            >
                                {submitting ? "Creating…" : "Create & insert stop"}
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
