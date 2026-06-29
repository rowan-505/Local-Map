"use client";

import { useState } from "react";

import { isAbortError } from "@/src/lib/api";
import {
    createTransportRouteVariant,
    updateTransportRoute,
    updateTransportRouteVariant,
} from "./api";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
} from "./constants";
import { hasTransportManualName, normalizeTransportNameInput } from "./naming";
import type {
    CreateTransportVariantBody,
    TransportRouteDetail,
    TransportVariantSummary,
    UpdateTransportRouteBody,
    UpdateTransportVariantBody,
} from "./types";

const INPUT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-gray-500";

function Field({
    label,
    children,
}: {
    readonly label: string;
    readonly children: React.ReactNode;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>{label}</span>
            {children}
        </label>
    );
}

function FormActions({
    saving,
    error,
    onCancel,
}: {
    readonly saving: boolean;
    readonly error: string;
    readonly onCancel: () => void;
}) {
    return (
        <>
            {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                    {error}
                </p>
            ) : null}
            <div className="flex items-center justify-end gap-2 pt-1">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={saving}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                    {saving ? "Saving…" : "Save"}
                </button>
            </div>
        </>
    );
}

function normNumber(value: number | null): string {
    return value === null || !Number.isFinite(value) ? "" : String(value);
}

// ─── Route edit form ─────────────────────────────────────────────────────────

