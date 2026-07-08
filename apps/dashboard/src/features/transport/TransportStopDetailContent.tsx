"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import ArchiveStopDialog from "./ArchiveStopDialog";
import TransportPreviewMap from "./TransportPreviewMap";
import {
    applyTransportStopReviewAction,
    archiveTransportStop,
    getTransportStopDetail,
    getTransportStopNearby,
    getTransportStopRoutes,
    updateTransportStop,
    updateTransportStopLocation,
    updateTransportTerminal,
} from "./api";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
    TRANSPORT_STOP_TYPE_OPTIONS,
    transportModeLabel,
    transportReviewStatusLabel,
} from "./constants";
import {
    getRawNameDebugLabel,
    getTransportDisplayNameFromNames,
    getTransportTypeFallbackLabel,
    hasTransportManualName,
    normalizeTransportNameInput,
} from "./naming";
import type {
    TransportNearbyStop,
    TransportReviewAction,
    TransportStopDetail,
    TransportStopRouteUsage,
    UpdateTransportStopBody,
    UpdateTransportTerminalBody,
} from "./types";
import TransportStopMergePanel from "./TransportStopMergePanel";
import { CollapsibleSection, CompactField, COMPACT_FIELD_GRID_2_CLASS } from "./TransportRouteDetailCards";
import { STOP_CARD_CLASS, StopDetailHeader } from "./TransportStopDetailCards";
import { TransportReviewActionBar } from "./transportReviewUi";

const STOP_DETAIL_MAP_HEIGHT =
    "h-[min(48vh,420px)] min-h-[240px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100";
const MAP_DEFAULT_ZOOM = 15;
const ROUTES_PAGE_SIZE = 25;
const INPUT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL_CLASS = "text-[11px] font-medium uppercase tracking-wide text-gray-500";

type FormState = {
    stop_code: string;
    name_mm: string;
    name_en: string;
    mode: string;
    stop_type: string;
    admin_area_id: string;
    parent_stop_id: string;
    review_status: string;
    confidence_score: string;
    is_active: boolean;
    longitude: string;
    latitude: string;
};

type TerminalFormState = {
    terminal_code: string;
    terminal_role: string;
    operator_id: string;
    review_status: string;
    confidence_score: string;
    is_active: boolean;
};

function terminalToForm(t: NonNullable<TransportStopDetail["linked_terminal"]>): TerminalFormState {
    return {
        terminal_code: t.terminal_code ?? "",
        terminal_role: t.terminal_role,
        operator_id: t.operator_id === null ? "" : String(t.operator_id),
        review_status: t.review_status,
        confidence_score: t.confidence_score === null ? "" : String(Math.round(t.confidence_score)),
        is_active: t.is_active,
    };
}

function detailToForm(d: TransportStopDetail): FormState {
    return {
        stop_code: d.stop_code ?? "",
        name_mm: d.name_mm ?? "",
        name_en: d.name_en ?? "",
        mode: d.mode,
        stop_type: d.stop_type,
        admin_area_id: d.admin_area_id === null ? "" : String(d.admin_area_id),
        parent_stop_id: d.parent_stop_id === null ? "" : String(d.parent_stop_id),
        review_status: d.review_status,
        confidence_score: d.confidence_score === null ? "" : String(Math.round(d.confidence_score)),
        is_active: d.is_active,
        longitude: d.longitude === null ? "" : String(d.longitude),
        latitude: d.latitude === null ? "" : String(d.latitude),
    };
}

/** Straight-line distance in metres between two lng/lat points (haversine). */
function haversineMeters(
    a: { lng: number; lat: number },
    b: { lng: number; lat: number }
): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
        Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "lat, lng" to 6 dp, or a dash when missing. */
function formatCoords(point: { lng: number; lat: number } | null): string {
    if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) {
        return "—";
    }
    return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

/** Compact metres / km label for the moved-distance readout. */
function formatMovedDistance(meters: number): string {
    if (!Number.isFinite(meters)) return "—";
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    return `${Math.round(meters)} m`;
}

/** Empty string -> null; trimmed otherwise. */
function normNullable(value: string): string | null {
    const t = value.trim();
    return t === "" ? null : t;
}

function normIntNullable(value: string): number | null | undefined {
    const t = value.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
}

export type TransportStopDetailContentProps = {
    readonly publicId: string;
    /**
     * When provided, the header renders a back/close control that calls this
     * instead of linking to the stops list (used by the drawer host). When
     * omitted, a normal "← Back to stops" link is shown (full-page mode).
     */
    readonly onClose?: () => void;
    /** Called after any successful save so a host (e.g. list) can refresh. */
    readonly afterSave?: () => void;
    /**
     * Hide the built-in header (back control + title + edit buttons). Used when
     * a host (e.g. the drawer shell) already renders its own title/close chrome.
     * The Edit/Save/Cancel controls move into the body when hidden.
     */
    readonly hideHeader?: boolean;
};

/**
 * Stop detail content (info, MM/EN names, point map preview + point editing,
 * routes using this stop, linked-terminal card, sources/debug, save/cancel).
 * This is the page-shell-agnostic body so it can render inside the full detail
 * page or the Transport drawer.
 */
