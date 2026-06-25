"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import ArchiveStopDialog from "./ArchiveStopDialog";
import TransportPreviewMap from "./TransportPreviewMap";
import {
    archiveTransportStop,
    getTransportStopDetail,
    getTransportStopRoutes,
    updateTransportStop,
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
    TransportStopDetail,
    TransportStopRouteUsage,
    UpdateTransportStopBody,
    UpdateTransportTerminalBody,
} from "./types";

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

function InfoRow({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
    return (
        <div className="flex justify-between gap-3 py-1 text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="min-w-0 wrap-break-word text-right font-medium text-gray-900">{value}</span>
        </div>
    );
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
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [archiveReason, setArchiveReason] = useState("");
    const [archiving, setArchiving] = useState(false);
    const [archiveError, setArchiveError] = useState("");
    const [archived, setArchived] = useState(false);

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
        setRoutes([]);
        setRoutesTotal(0);
        setRoutesPage(1);

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

    // --- The point currently shown on the map (edit form value or detail). ---
    const activePoint = useMemo<{ lng: number; lat: number } | null>(() => {
        if (editing && form) {
            const lng = Number(form.longitude);
            const lat = Number(form.latitude);
            if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
            return null;
        }
        if (detail && detail.longitude !== null && detail.latitude !== null) {
            return { lng: detail.longitude, lat: detail.latitude };
        }
        return null;
    }, [editing, form, detail]);

    // --- Map drag / click → update the edit form's coordinates. --------------
    const handlePointChange = useCallback(
        ({ lng, lat }: { lng: number; lat: number }) => {
            setForm((prev) =>
                prev ? { ...prev, longitude: String(lng), latitude: String(lat) } : prev
            );
        },
        []
    );

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

    // Edit / Save / Cancel controls — shown in the header (full page) or inline
    // at the top of the body (drawer, where the header is hidden).
    const editControls = (
        <div className="flex items-center gap-2">
            {detail && !editing ? (
                <button
                    type="button"
                    onClick={startEdit}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
                >
                    Edit
                </button>
            ) : null}
            {editing ? (
                <>
                    <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={saving}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={saving}
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                        {saving ? "Saving…" : "Save changes"}
                    </button>
                </>
            ) : null}
        </div>
    );

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
                                ← Back to stops
                            </button>
                        ) : (
                            <Link
                                href={transportPath("stops")}
                                className="text-sm text-gray-500 hover:text-gray-900"
                            >
                                ← Back to stops
                            </Link>
                        )}
                        {loading ? (
                            <div className="mt-2 h-7 w-64 animate-pulse rounded bg-gray-200" />
                        ) : detail ? (
                            <div className="mt-1 flex flex-wrap items-center gap-3">
                                <h1 className="text-2xl font-bold text-gray-900">
                                    {stopDisplayName}
                                </h1>
                                <span
                                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${reviewStatusBadgeClass(detail.review_status)}`}
                                >
                                    {transportReviewStatusLabel(detail.review_status)}
                                </span>
                                <span className="text-sm text-gray-500">
                                    {transportModeLabel(detail.mode)} · {detail.stop_type}
                                    {detail.stop_code ? ` · #${detail.stop_code}` : ""}
                                </span>
                                {detail.is_active ? (
                                    <span className="text-sm text-emerald-700">Active</span>
                                ) : (
                                    <span className="text-sm text-gray-400">Inactive</span>
                                )}
                            </div>
                        ) : null}
                    </div>
                    {editControls}
                </header>
            ) : null}

            {/* Inline edit controls when the header is hidden (drawer mode). */}
            {hideHeader && detail ? (
                <div className="flex justify-end">{editControls}</div>
            ) : null}

            {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {error}
                </div>
            ) : null}
            {saveError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {saveError}
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)_360px]">
                {/* Left: info / edit form */}
                <aside className="space-y-4">
                    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                            Stop info
                        </h2>
                        {loading ? (
                            <div className="space-y-2">
                                {[0, 1, 2, 3, 4].map((i) => (
                                    <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />
                                ))}
                            </div>
                        ) : detail && editing && form ? (
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
                        ) : detail ? (
                            <div className="divide-y divide-gray-100">
                                <InfoRow label="Mode" value={transportModeLabel(detail.mode)} />
                                <InfoRow label="Stop type" value={detail.stop_type} />
                                <InfoRow label="Stop code" value={detail.stop_code ?? "—"} />
                                <InfoRow
                                    label="Confidence"
                                    value={
                                        detail.confidence_score === null
                                            ? "—"
                                            : Math.round(detail.confidence_score)
                                    }
                                />
                                <InfoRow label="Routes" value={detail.route_count} />
                                <InfoRow
                                    label="Admin area"
                                    value={
                                        detail.admin_area_name ??
                                        (detail.admin_area_id === null
                                            ? "—"
                                            : `#${detail.admin_area_id}`)
                                    }
                                />
                                <InfoRow
                                    label="Parent stop"
                                    value={
                                        detail.parent_stop ? (
                                            <Link
                                                href={transportPath(
                                                    `stops/${detail.parent_stop.public_id}`
                                                )}
                                                className="text-blue-700 hover:underline"
                                            >
                                                {detail.parent_stop.name}
                                            </Link>
                                        ) : (
                                            "—"
                                        )
                                    }
                                />
                                <InfoRow
                                    label="Coordinates"
                                    value={
                                        detail.longitude === null || detail.latitude === null
                                            ? "—"
                                            : `${detail.latitude.toFixed(6)}, ${detail.longitude.toFixed(6)}`
                                    }
                                />
                                <InfoRow
                                    label="Updated"
                                    value={new Date(detail.updated_at).toLocaleString()}
                                />
                            </div>
                        ) : null}
                    </section>

                    {/* Names */}
                    {detail && !editing ? (
                        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                                Names
                            </h2>
                            <div className="divide-y divide-gray-100">
                                <InfoRow label="Display name" value={stopDisplayName} />
                                <InfoRow label="Myanmar" value={detail.name_mm ?? "—"} />
                                <InfoRow label="English" value={detail.name_en ?? "—"} />
                            </div>
                        </section>
                    ) : null}

                    {/* Linked terminal */}
                    {detail?.linked_terminal ? (
                        <section className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm">
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
                                <div className="divide-y divide-gray-100">
                                    <InfoRow
                                        label="Terminal role"
                                        value={detail.linked_terminal.terminal_role}
                                    />
                                    <InfoRow
                                        label="Terminal code"
                                        value={detail.linked_terminal.terminal_code ?? "—"}
                                    />
                                    <InfoRow
                                        label="Operator"
                                        value={
                                            detail.linked_terminal.operator?.name ??
                                            (detail.linked_terminal.operator_id === null
                                                ? "—"
                                                : `#${detail.linked_terminal.operator_id}`)
                                        }
                                    />
                                    <InfoRow
                                        label="Review status"
                                        value={transportReviewStatusLabel(
                                            detail.linked_terminal.review_status
                                        )}
                                    />
                                    <InfoRow
                                        label="Confidence"
                                        value={
                                            detail.linked_terminal.confidence_score === null
                                                ? "—"
                                                : Math.round(
                                                      detail.linked_terminal.confidence_score
                                                  )
                                        }
                                    />
                                    <InfoRow
                                        label="Active"
                                        value={
                                            detail.linked_terminal.is_active ? "Active" : "Inactive"
                                        }
                                    />
                                </div>
                            )}
                        </section>
                    ) : null}

                    {/* Source / debug */}
                    {detail && !editing ? (
                        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                                Sources & debug
                            </h2>
                            <div className="mb-2 divide-y divide-gray-100 border-b border-gray-100">
                                <InfoRow
                                    label="Raw name"
                                    value={getRawNameDebugLabel(detail.name)}
                                />
                            </div>
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
                </aside>

                {/* Center: map */}
                <section className="flex flex-col">
                    <TransportPreviewMap
                        title={detail ? stopDisplayName : "Stop"}
                        externalId={detail?.public_id ?? null}
                        editablePoint={activePoint}
                        editablePointColor="#1d4ed8"
                        pointDraggable={editing}
                        onPointChange={handlePointChange}
                        pointZoom={MAP_DEFAULT_ZOOM}
                        autoFitKey={publicId}
                        editingHint={
                            editing
                                ? "Click the map or drag the marker to set this stop's location."
                                : null
                        }
                        emptyHint="No geometry available"
                    />
                </section>

                {/* Right: routes using this stop */}
                <aside className="rounded-lg border border-gray-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                            Routes using this stop
                        </h2>
                        <span className="text-xs text-gray-400">{routesTotal}</span>
                    </div>

                    {routesError ? (
                        <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {routesError}
                        </div>
                    ) : null}

                    {routesLoading ? (
                        <div className="space-y-2 p-4">
                            {[0, 1, 2, 3].map((i) => (
                                <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
                            ))}
                        </div>
                    ) : routes.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-gray-500">
                            No routes include this stop.
                        </p>
                    ) : (
                        <ul className="max-h-[60vh] overflow-y-auto">
                            {routes.map((r) => (
                                <li
                                    key={`${r.variant_public_id}-${r.stop_sequence}`}
                                    className="border-b border-gray-100"
                                >
                                    <Link
                                        href={transportPath(`routes/${r.route_public_id}`)}
                                        className="flex items-start gap-3 px-4 py-2.5 text-sm hover:bg-gray-50"
                                    >
                                        <span className="mt-0.5 inline-flex h-6 flex-none items-center justify-center rounded bg-gray-900 px-1.5 text-xs font-semibold text-white">
                                            {r.route_code}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-medium text-gray-900">
                                                {r.route_name}
                                            </p>
                                            <p className="truncate text-xs text-gray-500">
                                                {r.variant_code}
                                                {r.direction_name ? ` · ${r.direction_name}` : ""}
                                                {r.headsign ? ` · ${r.headsign}` : ""} · seq{" "}
                                                {r.stop_sequence}
                                            </p>
                                        </div>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}

                    {routesTotal > ROUTES_PAGE_SIZE ? (
                        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
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
                </aside>
            </div>

            {/* Danger zone — archive (soft-delete) the actual stop record. */}
            {detail ? (
                <section className="rounded-lg border border-red-200 bg-red-50/40 p-4 shadow-sm">
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
                            disabled={archiveBlockedByRoutes || editing || archiving || archived}
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
