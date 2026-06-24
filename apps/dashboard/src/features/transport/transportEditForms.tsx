"use client";

import { useState } from "react";

import { isAbortError } from "@/src/lib/api";
import {
    updateTransportRoute,
    updateTransportRouteVariant,
} from "./api";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
} from "./constants";
import { hasTransportManualName, normalizeTransportNameInput } from "./naming";
import type {
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

// ─── Variant edit form ───────────────────────────────────────────────────────

export function TransportVariantEditForm({
    variant,
    onCancel,
    onSaved,
}: {
    readonly variant: TransportVariantSummary;
    readonly onCancel: () => void;
    readonly onSaved: (updated: TransportVariantSummary) => void;
}) {
    const [variantCode, setVariantCode] = useState(variant.variant_code);
    const [directionName, setDirectionName] = useState(variant.direction_name ?? "");
    const [directionId, setDirectionId] = useState(normNumber(variant.direction_id));
    const [headsign, setHeadsign] = useState(variant.headsign ?? "");
    const [originName, setOriginName] = useState(variant.origin_name ?? "");
    const [destinationName, setDestinationName] = useState(variant.destination_name ?? "");
    const [durationMin, setDurationMin] = useState(normNumber(variant.estimated_duration_min));
    const [reviewStatus, setReviewStatus] = useState(variant.review_status);
    const [confidence, setConfidence] = useState(normNumber(variant.confidence_score));
    const [isActive, setIsActive] = useState(variant.is_active);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!variantCode.trim()) {
            setError("Variant code is required.");
            return;
        }

        const body: UpdateTransportVariantBody = {};
        if (variantCode.trim() !== variant.variant_code) body.variant_code = variantCode.trim();
        if (directionName.trim() !== (variant.direction_name ?? ""))
            body.direction_name = directionName.trim();
        if (headsign.trim() !== (variant.headsign ?? "")) body.headsign = headsign.trim();
        if (originName.trim() !== (variant.origin_name ?? "")) body.origin_name = originName.trim();
        if (destinationName.trim() !== (variant.destination_name ?? ""))
            body.destination_name = destinationName.trim();
        if (reviewStatus !== variant.review_status) body.review_status = reviewStatus;
        if (isActive !== variant.is_active) body.is_active = isActive;

        // Nullable integer fields: "" → null, otherwise parsed integer.
        const dirIdParsed = directionId.trim() === "" ? null : Number(directionId);
        if (dirIdParsed !== null && (!Number.isInteger(dirIdParsed) || dirIdParsed < 0)) {
            setError("Direction id must be a non-negative whole number.");
            return;
        }
        if (dirIdParsed !== variant.direction_id) body.direction_id = dirIdParsed;

        const durParsed = durationMin.trim() === "" ? null : Number(durationMin);
        if (durParsed !== null && (!Number.isInteger(durParsed) || durParsed < 0)) {
            setError("Estimated duration must be a non-negative whole number of minutes.");
            return;
        }
        if (durParsed !== variant.estimated_duration_min) body.estimated_duration_min = durParsed;

        if (confidence.trim() === "") {
            setError("Confidence score is required (0–100).");
            return;
        }
        const conf = Number(confidence);
        if (!Number.isFinite(conf) || conf < 0 || conf > 100) {
            setError("Confidence score must be between 0 and 100.");
            return;
        }
        if (conf !== variant.confidence_score) body.confidence_score = conf;

        if (Object.keys(body).length === 0) {
            onCancel();
            return;
        }

        setSaving(true);
        try {
            const updated = await updateTransportRouteVariant(variant.public_id, body);
            onSaved(updated);
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
                <Field label="Direction id">
                    <input
                        type="number"
                        min={0}
                        className={INPUT_CLASS}
                        value={directionId}
                        placeholder="—"
                        onChange={(e) => setDirectionId(e.target.value)}
                    />
                </Field>
            </div>
            <Field label="Direction name">
                <input
                    className={INPUT_CLASS}
                    value={directionName}
                    placeholder="—"
                    onChange={(e) => setDirectionName(e.target.value)}
                />
            </Field>
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
            <div className="grid grid-cols-2 gap-2">
                <Field label="Est. duration (min)">
                    <input
                        type="number"
                        min={0}
                        className={INPUT_CLASS}
                        value={durationMin}
                        placeholder="—"
                        onChange={(e) => setDurationMin(e.target.value)}
                    />
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
