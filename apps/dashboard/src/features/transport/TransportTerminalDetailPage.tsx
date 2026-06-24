"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import TransportPreviewMap from "./TransportPreviewMap";
import {
    getTransportStopDetail,
    getTransportTerminalDetail,
    updateTransportTerminal,
} from "./api";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
    transportModeLabel,
    transportReviewStatusLabel,
    transportTerminalDisplayName,
} from "./constants";
import type {
    TransportRawNameStatus,
    TransportTerminalDetail,
    UpdateTransportTerminalBody,
} from "./types";

const MAP_DEFAULT_ZOOM = 15;
const INPUT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL_CLASS = "text-[11px] font-medium uppercase tracking-wide text-gray-500";

type FormState = {
    terminal_code: string;
    name: string;
    name_mm: string;
    name_en: string;
    mode: string;
    terminal_role: string;
    linked_stop_id: string;
    operator_id: string;
    admin_area_id: string;
    review_status: string;
    confidence_score: string;
    is_active: boolean;
    longitude: string;
    latitude: string;
};

function detailToForm(d: TransportTerminalDetail): FormState {
    return {
        terminal_code: d.terminal_code ?? "",
        name: d.name,
        name_mm: d.name_mm ?? "",
        name_en: d.name_en ?? "",
        mode: d.mode,
        terminal_role: d.terminal_role,
        linked_stop_id: d.linked_stop_id === null ? "" : String(d.linked_stop_id),
        operator_id: d.operator_id === null ? "" : String(d.operator_id),
        admin_area_id: d.admin_area_id === null ? "" : String(d.admin_area_id),
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

function rawNameBadgeClass(status: TransportRawNameStatus): string {
    switch (status) {
        case "real":
            return "bg-emerald-50 text-emerald-800 ring-emerald-100";
        case "generated":
            return "bg-amber-50 text-amber-900 ring-amber-100";
        default:
            return "bg-gray-100 text-gray-600 ring-gray-200";
    }
}

function InfoRow({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
    return (
        <div className="flex justify-between gap-3 py-1 text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="min-w-0 wrap-break-word text-right font-medium text-gray-900">
                {value}
            </span>
        </div>
    );
}

/** Empty string -> null; trimmed otherwise. */
function normNullable(value: string): string | null {
    const t = value.trim();
    return t === "" ? null : t;
}

/** Empty -> null; non-numeric -> undefined (invalid sentinel). */
function normIntNullable(value: string): number | null | undefined {
    const t = value.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
}

export default function TransportTerminalDetailPage({
    publicId,
}: {
    readonly publicId: string;
}) {
    const [detail, setDetail] = useState<TransportTerminalDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState<FormState | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    /** Coordinates of the linked stop (terminal detail carries no stop geometry). */
    const [linkedStopPoint, setLinkedStopPoint] = useState<{ lng: number; lat: number } | null>(
        null
    );

    // --- Load terminal detail when publicId changes. -------------------------
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        setDetail(null);
        setEditing(false);
        setForm(null);
        setSaveError("");

        void (async () => {
            try {
                const result = await getTransportTerminalDetail(publicId, {
                    signal: controller.signal,
                });
                setDetail(result);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load terminal.");
            } finally {
                setLoading(false);
            }
        })();
        return () => controller.abort();
    }, [publicId]);

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

    // --- Resolve linked stop coordinates (separate stop lookup). -------------
    const linkedStopPublicId = detail?.linked_stop?.public_id ?? null;
    useEffect(() => {
        if (!linkedStopPublicId) {
            setLinkedStopPoint(null);
            return;
        }
        const controller = new AbortController();
        setLinkedStopPoint(null);
        void (async () => {
            try {
                const stop = await getTransportStopDetail(linkedStopPublicId, {
                    signal: controller.signal,
                });
                if (stop.longitude !== null && stop.latitude !== null) {
                    setLinkedStopPoint({ lng: stop.longitude, lat: stop.latitude });
                } else {
                    setLinkedStopPoint(null);
                }
            } catch (err) {
                if (isAbortError(err)) return;
                setLinkedStopPoint(null);
            }
        })();
        return () => controller.abort();
    }, [linkedStopPublicId]);

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
        const terminalRole = form.terminal_role.trim();
        if (terminalRole === "") {
            setSaveError("Terminal role is required.");
            return;
        }

        const linkedStopId = normIntNullable(form.linked_stop_id);
        if (linkedStopId === undefined) {
            setSaveError("Linked stop ID must be a positive integer or empty.");
            return;
        }
        const operatorId = normIntNullable(form.operator_id);
        if (operatorId === undefined) {
            setSaveError("Operator ID must be a positive integer or empty.");
            return;
        }
        const adminAreaId = normIntNullable(form.admin_area_id);
        if (adminAreaId === undefined) {
            setSaveError("Admin area ID must be a positive integer or empty.");
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
        if (
            !Number.isFinite(lng) ||
            !Number.isFinite(lat) ||
            lng < -180 ||
            lng > 180 ||
            lat < -90 ||
            lat > 90
        ) {
            setSaveError("Longitude/latitude must be valid coordinates.");
            return;
        }

        // Build a diff-only payload.
        const body: UpdateTransportTerminalBody = {};
        const newCode = normNullable(form.terminal_code);
        if (newCode !== detail.terminal_code) body.terminal_code = newCode;
        if (name !== detail.name) body.name = name;
        const newMm = normNullable(form.name_mm);
        if (newMm !== detail.name_mm) body.name_mm = newMm;
        const newEn = normNullable(form.name_en);
        if (newEn !== detail.name_en) body.name_en = newEn;
        if (form.mode !== detail.mode) body.mode = form.mode;
        if (terminalRole !== detail.terminal_role) body.terminal_role = terminalRole;
        if (linkedStopId !== detail.linked_stop_id) body.linked_stop_id = linkedStopId;
        if (operatorId !== detail.operator_id) body.operator_id = operatorId;
        if (adminAreaId !== detail.admin_area_id) body.admin_area_id = adminAreaId;
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
            const updated = await updateTransportTerminal(publicId, body);
            setDetail(updated);
            setEditing(false);
            setForm(null);
        } catch (err) {
            if (isAbortError(err)) return;
            setSaveError(err instanceof Error ? err.message : "Failed to save terminal.");
        } finally {
            setSaving(false);
        }
    }, [detail, form, publicId]);

    const isFerry = detail?.mode === "ferry";
    const isUnverified =
        detail !== null &&
        (detail.raw_name_status !== "real" ||
            detail.review_status === "imported_unreviewed" ||
            detail.review_status === "needs_review");
    const displayTitle = detail ? transportTerminalDisplayName(detail) : "";

    return (
        <main className="p-6">
            <div className="mx-auto max-w-[1400px] space-y-4">
                {/* Header */}
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4">
                    <div className="min-w-0">
                        <Link
                            href={transportPath("terminals")}
                            className="text-sm text-gray-500 hover:text-gray-900"
                        >
                            ← Back to terminals
                        </Link>
                        {loading ? (
                            <div className="mt-2 h-7 w-64 animate-pulse rounded bg-gray-200" />
                        ) : detail ? (
                            <div className="mt-1 flex flex-wrap items-center gap-3">
                                <h1 className="text-2xl font-bold text-gray-900">{displayTitle}</h1>
                                <span
                                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${reviewStatusBadgeClass(detail.review_status)}`}
                                >
                                    {transportReviewStatusLabel(detail.review_status)}
                                </span>
                                <span
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${rawNameBadgeClass(detail.raw_name_status)}`}
                                >
                                    {detail.raw_name_status} name
                                </span>
                                <span className="text-sm text-gray-500">
                                    {transportModeLabel(detail.mode)} · {detail.terminal_role}
                                    {detail.terminal_code ? ` · #${detail.terminal_code}` : ""}
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

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
                    {/* Left: info / edit form */}
                    <aside className="space-y-4">
                        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                                Terminal info
                            </h2>
                            {loading ? (
                                <div className="space-y-2">
                                    {[0, 1, 2, 3, 4].map((i) => (
                                        <div
                                            key={i}
                                            className="h-4 animate-pulse rounded bg-gray-100"
                                        />
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
                                        {detail.raw_name_status !== "real" ? (
                                            <p className="mt-1 text-[11px] text-amber-700">
                                                Current name is {detail.raw_name_status}. Replace it
                                                with a verified, user-facing name.
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={LABEL_CLASS}>Name (MM)</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={form.name_mm}
                                                onChange={(e) =>
                                                    setField("name_mm", e.target.value)
                                                }
                                            />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>Name (EN)</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={form.name_en}
                                                onChange={(e) =>
                                                    setField("name_en", e.target.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={LABEL_CLASS}>Terminal code</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={form.terminal_code}
                                                onChange={(e) =>
                                                    setField("terminal_code", e.target.value)
                                                }
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
                                            <label className={LABEL_CLASS}>Terminal role</label>
                                            <input
                                                className={INPUT_CLASS}
                                                value={form.terminal_role}
                                                onChange={(e) =>
                                                    setField("terminal_role", e.target.value)
                                                }
                                            />
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
                                            <label className={LABEL_CLASS}>Linked stop ID</label>
                                            <input
                                                type="number"
                                                min={1}
                                                className={INPUT_CLASS}
                                                value={form.linked_stop_id}
                                                onChange={(e) =>
                                                    setField("linked_stop_id", e.target.value)
                                                }
                                            />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>Operator ID</label>
                                            <input
                                                type="number"
                                                min={1}
                                                className={INPUT_CLASS}
                                                value={form.operator_id}
                                                onChange={(e) =>
                                                    setField("operator_id", e.target.value)
                                                }
                                            />
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
                                    </div>
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
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
                                    <div className="rounded-md border border-teal-100 bg-teal-50/60 p-2">
                                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-teal-900">
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
                                    <InfoRow label="Terminal role" value={detail.terminal_role} />
                                    <InfoRow
                                        label="Terminal code"
                                        value={detail.terminal_code ?? "—"}
                                    />
                                    <InfoRow
                                        label="Confidence"
                                        value={
                                            detail.confidence_score === null
                                                ? "—"
                                                : Math.round(detail.confidence_score)
                                        }
                                    />
                                    <InfoRow
                                        label="Operator"
                                        value={
                                            detail.operator
                                                ? detail.operator.name
                                                : detail.operator_id === null
                                                  ? "—"
                                                  : `#${detail.operator_id}`
                                        }
                                    />
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

                        {/* Linked stop */}
                        {detail && !editing ? (
                            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                                    Linked stop
                                </h2>
                                {detail.linked_stop ? (
                                    <Link
                                        href={transportPath(
                                            `stops/${detail.linked_stop.public_id}`
                                        )}
                                        className="block rounded-md border border-gray-100 p-2 text-sm hover:bg-gray-50"
                                    >
                                        <p className="font-medium text-blue-700">
                                            {detail.linked_stop.name || "Unnamed stop"}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            {transportModeLabel(detail.linked_stop.mode)} ·{" "}
                                            {detail.linked_stop.stop_type}
                                        </p>
                                    </Link>
                                ) : (
                                    <p className="text-sm text-gray-500">No linked stop.</p>
                                )}
                            </section>
                        ) : null}

                        {/* Ferry-specific info */}
                        {detail && !editing && isFerry ? (
                            <section className="rounded-lg border border-teal-200 bg-teal-50/40 p-4 shadow-sm">
                                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-teal-800">
                                    Ferry details
                                </h2>
                                <div className="divide-y divide-teal-100/70">
                                    {isUnverified ? (
                                        <InfoRow
                                            label="Status"
                                            value={
                                                <span className="text-amber-800">
                                                    Ferry landing candidate
                                                </span>
                                            }
                                        />
                                    ) : null}
                                    <InfoRow
                                        label="Vehicle access"
                                        value={
                                            detail.vehicle_access === "unknown" ? (
                                                <span className="text-gray-500">Unknown</span>
                                            ) : (
                                                detail.vehicle_access
                                            )
                                        }
                                    />
                                </div>
                                {isUnverified ? (
                                    <p className="mt-2 text-[11px] text-teal-900/80">
                                        Imported/unreviewed ferry point. Vehicle (RoRo) access is
                                        unknown unless explicit source data exists.
                                    </p>
                                ) : null}
                            </section>
                        ) : null}

                        {/* Names */}
                        {detail && !editing ? (
                            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                                    Names
                                </h2>
                                <div className="divide-y divide-gray-100">
                                    <InfoRow label="Display" value={displayTitle} />
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
                                <div className="mb-2 rounded-md bg-gray-50 p-2 text-xs">
                                    <span className="text-gray-500">Raw stored name: </span>
                                    <span className="wrap-break-word font-medium text-gray-800">
                                        {detail.name || "—"}
                                    </span>
                                    {detail.raw_name_status !== "real" ? (
                                        <span className="ml-1 text-amber-700">
                                            ({detail.raw_name_status})
                                        </span>
                                    ) : null}
                                </div>
                                {detail.sources.length > 0 ? (
                                    <ul className="mb-2 space-y-1 text-sm text-gray-700">
                                        {detail.sources.map((s, i) => (
                                            <li
                                                key={`${s.source_name}-${i}`}
                                                className="flex flex-wrap items-center gap-2"
                                            >
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
                    <section className="flex flex-col gap-2">
                        <TransportPreviewMap
                            title={detail ? transportTerminalDisplayName(detail) : "Terminal"}
                            externalId={detail?.public_id ?? null}
                            editablePoint={activePoint}
                            editablePointColor="#0f766e"
                            pointDraggable={editing}
                            onPointChange={handlePointChange}
                            linkedPoint={linkedStopPoint}
                            pointZoom={MAP_DEFAULT_ZOOM}
                            autoFitKey={`${publicId}${linkedStopPoint ? "+linked" : ""}`}
                            editingHint={
                                editing
                                    ? "Click the map or drag the marker to set this terminal's location."
                                    : null
                            }
                            emptyHint="No geometry available"
                        />

                        {linkedStopPoint ? (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-gray-600">
                                <span className="flex items-center gap-1.5">
                                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0f766e] ring-2 ring-white" />
                                    Terminal
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#7c3aed] ring-2 ring-white" />
                                    Linked stop
                                    {detail?.linked_stop?.name ? ` · ${detail.linked_stop.name}` : ""}
                                </span>
                            </div>
                        ) : null}
                    </section>
                </div>
            </div>
        </main>
    );
}
