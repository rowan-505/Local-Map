"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import {
    getTransportInfrastructureLineDetail,
    updateTransportInfrastructureLine,
} from "./api";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
    transportInfrastructureLineDisplayName,
    transportModeLabel,
    transportReviewStatusLabel,
} from "./constants";
import TransportPreviewMap from "./TransportPreviewMap";
import type {
    TransportInfrastructureLineDetail,
    UpdateTransportInfrastructureLineBody,
} from "./types";

const INPUT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL_CLASS = "text-[11px] font-medium uppercase tracking-wide text-gray-500";

type FormState = {
    name: string;
    name_mm: string;
    name_en: string;
    mode: string;
    line_type: string;
    admin_area_id: string;
    review_status: string;
    confidence_score: string;
    is_active: boolean;
};

function detailToForm(d: TransportInfrastructureLineDetail): FormState {
    return {
        name: d.name ?? "",
        name_mm: d.name_mm ?? "",
        name_en: d.name_en ?? "",
        mode: d.mode,
        line_type: d.line_type,
        admin_area_id: d.admin_area_id === null ? "" : String(d.admin_area_id),
        review_status: d.review_status,
        confidence_score: d.confidence_score === null ? "" : String(Math.round(d.confidence_score)),
        is_active: d.is_active,
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

function formatLength(m: number | null): string {
    if (m === null || !Number.isFinite(m)) return "—";
    if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
    return `${Math.round(m)} m`;
}

export type TransportInfrastructureDetailContentProps = {
    readonly publicId: string;
    /**
     * When provided, the header renders a back/close control that calls this
     * instead of linking to the infrastructure list (used by the drawer host).
     * When omitted, a normal "← Back to infrastructure" link is shown.
     */
    readonly onClose?: () => void;
    /** Called after a successful save so a host (e.g. list) can refresh. */
    readonly afterSave?: () => void;
    /**
     * Hide the built-in header (back control + title + edit buttons). Used when
     * a host (e.g. the drawer shell) already renders its own title/close chrome.
     * The Edit/Save/Cancel controls move into the body when hidden.
     */
    readonly hideHeader?: boolean;
};

/**
 * Infrastructure line detail content (line info, names, line map preview with
 * Map/Sat/Hyb + Fit + Show-vertices controls, sources/debug, edit/save/cancel).
 * This is the page-shell-agnostic body so it can render inside the full detail
 * page or the Transport drawer.
 */
export default function TransportInfrastructureDetailContent({
    publicId,
    onClose,
    afterSave,
    hideHeader = false,
}: TransportInfrastructureDetailContentProps) {
    const [detail, setDetail] = useState<TransportInfrastructureLineDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState<FormState | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    // --- Load line detail when publicId changes. -----------------------------
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
                const result = await getTransportInfrastructureLineDetail(publicId, {
                    signal: controller.signal,
                });
                setDetail(result);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load infrastructure line.");
            } finally {
                setLoading(false);
            }
        })();
        return () => controller.abort();
    }, [publicId]);

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

        const lineType = form.line_type.trim();
        if (lineType === "") {
            setSaveError("Line type is required.");
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

        // Build a diff-only payload.
        const body: UpdateTransportInfrastructureLineBody = {};
        const newName = normNullable(form.name);
        if (newName !== detail.name) body.name = newName;
        const newMm = normNullable(form.name_mm);
        if (newMm !== detail.name_mm) body.name_mm = newMm;
        const newEn = normNullable(form.name_en);
        if (newEn !== detail.name_en) body.name_en = newEn;
        if (form.mode !== detail.mode) body.mode = form.mode;
        if (lineType !== detail.line_type) body.line_type = lineType;
        if (adminAreaId !== detail.admin_area_id) body.admin_area_id = adminAreaId;
        if (form.review_status !== detail.review_status) body.review_status = form.review_status;
        if (confidence !== undefined && confidence !== detail.confidence_score) {
            body.confidence_score = confidence;
        }
        if (form.is_active !== detail.is_active) body.is_active = form.is_active;

        if (Object.keys(body).length === 0) {
            setEditing(false);
            setForm(null);
            return;
        }

        setSaving(true);
        setSaveError("");
        try {
            const updated = await updateTransportInfrastructureLine(publicId, body);
            setDetail(updated);
            setEditing(false);
            setForm(null);
            afterSave?.();
        } catch (err) {
            if (isAbortError(err)) return;
            setSaveError(err instanceof Error ? err.message : "Failed to save line.");
        } finally {
            setSaving(false);
        }
    }, [detail, form, publicId, afterSave]);

    const displayTitle = detail ? transportInfrastructureLineDisplayName(detail) : "";

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
                                ← Back to infrastructure
                            </button>
                        ) : (
                            <Link
                                href={transportPath("infrastructure")}
                                className="text-sm text-gray-500 hover:text-gray-900"
                            >
                                ← Back to infrastructure
                            </Link>
                        )}
                        {loading ? (
                            <div className="mt-2 h-7 w-64 animate-pulse rounded bg-gray-200" />
                        ) : detail ? (
                            <div className="mt-1 flex flex-wrap items-center gap-3">
                                <h1
                                    className={`text-2xl font-bold ${detail.raw_name_status === "real" ? "text-gray-900" : "italic text-gray-700"}`}
                                >
                                    {displayTitle}
                                </h1>
                                <span
                                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${reviewStatusBadgeClass(detail.review_status)}`}
                                >
                                    {transportReviewStatusLabel(detail.review_status)}
                                </span>
                                <span className="text-sm text-gray-500">
                                    {transportModeLabel(detail.mode)} · {detail.line_type}
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

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
                {/* Left: info / edit form */}
                <aside className="space-y-4">
                    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                            Line info
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
                                    <label className={LABEL_CLASS}>Name</label>
                                    <input
                                        className={INPUT_CLASS}
                                        value={form.name}
                                        onChange={(e) => setField("name", e.target.value)}
                                    />
                                    {detail.raw_name_status !== "real" ? (
                                        <p className="mt-1 text-[11px] text-amber-700">
                                            Current name is {detail.raw_name_status}. Replace it
                                            with a verified name or leave blank.
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
                                    <div>
                                        <label className={LABEL_CLASS}>Line type</label>
                                        <input
                                            className={INPUT_CLASS}
                                            value={form.line_type}
                                            onChange={(e) =>
                                                setField("line_type", e.target.value)
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
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
                                <p className="rounded-md border border-gray-100 bg-gray-50 p-2 text-[11px] text-gray-500">
                                    Line geometry is preview-only and cannot be edited here.
                                </p>
                            </div>
                        ) : detail ? (
                            <div className="divide-y divide-gray-100">
                                <InfoRow label="Mode" value={transportModeLabel(detail.mode)} />
                                <InfoRow label="Line type" value={detail.line_type} />
                                <InfoRow
                                    label="Confidence"
                                    value={
                                        detail.confidence_score === null
                                            ? "—"
                                            : Math.round(detail.confidence_score)
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
                                <InfoRow label="Length" value={formatLength(detail.length_m)} />
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
                <section className="flex flex-col">
                    <TransportPreviewMap
                        title={detail ? transportInfrastructureLineDisplayName(detail) : "Infrastructure line"}
                        externalId={detail?.public_id ?? null}
                        geometry={detail?.geometry ?? null}
                        autoFitKey={publicId}
                        emptyHint="No geometry available"
                    />
                </section>
            </div>
        </>
    );
}