export default function TransportStopDetailContent({
    publicId,
    onClose,
    afterSave,
    hideHeader = false,
}: TransportStopDetailContentProps) {
    const [detail, setDetail] = useState<TransportStopDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [routes, setRoutes] = useState<readonly TransportStopRouteUsage[]>([]);
    const [routesTotal, setRoutesTotal] = useState(0);
    const [routesPage, setRoutesPage] = useState(1);
    const [routesLoading, setRoutesLoading] = useState(false);
    const [routesError, setRoutesError] = useState("");

    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState<FormState | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const [termEditing, setTermEditing] = useState(false);
    const [termForm, setTermForm] = useState<TerminalFormState | null>(null);
    const [termSaving, setTermSaving] = useState(false);
    const [termError, setTermError] = useState("");

    const router = useRouter();

    const handleStopReviewAction = useCallback(
        async (action: TransportReviewAction) => {
            if (!detail) return;
            const result = await applyTransportStopReviewAction(detail.public_id, action);
            setDetail({ ...detail, review_status: result.review_status });
            afterSave?.();
        },
        [detail, afterSave]
    );

    const handleStopMerged = useCallback(
        (targetPublicId: string) => {
            afterSave?.();
            if (onClose) {
                onClose();
                return;
            }
            router.push(transportPath(`stops/${targetPublicId}`));
        },
        [afterSave, onClose, router]
    );

    const [archiveOpen, setArchiveOpen] = useState(false);
    const [archiveReason, setArchiveReason] = useState("");
    const [archiving, setArchiving] = useState(false);
    const [archiveError, setArchiveError] = useState("");
    const [archived, setArchived] = useState(false);

    // --- Focused location-only edit (separate from the full Edit form). -------
    // Uses PATCH /transport/stops/:stopPublicId/location and surfaces moved
    // distance + nearby-duplicate warnings from the dedicated location API.
    const [locEditing, setLocEditing] = useState(false);
    const [locPoint, setLocPoint] = useState<{ lng: number; lat: number } | null>(null);
    const [locSaving, setLocSaving] = useState(false);
    const [locError, setLocError] = useState("");
    const [locNearby, setLocNearby] = useState<readonly TransportNearbyStop[]>([]);
    const [locNearbyLoading, setLocNearbyLoading] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);

    // --- Load stop detail when publicId changes. -----------------------------
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        setDetail(null);
        setEditing(false);
        setForm(null);
        setSaveError("");
        setTermEditing(false);
        setTermForm(null);
        setTermError("");
        setArchiveOpen(false);
        setArchiveReason("");
        setArchiving(false);
        setArchiveError("");
        setArchived(false);
        setLocEditing(false);
        setLocPoint(null);
        setLocError("");
        setLocNearby([]);
        setRoutes([]);
        setRoutesTotal(0);
        setRoutesPage(1);
        setAdvancedOpen(false);

        void (async () => {
            try {
                const result = await getTransportStopDetail(publicId, { signal: controller.signal });
                setDetail(result);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load stop.");
            } finally {
                setLoading(false);
            }
        })();
        return () => controller.abort();
    }, [publicId]);

    // --- Load route usage (paginated). ---------------------------------------
    useEffect(() => {
        if (!detail) return;
        const controller = new AbortController();
        setRoutesLoading(true);
        setRoutesError("");
        void (async () => {
            try {
                const result = await getTransportStopRoutes(
                    publicId,
                    { limit: ROUTES_PAGE_SIZE, offset: (routesPage - 1) * ROUTES_PAGE_SIZE },
                    { signal: controller.signal }
                );
                setRoutes(result.items);
                setRoutesTotal(result.total);
            } catch (err) {
                if (isAbortError(err)) return;
                setRoutesError(err instanceof Error ? err.message : "Failed to load routes.");
            } finally {
                setRoutesLoading(false);
            }
        })();
        return () => controller.abort();
    }, [publicId, detail, routesPage]);

    // --- The stop's saved point (used as the "old" coords baseline). ---------
    const originalPoint = useMemo<{ lng: number; lat: number } | null>(() => {
        if (detail && detail.longitude !== null && detail.latitude !== null) {
            return { lng: detail.longitude, lat: detail.latitude };
        }
        return null;
    }, [detail]);

    // --- The point currently shown on the map. Location edit takes priority,
    //     then the full edit form, then the saved detail point. ---------------
    const activePoint = useMemo<{ lng: number; lat: number } | null>(() => {
        if (locEditing) {
            return locPoint;
        }
        if (editing && form) {
            const lng = Number(form.longitude);
            const lat = Number(form.latitude);
            if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
            return null;
        }
        return originalPoint;
    }, [locEditing, locPoint, editing, form, originalPoint]);

    const mapEditing = editing || locEditing;

    // --- Map drag / click → update the active edit target's coordinates. -----
    const handlePointChange = useCallback(
        ({ lng, lat }: { lng: number; lat: number }) => {
            if (locEditing) {
                setLocPoint({ lng, lat });
                return;
            }
            setForm((prev) =>
                prev ? { ...prev, longitude: String(lng), latitude: String(lat) } : prev
            );
        },
        [locEditing]
    );

    const movedDistanceM = useMemo<number | null>(() => {
        if (!locEditing || !locPoint || !originalPoint) return null;
        return haversineMeters(originalPoint, locPoint);
    }, [locEditing, locPoint, originalPoint]);

    const startEdit = useCallback(() => {
        if (!detail) return;
        setForm(detailToForm(detail));
        setSaveError("");
        setEditing(true);
    }, [detail]);

    const cancelEdit = useCallback(() => {
        setEditing(false);
        setForm(null);
        setSaveError("");
    }, []);

    const startLocEdit = useCallback(() => {
        if (!detail) return;
        setLocPoint(originalPoint);
        setLocError("");
        setLocNearby([]);
        setLocEditing(true);
    }, [detail, originalPoint]);

    const cancelLocEdit = useCallback(() => {
        setLocEditing(false);
        setLocPoint(null);
        setLocError("");
        setLocNearby([]);
    }, []);

    const saveLocation = useCallback(async () => {
        if (!detail) return;
        if (!locPoint) {
            setLocError("Click the map (or drag the marker) to choose a location first.");
            return;
        }
        const { lng, lat } = locPoint;
        if (
            !Number.isFinite(lng) ||
            !Number.isFinite(lat) ||
            lng < -180 ||
            lng > 180 ||
            lat < -90 ||
            lat > 90
        ) {
            setLocError("Longitude/latitude must be valid coordinates.");
            return;
        }

        setLocSaving(true);
        setLocError("");
        try {
            const result = await updateTransportStopLocation(publicId, { lng, lat });
            setDetail(result.stop);
            setLocEditing(false);
            setLocPoint(null);
            setLocNearby([]);
            afterSave?.();
        } catch (err) {
            if (isAbortError(err)) return;
            setLocError(err instanceof Error ? err.message : "Failed to save location.");
        } finally {
            setLocSaving(false);
        }
    }, [detail, locPoint, publicId, afterSave]);

    // --- Live nearby-duplicate preview while editing the location. -----------
    // Debounced GET so dragging/clicking does not spam the API. Non-blocking:
    // a failure just clears the warning. The saved-location nearby check is the
    // authoritative one returned by the PATCH response.
    useEffect(() => {
        if (!locEditing || !locPoint) {
            setLocNearby([]);
            setLocNearbyLoading(false);
            return;
        }
        const controller = new AbortController();
        const point = locPoint;
        const timer = setTimeout(() => {
            setLocNearbyLoading(true);
            void (async () => {
                try {
                    const res = await getTransportStopNearby(
                        publicId,
                        { lng: point.lng, lat: point.lat, radius_m: 30 },
                        { signal: controller.signal }
                    );
                    setLocNearby(res);
                } catch (err) {
                    if (isAbortError(err)) return;
                    setLocNearby([]);
                } finally {
                    setLocNearbyLoading(false);
                }
            })();
        }, 400);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [locEditing, locPoint, publicId]);

    const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    }, []);

    const save = useCallback(async () => {
        if (!detail || !form) return;

        const newMm = normalizeTransportNameInput(form.name_mm);
        const newEn = normalizeTransportNameInput(form.name_en);
        if (!hasTransportManualName(newMm, newEn)) {
            setSaveError("Enter at least a Myanmar name or an English name.");
            return;
        }

        const adminAreaId = normIntNullable(form.admin_area_id);
        if (adminAreaId === undefined) {
            setSaveError("Admin area ID must be a positive integer or empty.");
            return;
        }
        const parentStopId = normIntNullable(form.parent_stop_id);
        if (parentStopId === undefined) {
            setSaveError("Parent stop ID must be a positive integer or empty.");
            return;
        }

        let confidence: number | undefined;
        if (form.confidence_score.trim() !== "") {
            const c = Number(form.confidence_score);
            if (!Number.isFinite(c) || c < 0 || c > 100) {
                setSaveError("Confidence must be between 0 and 100.");
                return;
            }
            confidence = c;
        }

        const lng = Number(form.longitude);
        const lat = Number(form.latitude);
        if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
            setSaveError("Longitude/latitude must be valid coordinates.");
            return;
        }

        // Build a diff-only payload. Names are edited via name_mm/name_en only;
        // the raw `name` cache is derived server-side and never sent.
        const body: UpdateTransportStopBody = {};
        const newCode = normNullable(form.stop_code);
        if (newCode !== detail.stop_code) body.stop_code = newCode;
        if (newMm !== detail.name_mm) body.name_mm = newMm;
        if (newEn !== detail.name_en) body.name_en = newEn;
        if (form.mode !== detail.mode) body.mode = form.mode;
        if (form.stop_type.trim() !== detail.stop_type) body.stop_type = form.stop_type.trim();
        if (adminAreaId !== detail.admin_area_id) body.admin_area_id = adminAreaId;
        if (parentStopId !== detail.parent_stop_id) body.parent_stop_id = parentStopId;
        if (form.review_status !== detail.review_status) body.review_status = form.review_status;
        if (confidence !== undefined && confidence !== detail.confidence_score) {
            body.confidence_score = confidence;
        }
        if (form.is_active !== detail.is_active) body.is_active = form.is_active;

        const movedPoint =
            detail.longitude === null ||
            detail.latitude === null ||
            Math.abs(lng - detail.longitude) > 1e-9 ||
            Math.abs(lat - detail.latitude) > 1e-9;
        if (movedPoint) body.point = { longitude: lng, latitude: lat };

        if (Object.keys(body).length === 0) {
            setEditing(false);
            setForm(null);
            return;
        }

        setSaving(true);
        setSaveError("");
        try {
            const updated = await updateTransportStop(publicId, body);
            setDetail(updated);
            setEditing(false);
            setForm(null);
            afterSave?.();
        } catch (err) {
            if (isAbortError(err)) return;
            setSaveError(err instanceof Error ? err.message : "Failed to save stop.");
        } finally {
            setSaving(false);
        }
    }, [detail, form, publicId, afterSave]);

    const stopDisplayName = useMemo(
        () =>
            detail
                ? getTransportDisplayNameFromNames(
                      detail.name_mm,
                      detail.name_en,
                      getTransportTypeFallbackLabel(detail.stop_type)
                  )
                : "Stop",
        [detail]
    );

    const startTermEdit = useCallback(() => {
        if (!detail?.linked_terminal) return;
        setTermForm(terminalToForm(detail.linked_terminal));
        setTermError("");
        setTermEditing(true);
    }, [detail]);

    const cancelTermEdit = useCallback(() => {
        setTermEditing(false);
        setTermForm(null);
        setTermError("");
    }, []);

    const setTermField = useCallback(
        <K extends keyof TerminalFormState>(key: K, value: TerminalFormState[K]) => {
            setTermForm((prev) => (prev ? { ...prev, [key]: value } : prev));
        },
        []
    );

    const saveTerminal = useCallback(async () => {
        const terminal = detail?.linked_terminal;
        if (!terminal || !termForm) return;

        const role = termForm.terminal_role.trim();
        if (role === "") {
            setTermError("Terminal role is required.");
            return;
        }

        const operatorId = normIntNullable(termForm.operator_id);
        if (operatorId === undefined) {
            setTermError("Operator ID must be a positive integer or empty.");
            return;
        }

        let confidence: number | undefined;
        if (termForm.confidence_score.trim() !== "") {
            const c = Number(termForm.confidence_score);
            if (!Number.isFinite(c) || c < 0 || c > 100) {
                setTermError("Confidence must be between 0 and 100.");
                return;
            }
            confidence = c;
        }

        // Terminal-specific fields only — never name/name_mm/name_en or geometry.
        const body: UpdateTransportTerminalBody = {};
        const newCode = normNullable(termForm.terminal_code);
        if (newCode !== terminal.terminal_code) body.terminal_code = newCode;
        if (role !== terminal.terminal_role) body.terminal_role = role;
        if (operatorId !== terminal.operator_id) body.operator_id = operatorId;
        if (termForm.review_status !== terminal.review_status) {
            body.review_status = termForm.review_status;
        }
        if (confidence !== undefined && confidence !== terminal.confidence_score) {
            body.confidence_score = confidence;
        }
        if (termForm.is_active !== terminal.is_active) body.is_active = termForm.is_active;

        if (Object.keys(body).length === 0) {
            setTermEditing(false);
            setTermForm(null);
            return;
        }

        setTermSaving(true);
        setTermError("");
        try {
            await updateTransportTerminal(terminal.public_id, body);
            // Re-fetch the stop so the linked-terminal summary reflects the change.
            const refreshed = await getTransportStopDetail(publicId);
            setDetail(refreshed);
            setTermEditing(false);
            setTermForm(null);
            afterSave?.();
        } catch (err) {
            if (isAbortError(err)) return;
            setTermError(err instanceof Error ? err.message : "Failed to save terminal.");
        } finally {
            setTermSaving(false);
        }
    }, [detail, termForm, publicId, afterSave]);

    const confirmArchive = useCallback(async () => {
        if (!detail) return;
        setArchiving(true);
        setArchiveError("");
        try {
            await archiveTransportStop(publicId, archiveReason);
            setArchiveOpen(false);
            setArchived(true);
            // Refresh any host list (drawer) so the archived stop drops out, then
            // redirect to the stops list as required.
            afterSave?.();
            router.push(transportPath("stops"));
        } catch (err) {
            if (isAbortError(err)) return;
            // Surfaces the backend 409 message ("…Remove it from all routes…") verbatim.
            setArchiveError(err instanceof Error ? err.message : "Failed to archive stop.");
        } finally {
            setArchiving(false);
        }
    }, [detail, publicId, archiveReason, afterSave, router]);

    const routesTotalPages = Math.max(1, Math.ceil(routesTotal / ROUTES_PAGE_SIZE));

    const archiveBlockedByRoutes = (detail?.route_count ?? 0) > 0;


    return (
        <>
            {!hideHeader && !onClose ? (
                <div className="mb-3">
                    <Link
                        href={transportPath("stops")}
                        className="text-sm text-gray-500 hover:text-gray-900"
                    >
                        ← Back to stops
                    </Link>
                </div>
            ) : null}

            <StopDetailHeader
                stopDisplayName={stopDisplayName}
                detail={detail}
                loading={loading}
                editing={editing}
                saving={saving}
                locEditing={locEditing}
                onEdit={startEdit}
                onCancelEdit={cancelEdit}
                onSaveEdit={() => void save()}
                onClose={onClose}
            />

            {error ? (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {error}
                </div>
            ) : null}
            {saveError ? (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {saveError}
                </div>
            ) : null}

            {editing && form && detail ? (
                <div className="mt-3 space-y-3">
                    <section className={STOP_CARD_CLASS}>
                        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                            Edit stop
                        </h2>
                            <div className="space-y-3">
                                <div className="space-y-2">
                                    <div>
                                        <label className={LABEL_CLASS}>Myanmar name</label>
                                        <input
                                            className={INPUT_CLASS}
                                            value={form.name_mm}
                                            onChange={(e) => setField("name_mm", e.target.value)}
                                            placeholder="မြန်မာအမည်"
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>English name</label>
                                        <input
                                            className={INPUT_CLASS}
                                            value={form.name_en}
                                            onChange={(e) => setField("name_en", e.target.value)}
                                            placeholder="English name"
                                        />
                                    </div>
                                    <p className="text-[11px] text-gray-500">
                                        Enter at least one. The display name uses the Myanmar
                                        name first, then English.
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className={LABEL_CLASS}>Stop code</label>
                                        <input
                                            className={INPUT_CLASS}
                                            value={form.stop_code}
                                            onChange={(e) => setField("stop_code", e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>Mode</label>
                                        <select
                                            className={INPUT_CLASS}
                                            value={form.mode}
                                            onChange={(e) => setField("mode", e.target.value)}
                                        >
                                            {TRANSPORT_MODE_OPTIONS.map((o) => (
                                                <option key={o.value} value={o.value}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className={LABEL_CLASS}>Stop type</label>
                                        <select
                                            className={INPUT_CLASS}
                                            value={form.stop_type}
                                            onChange={(e) => setField("stop_type", e.target.value)}
                                        >
                                            {TRANSPORT_STOP_TYPE_OPTIONS.some(
                                                (o) => o.value === form.stop_type
                                            ) ? null : (
                                                <option value={form.stop_type}>
                                                    {form.stop_type}
                                                </option>
                                            )}
                                            {TRANSPORT_STOP_TYPE_OPTIONS.map((o) => (
                                                <option key={o.value} value={o.value}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>Review status</label>
                                        <select
                                            className={INPUT_CLASS}
                                            value={form.review_status}
                                            onChange={(e) =>
                                                setField("review_status", e.target.value)
                                            }
                                        >
                                            {TRANSPORT_REVIEW_STATUS_OPTIONS.map((o) => (
                                                <option key={o.value} value={o.value}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className={LABEL_CLASS}>Admin area ID</label>
                                        <input
                                            type="number"
                                            min={1}
                                            className={INPUT_CLASS}
                                            value={form.admin_area_id}
                                            onChange={(e) =>
                                                setField("admin_area_id", e.target.value)
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>Parent stop ID</label>
                                        <input
                                            type="number"
                                            min={1}
                                            className={INPUT_CLASS}
                                            value={form.parent_stop_id}
                                            onChange={(e) =>
                                                setField("parent_stop_id", e.target.value)
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className={LABEL_CLASS}>Confidence (0–100)</label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            className={INPUT_CLASS}
                                            value={form.confidence_score}
                                            onChange={(e) =>
                                                setField("confidence_score", e.target.value)
                                            }
                                        />
                                    </div>
                                    <label className="mt-5 flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={form.is_active}
                                            onChange={(e) =>
                                                setField("is_active", e.target.checked)
                                            }
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        Active
                                    </label>
                                </div>
                                <div className="rounded-md border border-blue-100 bg-blue-50/60 p-2">
                                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-blue-900">
                                        Point — click map or drag marker
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={LABEL_CLASS}>Longitude</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={form.longitude}
                                                onChange={(e) =>
                                                    setField("longitude", e.target.value)
                                                }
                                            />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>Latitude</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={form.latitude}
                                                onChange={(e) =>
                                                    setField("latitude", e.target.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                    </section>
                    <section className={STOP_CARD_CLASS}>
                        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                            Location
                        </h2>
                        <TransportPreviewMap
                            title={stopDisplayName}
                            externalId={detail.public_id}
                            editablePoint={activePoint}
                            editablePointColor="#1d4ed8"
                            pointDraggable={mapEditing}
                            onPointChange={handlePointChange}
                            pointZoom={MAP_DEFAULT_ZOOM}
                            autoFitKey={publicId}
                            editingHint="Click the map or drag the marker to set this stop's location."
                            emptyHint="No geometry"
                            heightClassName={STOP_DETAIL_MAP_HEIGHT}
                        />
                    </section>
                </div>
            ) : (
                <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
                        <div className="space-y-3">
                            <section className={STOP_CARD_CLASS}>
                                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                                    Stop info
                                </h2>
                                {loading ? (
                                    <div className={`${COMPACT_FIELD_GRID_2_CLASS}`}>
                                        {[0, 1, 2, 3].map((i) => (
                                            <div
                                                key={i}
                                                className="h-10 animate-pulse rounded bg-gray-100"
                                            />
                                        ))}
                                    </div>
                                ) : detail ? (
                                    <dl className={COMPACT_FIELD_GRID_2_CLASS}>
                                        <CompactField
                                            label="Mode"
                                            value={transportModeLabel(detail.mode)}
                                        />
                                        <CompactField label="Stop type" value={detail.stop_type} />
                                        <CompactField
                                            label="Coordinates"
                                            value={
                                                <span className="tabular-nums">
                                                    {formatCoords(originalPoint)}
                                                </span>
                                            }
                                        />
                                        <CompactField label="Routes" value={detail.route_count} />
                                        <CompactField
                                            label="Review status"
                                            value={transportReviewStatusLabel(detail.review_status)}
                                        />
                                        <CompactField
                                            label="Confidence"
                                            value={
                                                detail.confidence_score === null
                                                    ? "—"
                                                    : Math.round(detail.confidence_score)
                                            }
                                        />
                                    </dl>
                                ) : null}
                            </section>

                            {detail ? (
                                <section className={STOP_CARD_CLASS}>
                                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                                        Names
                                    </h2>
                                    <dl className={COMPACT_FIELD_GRID_2_CLASS}>
                                        <CompactField label="Display name" value={stopDisplayName} />
                                        <CompactField label="Myanmar" value={detail.name_mm ?? "—"} />
                                        <CompactField label="English" value={detail.name_en ?? "—"} />
                                    </dl>
                                </section>
                            ) : null}

                            <section className={`${STOP_CARD_CLASS} p-0`}>
                                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                        Routes using this stop
                                    </h2>
                                    <span className="text-xs text-gray-400">{routesTotal}</span>
                                </div>

                                {routesError ? (
                                    <div className="m-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                                        {routesError}
                                    </div>
                                ) : null}

                                {routesLoading ? (
                                    <div className="space-y-2 p-3">
                                        {[0, 1, 2].map((i) => (
                                            <div
                                                key={i}
                                                className="h-9 animate-pulse rounded bg-gray-100"
                                            />
                                        ))}
                                    </div>
                                ) : routes.length === 0 ? (
                                    <p className="px-3 py-4 text-center text-sm text-gray-500">
                                        No routes currently use this stop.
                                    </p>
                                ) : (
                                    <ul className="max-h-64 overflow-y-auto lg:max-h-72">
                                        {routes.map((r) => (
                                            <li
                                                key={`${r.variant_public_id}-${r.stop_sequence}`}
                                                className="border-b border-gray-100 last:border-b-0"
                                            >
                                                <Link
                                                    href={`${transportPath("routes")}?route=${r.route_public_id}`}
                                                    className="flex items-start gap-2 px-3 py-2 text-sm hover:bg-gray-50"
                                                >
                                                    <span className="mt-0.5 inline-flex h-5 flex-none items-center justify-center rounded bg-gray-900 px-1.5 text-[10px] font-semibold text-white">
                                                        {r.route_code}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate font-medium text-gray-900">
                                                            {r.route_name}
                                                        </p>
                                                        <p className="truncate text-xs text-gray-500">
                                                            {r.variant_code}
                                                            {r.direction_name
                                                                ? ` · ${r.direction_name}`
                                                                : ""}
                                                            {r.headsign ? ` · ${r.headsign}` : ""} ·
                                                            seq {r.stop_sequence}
                                                        </p>
                                                    </div>
                                                </Link>
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                {routesTotal > ROUTES_PAGE_SIZE ? (
                                    <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-sm text-gray-600">
                                        <button
                                            type="button"
                                            disabled={routesLoading || routesPage <= 1}
                                            onClick={() => setRoutesPage((p) => Math.max(1, p - 1))}
                                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            Previous
                                        </button>
                                        <span className="text-xs tabular-nums">
                                            Page {routesPage} of {routesTotalPages}
                                        </span>
                                        <button
                                            type="button"
                                            disabled={routesLoading || routesPage >= routesTotalPages}
                                            onClick={() => setRoutesPage((p) => p + 1)}
                                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            Next
                                        </button>
                                    </div>
                                ) : null}
                            </section>
                        </div>

                        <section className={STOP_CARD_CLASS}>
                            {detail ? (
                                <>
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                            Location
                                        </h2>
                                        {!locEditing ? (
                                            <button
                                                type="button"
                                                onClick={startLocEdit}
                                                disabled={editing}
                                                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                Edit location
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={cancelLocEdit}
                                                    disabled={locSaving}
                                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void saveLocation()}
                                                    disabled={locSaving || !locPoint}
                                                    className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                                                >
                                                    {locSaving ? "Saving…" : "Save location"}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {locEditing ? (
                                        <div className="mb-2 space-y-2">
                                            {locError ? (
                                                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                                                    {locError}
                                                </div>
                                            ) : null}
                                            <p className="text-[11px] text-gray-500">
                                                Click the map or drag the marker to set this
                                                stop&apos;s location.
                                            </p>
                                            <div className="grid grid-cols-2 gap-2 text-sm">
                                                <div>
                                                    <span className={LABEL_CLASS}>Old location</span>
                                                    <p className="font-medium text-gray-700 tabular-nums">
                                                        {formatCoords(originalPoint)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <span className={LABEL_CLASS}>New location</span>
                                                    <p className="font-medium text-gray-900 tabular-nums">
                                                        {locPoint
                                                            ? formatCoords(locPoint)
                                                            : "Click the map…"}
                                                    </p>
                                                </div>
                                            </div>
                                            <p className="text-sm text-gray-700">
                                                Moved:{" "}
                                                <span className="font-medium tabular-nums">
                                                    {movedDistanceM === null
                                                        ? "—"
                                                        : formatMovedDistance(movedDistanceM)}
                                                </span>
                                            </p>
                                            {locNearby.length > 0 ? (
                                                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                                                    <p className="font-medium">
                                                        ⚠ {locNearby.length} stop
                                                        {locNearby.length === 1 ? "" : "s"} within 30
                                                        m of this location:
                                                    </p>
                                                    <ul className="mt-1 space-y-0.5">
                                                        {locNearby.slice(0, 5).map((n) => (
                                                            <li
                                                                key={n.stop_public_id}
                                                                className="truncate"
                                                            >
                                                                {n.name} · {Math.round(n.distance_m)}{" "}
                                                                m · {transportModeLabel(n.mode)}
                                                            </li>
                                                        ))}
                                                        {locNearby.length > 5 ? (
                                                            <li className="text-amber-700">
                                                                +{locNearby.length - 5} more…
                                                            </li>
                                                        ) : null}
                                                    </ul>
                                                </div>
                                            ) : locNearbyLoading ? (
                                                <p className="text-xs text-gray-400">
                                                    Checking nearby stops…
                                                </p>
                                            ) : locPoint ? (
                                                <p className="text-xs text-emerald-700">
                                                    No other stops within 30 m.
                                                </p>
                                            ) : null}
                                        </div>
                                    ) : null}

                                    <TransportPreviewMap
                                        title={stopDisplayName}
                                        externalId={detail.public_id}
                                        editablePoint={activePoint}
                                        editablePointColor="#1d4ed8"
                                        pointDraggable={mapEditing}
                                        onPointChange={handlePointChange}
                                        pointZoom={MAP_DEFAULT_ZOOM}
                                        autoFitKey={publicId}
                                        editingHint={
                                            mapEditing
                                                ? "Click the map or drag the marker to set this stop's location."
                                                : null
                                        }
                                        emptyHint="No geometry"
                                        heightClassName={STOP_DETAIL_MAP_HEIGHT}
                                    />
                                </>
                            ) : null}
                        </section>
                    </div>

                    <CollapsibleSection
                        title="Advanced / Diagnostics"
                        description="Merge duplicates, sources, review workflow, linked terminal, and archive."
                        open={advancedOpen}
                        onToggle={() => setAdvancedOpen((open) => !open)}
                    >
                        {detail && !archived ? (
                            <section className="mb-4">
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Review workflow
                                </h3>
                                <TransportReviewActionBar
                                    currentStatus={detail.review_status}
                                    onAction={handleStopReviewAction}
                                />
                            </section>
                        ) : null}

                        {detail && !archived ? (
                            <div className="mb-4">
                                <TransportStopMergePanel stop={detail} onMerged={handleStopMerged} />
                            </div>
                        ) : null}

                        {detail?.linked_terminal ? (
                        <section className="mb-3 rounded-lg border border-indigo-200 bg-white p-3 shadow-sm">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-700">
                                    Terminal info
                                </h2>
                                {!termEditing ? (
                                    <button
                                        type="button"
                                        onClick={startTermEdit}
                                        disabled={editing}
                                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        Edit
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={cancelTermEdit}
                                            disabled={termSaving}
                                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void saveTerminal()}
                                            disabled={termSaving}
                                            className="rounded-md bg-indigo-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
                                        >
                                            {termSaving ? "Saving…" : "Save"}
                                        </button>
                                    </div>
                                )}
                            </div>

                            <p className="mb-2 text-[11px] text-gray-500">
                                Name &amp; location are managed on this stop. These fields update
                                the linked terminal only.
                            </p>

                            {termError ? (
                                <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                                    {termError}
                                </div>
                            ) : null}

                            {termEditing && termForm ? (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={LABEL_CLASS}>Terminal role</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={termForm.terminal_role}
                                                onChange={(e) =>
                                                    setTermField("terminal_role", e.target.value)
                                                }
                                            />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>Terminal code</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={termForm.terminal_code}
                                                onChange={(e) =>
                                                    setTermField("terminal_code", e.target.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={LABEL_CLASS}>Operator ID</label>
                                            <input
                                                type="number"
                                                min={1}
                                                className={INPUT_CLASS}
                                                value={termForm.operator_id}
                                                onChange={(e) =>
                                                    setTermField("operator_id", e.target.value)
                                                }
                                            />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>Review status</label>
                                            <select
                                                className={INPUT_CLASS}
                                                value={termForm.review_status}
                                                onChange={(e) =>
                                                    setTermField("review_status", e.target.value)
                                                }
                                            >
                                                {TRANSPORT_REVIEW_STATUS_OPTIONS.map((o) => (
                                                    <option key={o.value} value={o.value}>
                                                        {o.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={LABEL_CLASS}>
                                                Confidence (0–100)
                                            </label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={100}
                                                className={INPUT_CLASS}
                                                value={termForm.confidence_score}
                                                onChange={(e) =>
                                                    setTermField(
                                                        "confidence_score",
                                                        e.target.value
                                                    )
                                                }
                                            />
                                        </div>
                                        <label className="mt-5 flex items-center gap-2 text-sm text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={termForm.is_active}
                                                onChange={(e) =>
                                                    setTermField("is_active", e.target.checked)
                                                }
                                                className="h-4 w-4 rounded border-gray-300"
                                            />
                                            Active
                                        </label>
                                    </div>
                                </div>
                            ) : (
                                <dl className={COMPACT_FIELD_GRID_2_CLASS}>
                                    <CompactField
                                        label="Terminal role"
                                        value={detail.linked_terminal.terminal_role}
                                    />
                                    <CompactField
                                        label="Terminal code"
                                        value={detail.linked_terminal.terminal_code ?? "—"}
                                    />
                                    <CompactField
                                        label="Operator"
                                        value={
                                            detail.linked_terminal.operator?.name ??
                                            (detail.linked_terminal.operator_id === null
                                                ? "—"
                                                : `#${detail.linked_terminal.operator_id}`)
                                        }
                                    />
                                    <CompactField
                                        label="Review status"
                                        value={transportReviewStatusLabel(
                                            detail.linked_terminal.review_status
                                        )}
                                    />
                                    <CompactField
                                        label="Confidence"
                                        value={
                                            detail.linked_terminal.confidence_score === null
                                                ? "—"
                                                : Math.round(
                                                      detail.linked_terminal.confidence_score
                                                  )
                                        }
                                    />
                                    <CompactField
                                        label="Active"
                                        value={
                                            detail.linked_terminal.is_active ? "Active" : "Inactive"
                                        }
                                    />
                                </dl>
                            )}
                        </section>
                        ) : null}

                        {detail ? (
                        <section className="mb-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                                Sources & debug
                            </h2>
                            <dl className={`${COMPACT_FIELD_GRID_2_CLASS} mb-2 border-b border-gray-100 pb-2`}>
                                <CompactField
                                    label="Raw name"
                                    value={getRawNameDebugLabel(detail.name)}
                                />
                            </dl>
                            {detail.sources.length > 0 ? (
                                <ul className="mb-2 space-y-1 text-sm text-gray-700">
                                    {detail.sources.map((s, i) => (
                                        <li key={`${s.source_name}-${i}`} className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium">{s.source_name}</span>
                                            <span className="text-xs text-gray-400">
                                                {s.source_kind}
                                                {s.external_id ? ` · ${s.external_id}` : ""}
                                                {s.is_primary ? " · primary" : ""}
                                            </span>
                                            {s.source_url ? (
                                                <a
                                                    href={s.source_url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-xs text-blue-700 hover:underline"
                                                >
                                                    link
                                                </a>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="mb-2 text-sm text-gray-500">No source links.</p>
                            )}
                            <details className="text-xs">
                                <summary className="cursor-pointer text-gray-600">
                                    source_refs
                                </summary>
                                <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">
                                    {JSON.stringify(detail.source_refs, null, 2)}
                                </pre>
                            </details>
                            <details className="mt-1 text-xs">
                                <summary className="cursor-pointer text-gray-600">
                                    normalized_data
                                </summary>
                                <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">
                                    {JSON.stringify(detail.normalized_data, null, 2)}
                                </pre>
                            </details>
                        </section>
                        ) : null}

                        {detail ? (
                <section className="rounded-lg border border-red-200 bg-red-50/40 p-3 shadow-sm">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700">
                        Danger zone
                    </h2>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">Archive stop</p>
                            <p className="mt-0.5 text-sm text-gray-600">
                                {archiveBlockedByRoutes
                                    ? "This stop is used by routes. Remove it from all routes before archiving."
                                    : "Soft-deletes this stop. It will no longer appear as an active stop. Route history and source records are preserved."}
                            </p>
                        </div>
                        <button
                            type="button"
                            disabled={
                                archiveBlockedByRoutes ||
                                editing ||
                                locEditing ||
                                archiving ||
                                archived
                            }
                            onClick={() => {
                                setArchiveError("");
                                setArchiveReason("");
                                setArchiveOpen(true);
                            }}
                            className="flex-none rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Archive stop
                        </button>
                    </div>

                    {archived ? (
                        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
                            Stop archived. Redirecting to the stops list…
                        </div>
                    ) : null}
                    {archiveError && !archiveOpen ? (
                        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                            {archiveError}
                        </div>
                    ) : null}
                </section>
                        ) : null}
                    </CollapsibleSection>
                </div>
            )}

            <ArchiveStopDialog
                open={archiveOpen}
                stopName={stopDisplayName}
                reason={archiveReason}
                isBusy={archiving}
                error={archiveError}
                onReasonChange={setArchiveReason}
                onConfirm={() => void confirmArchive()}
                onCancel={() => {
                    if (!archiving) {
                        setArchiveOpen(false);
                    }
                }}
            />
        </>
    );
}