export function TransportRouteEditForm({
    route,
    onCancel,
    onSaved,
}: {
    readonly route: TransportRouteDetail;
    readonly onCancel: () => void;
    readonly onSaved: (updated: TransportRouteDetail) => void;
}) {
    const [routeCode, setRouteCode] = useState(route.route_code);
    const [nameMm, setNameMm] = useState(route.name_mm ?? "");
    const [nameEn, setNameEn] = useState(route.name_en ?? "");
    const [mode, setMode] = useState(route.mode);
    const [routeKind, setRouteKind] = useState(route.route_kind);
    const [originName, setOriginName] = useState(route.origin_name ?? "");
    const [destinationName, setDestinationName] = useState(route.destination_name ?? "");
    const [description, setDescription] = useState(route.description ?? "");
    const [reviewStatus, setReviewStatus] = useState(route.review_status);
    const [confidence, setConfidence] = useState(normNumber(route.confidence_score));
    const [isActive, setIsActive] = useState(route.is_active);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!routeCode.trim() || !routeKind.trim()) {
            setError("Route code and route kind are required.");
            return;
        }

        if (!hasTransportManualName(nameMm, nameEn)) {
            setError("Enter at least one of Myanmar name or English name.");
            return;
        }

        const body: UpdateTransportRouteBody = {};
        if (routeCode.trim() !== route.route_code) body.route_code = routeCode.trim();
        const newMm = normalizeTransportNameInput(nameMm);
        if (newMm !== route.name_mm) body.name_mm = newMm;
        const newEn = normalizeTransportNameInput(nameEn);
        if (newEn !== route.name_en) body.name_en = newEn;
        if (mode !== route.mode) body.mode = mode;
        if (routeKind.trim() !== route.route_kind) body.route_kind = routeKind.trim();
        if (originName.trim() !== (route.origin_name ?? "")) body.origin_name = originName.trim();
        if (destinationName.trim() !== (route.destination_name ?? ""))
            body.destination_name = destinationName.trim();
        if (description.trim() !== (route.description ?? "")) body.description = description.trim();
        if (reviewStatus !== route.review_status) body.review_status = reviewStatus;

        if (confidence.trim() === "") {
            setError("Confidence score is required (0–100).");
            return;
        }
        const conf = Number(confidence);
        if (!Number.isFinite(conf) || conf < 0 || conf > 100) {
            setError("Confidence score must be between 0 and 100.");
            return;
        }
        if (conf !== route.confidence_score) body.confidence_score = conf;
        if (isActive !== route.is_active) body.is_active = isActive;

        if (Object.keys(body).length === 0) {
            onCancel();
            return;
        }

        setSaving(true);
        try {
            const updated = await updateTransportRoute(route.public_id, body);
            onSaved(updated);
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to save route.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <form className="space-y-3" onSubmit={handleSubmit}>
            <Field label="Route code">
                <input className={INPUT_CLASS} value={routeCode} onChange={(e) => setRouteCode(e.target.value)} />
            </Field>
            <Field label="Myanmar name (name_mm)">
                <input
                    className={INPUT_CLASS}
                    value={nameMm}
                    placeholder="—"
                    onChange={(e) => setNameMm(e.target.value)}
                />
            </Field>
            <Field label="English name (name_en)">
                <input
                    className={INPUT_CLASS}
                    value={nameEn}
                    placeholder="—"
                    onChange={(e) => setNameEn(e.target.value)}
                />
            </Field>
            <p className="text-[11px] text-gray-500">
                The public display name is derived automatically (Myanmar first, English fallback).
                Enter at least one.
            </p>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Mode">
                    <select className={INPUT_CLASS} value={mode} onChange={(e) => setMode(e.target.value)}>
                        {TRANSPORT_MODE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Route kind">
                    <input className={INPUT_CLASS} value={routeKind} onChange={(e) => setRouteKind(e.target.value)} />
                </Field>
            </div>
            <Field label="Origin name">
                <input
                    className={INPUT_CLASS}
                    value={originName}
                    placeholder="—"
                    onChange={(e) => setOriginName(e.target.value)}
                />
            </Field>
            <Field label="Destination name">
                <input
                    className={INPUT_CLASS}
                    value={destinationName}
                    placeholder="—"
                    onChange={(e) => setDestinationName(e.target.value)}
                />
            </Field>
            <Field label="Description">
                <textarea
                    className={INPUT_CLASS}
                    rows={2}
                    value={description}
                    placeholder="—"
                    onChange={(e) => setDescription(e.target.value)}
                />
            </Field>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Review status">
                    <select
                        className={INPUT_CLASS}
                        value={reviewStatus}
                        onChange={(e) => setReviewStatus(e.target.value)}
                    >
                        {TRANSPORT_REVIEW_STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Confidence (0–100)">
                    <input
                        type="number"
                        min={0}
                        max={100}
                        className={INPUT_CLASS}
                        value={confidence}
                        onChange={(e) => setConfidence(e.target.value)}
                    />
                </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                />
                Active
            </label>
            <FormActions saving={saving} error={error} onCancel={onCancel} />
        </form>
    );
}

// ─── Variant create / edit form ──────────────────────────────────────────────

/**
 * Generic variant direction. direction_id is the GTFS-style code (0 outbound,
 * 1 inbound, 2 loop/branch, null unknown); direction_name carries the human
 * label so loop vs branch (both id 2) stay distinguishable. Labels are mode-
 * neutral so the same form works for bus / train / ferry.
 */
const VARIANT_DIRECTION_OPTIONS = [
    { value: "outbound", label: "Outbound", directionId: 0, directionName: "outbound" },
    { value: "inbound", label: "Inbound", directionId: 1, directionName: "inbound" },
    { value: "loop", label: "Loop", directionId: 2, directionName: "loop" },
    { value: "branch", label: "Branch", directionId: 2, directionName: "branch" },
    { value: "unknown", label: "Unknown", directionId: null, directionName: null },
] as const;

type DirectionKey = (typeof VARIANT_DIRECTION_OPTIONS)[number]["value"];

/** Derive the select value from a variant's stored direction_id / direction_name. */
function directionKeyOf(variant: TransportVariantSummary): DirectionKey {
    if (variant.direction_id === 0) return "outbound";
    if (variant.direction_id === 1) return "inbound";
    if (variant.direction_id === 2) {
        return (variant.direction_name ?? "").toLowerCase().includes("branch")
            ? "branch"
            : "loop";
    }
    return "unknown";
}

const DIRECTION_BY_KEY: Record<DirectionKey, (typeof VARIANT_DIRECTION_OPTIONS)[number]> =
    Object.fromEntries(VARIANT_DIRECTION_OPTIONS.map((o) => [o.value, o])) as Record<
        DirectionKey,
        (typeof VARIANT_DIRECTION_OPTIONS)[number]
    >;

/** "" → null else trimmed value, for optional nullable text/uuid inputs. */
function nullableTrim(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

/**
 * Variant form used for BOTH create (no `variant` prop) and edit (with `variant`).
 * Edit sends only changed fields; create sends the full payload. Origin/destination
 * stop are optional pointers entered as stop public IDs (UUID); leave blank to skip
 * (create) or keep unchanged (edit). Schedule/timetable/fare fields are intentionally
 * not included.
 */
export function TransportVariantForm({
    routePublicId,
    variant,
    onCancel,
    onSaved,
}: {
    /** Required for create; ignored for edit. */
    readonly routePublicId?: string;
    /** Provided for edit; omitted for create. */
    readonly variant?: TransportVariantSummary;
    readonly onCancel: () => void;
    readonly onSaved: (variant: TransportVariantSummary) => void;
}) {
    const isEdit = variant !== undefined;

    const [variantCode, setVariantCode] = useState(variant?.variant_code ?? "");
    const [direction, setDirection] = useState<DirectionKey>(
        variant ? directionKeyOf(variant) : "outbound"
    );
    const [headsign, setHeadsign] = useState(variant?.headsign ?? "");
    const [originName, setOriginName] = useState(variant?.origin_name ?? "");
    const [destinationName, setDestinationName] = useState(variant?.destination_name ?? "");
    const [originStopId, setOriginStopId] = useState("");
    const [destinationStopId, setDestinationStopId] = useState("");
    const [reviewStatus, setReviewStatus] = useState(variant?.review_status ?? "needs_review");
    const [confidence, setConfidence] = useState(
        variant ? normNumber(variant.confidence_score) : "60"
    );
    const [isActive, setIsActive] = useState(variant?.is_active ?? true);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!variantCode.trim()) {
            setError("Variant code is required.");
            return;
        }
        if (confidence.trim() === "") {
            setError("Confidence score is required (0–100).");
            return;
        }
        const conf = Number(confidence);
        if (!Number.isFinite(conf) || conf < 0 || conf > 100) {
            setError("Confidence score must be between 0 and 100.");
            return;
        }
        const dir = DIRECTION_BY_KEY[direction];

        setSaving(true);
        try {
            if (isEdit && variant) {
                // Edit: send only changed fields.
                const body: UpdateTransportVariantBody = {};
                if (variantCode.trim() !== variant.variant_code)
                    body.variant_code = variantCode.trim();
                if (dir.directionId !== variant.direction_id) body.direction_id = dir.directionId;
                if ((dir.directionName ?? null) !== (variant.direction_name ?? null))
                    body.direction_name = dir.directionName;
                if (headsign.trim() !== (variant.headsign ?? ""))
                    body.headsign = nullableTrim(headsign);
                if (originName.trim() !== (variant.origin_name ?? ""))
                    body.origin_name = nullableTrim(originName);
                if (destinationName.trim() !== (variant.destination_name ?? ""))
                    body.destination_name = nullableTrim(destinationName);
                // Stop pointers: only sent when the field was touched (non-empty).
                if (originStopId.trim() !== "") body.origin_stop_public_id = originStopId.trim();
                if (destinationStopId.trim() !== "")
                    body.destination_stop_public_id = destinationStopId.trim();
                if (reviewStatus !== variant.review_status) body.review_status = reviewStatus;
                if (conf !== variant.confidence_score) body.confidence_score = conf;
                if (isActive !== variant.is_active) body.is_active = isActive;

                if (Object.keys(body).length === 0) {
                    onCancel();
                    return;
                }
                const updated = await updateTransportRouteVariant(variant.public_id, body);
                onSaved(updated);
            } else {
                if (!routePublicId) {
                    setError("Missing route reference.");
                    return;
                }
                const body: CreateTransportVariantBody = {
                    variant_code: variantCode.trim(),
                    direction_id: dir.directionId,
                    direction_name: dir.directionName,
                    headsign: nullableTrim(headsign),
                    origin_name: nullableTrim(originName),
                    destination_name: nullableTrim(destinationName),
                    review_status: reviewStatus,
                    confidence_score: conf,
                    ...(originStopId.trim() ? { origin_stop_public_id: originStopId.trim() } : {}),
                    ...(destinationStopId.trim()
                        ? { destination_stop_public_id: destinationStopId.trim() }
                        : {}),
                };
                const created = await createTransportRouteVariant(routePublicId, body);
                onSaved(created);
            }
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to save variant.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Variant code">
                    <input
                        className={INPUT_CLASS}
                        value={variantCode}
                        onChange={(e) => setVariantCode(e.target.value)}
                    />
                </Field>
                <Field label="Direction">
                    <select
                        className={INPUT_CLASS}
                        value={direction}
                        onChange={(e) => setDirection(e.target.value as DirectionKey)}
                    >
                        {VARIANT_DIRECTION_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </Field>
            </div>
            <Field label="Headsign">
                <input
                    className={INPUT_CLASS}
                    value={headsign}
                    placeholder="—"
                    onChange={(e) => setHeadsign(e.target.value)}
                />
            </Field>
            <Field label="Origin name">
                <input
                    className={INPUT_CLASS}
                    value={originName}
                    placeholder="—"
                    onChange={(e) => setOriginName(e.target.value)}
                />
            </Field>
            <Field label="Destination name">
                <input
                    className={INPUT_CLASS}
                    value={destinationName}
                    placeholder="—"
                    onChange={(e) => setDestinationName(e.target.value)}
                />
            </Field>
            <Field label="Origin stop ID (optional)">
                <input
                    className={INPUT_CLASS}
                    value={originStopId}
                    placeholder={isEdit ? "Leave blank to keep unchanged" : "Stop public ID"}
                    onChange={(e) => setOriginStopId(e.target.value)}
                />
            </Field>
            <Field label="Destination stop ID (optional)">
                <input
                    className={INPUT_CLASS}
                    value={destinationStopId}
                    placeholder={isEdit ? "Leave blank to keep unchanged" : "Stop public ID"}
                    onChange={(e) => setDestinationStopId(e.target.value)}
                />
            </Field>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Review status">
                    <select
                        className={INPUT_CLASS}
                        value={reviewStatus}
                        onChange={(e) => setReviewStatus(e.target.value)}
                    >
                        {TRANSPORT_REVIEW_STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Confidence (0–100)">
                    <input
                        type="number"
                        min={0}
                        max={100}
                        className={INPUT_CLASS}
                        value={confidence}
                        onChange={(e) => setConfidence(e.target.value)}
                    />
                </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                />
                Active
            </label>
            <FormActions saving={saving} error={error} onCancel={onCancel} />
        </form>
    );
}
