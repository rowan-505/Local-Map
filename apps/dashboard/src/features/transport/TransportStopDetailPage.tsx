"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import TransportPreviewMap from "./TransportPreviewMap";
import { getTransportStopDetail, getTransportStopRoutes, updateTransportStop } from "./api";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
    TRANSPORT_STOP_TYPE_OPTIONS,
    transportModeLabel,
    transportReviewStatusLabel,
} from "./constants";
import type {
    TransportStopDetail,
    TransportStopRouteUsage,
    UpdateTransportStopBody,
} from "./types";

const MAP_DEFAULT_ZOOM = 15;
const ROUTES_PAGE_SIZE = 25;
const INPUT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL_CLASS = "text-[11px] font-medium uppercase tracking-wide text-gray-500";

type FormState = {
    stop_code: string;
    name: string;
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

function detailToForm(d: TransportStopDetail): FormState {
    return {
        stop_code: d.stop_code ?? "",
        name: d.name,
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

export default function TransportStopDetailPage({ publicId }: { readonly publicId: string }) {
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

    // --- Load stop detail when publicId changes. -----------------------------
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        setDetail(null);
        setEditing(false);
        setForm(null);
        setSaveError("");
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

        const name = form.name.trim();
        if (name === "") {
            setSaveError("Name is required.");
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

        // Build a diff-only payload.
        const body: UpdateTransportStopBody = {};
        const newCode = normNullable(form.stop_code);
        if (newCode !== detail.stop_code) body.stop_code = newCode;
        if (name !== detail.name) body.name = name;
        const newMm = normNullable(form.name_mm);
        if (newMm !== detail.name_mm) body.name_mm = newMm;
        const newEn = normNullable(form.name_en);
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
        } catch (err) {
            if (isAbortError(err)) return;
            setSaveError(err instanceof Error ? err.message : "Failed to save stop.");
        } finally {
            setSaving(false);
        }
    }, [detail, form, publicId]);

    const routesTotalPages = Math.max(1, Math.ceil(routesTotal / ROUTES_PAGE_SIZE));

    return (
        <main className="p-6">
            <div className="mx-auto max-w-[1600px] space-y-4">
                {/* Header */}
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4">
                    <div className="min-w-0">
                        <Link
                            href={transportPath("stops")}
                            className="text-sm text-gray-500 hover:text-gray-900"
                        >
                            ← Back to stops
                        </Link>
                        {loading ? (
                            <div className="mt-2 h-7 w-64 animate-pulse rounded bg-gray-200" />
                        ) : detail ? (
                            <div className="mt-1 flex flex-wrap items-center gap-3">
                                <h1 className="text-2xl font-bold text-gray-900">{detail.name}</h1>
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
                </header>

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
                                    <div>
                                        <label className={LABEL_CLASS}>Name (required)</label>
                                        <input
                                            className={INPUT_CLASS}
                                            value={form.name}
                                            onChange={(e) => setField("name", e.target.value)}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={LABEL_CLASS}>Name (MM)</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={form.name_mm}
                                                onChange={(e) => setField("name_mm", e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>Name (EN)</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={form.name_en}
                                                onChange={(e) => setField("name_en", e.target.value)}
                                            />
                                        </div>
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
                                    <InfoRow label="Primary" value={detail.name} />
                                    <InfoRow label="Myanmar" value={detail.name_mm ?? "—"} />
                                    <InfoRow label="English" value={detail.name_en ?? "—"} />
                                </div>
                            </section>
                        ) : null}

                        {/* Source / debug */}
                        {detail && !editing ? (
                            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                                    Sources & debug
                                </h2>
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
                            title={detail?.name ?? "Stop"}
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
            </div>
        </main>
    );
}
