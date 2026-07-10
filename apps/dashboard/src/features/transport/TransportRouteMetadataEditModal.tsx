"use client";

import { useEffect, useId, useRef, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { patchTransportRouteMetadata } from "./api";
import { TRANSPORT_REVIEW_STATUS_OPTIONS } from "./constants";
import { hasTransportManualName, normalizeTransportNameInput } from "./naming";
import type { PatchTransportRouteMetadataBody, TransportRouteDetail } from "./types";

const INPUT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL_CLASS = "text-[11px] font-medium uppercase tracking-wide text-gray-500";

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

function normNumber(value: number | null): string {
    return value === null || !Number.isFinite(value) ? "" : String(value);
}

function formatOperationDaysInput(days: readonly string[]): string {
    return days.join(", ");
}

function parseOperationDaysInput(value: string): string[] {
    return value
        .split(/[,;]+/)
        .map((part) => part.trim())
        .filter((part) => part !== "");
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((value, index) => value === right[index]);
}

export type TransportRouteMetadataEditModalProps = {
    readonly open: boolean;
    readonly route: TransportRouteDetail | null;
    readonly onClose: () => void;
    readonly onSaved: (updated: TransportRouteDetail) => void;
};

export default function TransportRouteMetadataEditModal({
    open,
    route,
    onClose,
    onSaved,
}: TransportRouteMetadataEditModalProps) {
    const titleId = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);
    const metadata = route?.routeMetadata;
    const isTrain = (metadata?.summary.mode ?? route?.mode) === "train";

    const [nameMm, setNameMm] = useState("");
    const [nameEn, setNameEn] = useState("");
    const [originName, setOriginName] = useState("");
    const [destinationName, setDestinationName] = useState("");
    const [reviewStatus, setReviewStatus] = useState("");
    const [confidence, setConfidence] = useState("");
    const [trainType, setTrainType] = useState("");
    const [trainModel, setTrainModel] = useState("");
    const [operationDays, setOperationDays] = useState("");
    const [displayHeadsign, setDisplayHeadsign] = useState("");
    const [isYangonUrbanService, setIsYangonUrbanService] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open || !route) {
            return;
        }

        setNameMm(route.name_mm ?? "");
        setNameEn(route.name_en ?? "");
        setOriginName(route.origin_name ?? "");
        setDestinationName(route.destination_name ?? "");
        setReviewStatus(route.review_status);
        setConfidence(normNumber(route.confidence_score));
        setTrainType(metadata?.summary.trainType ?? "");
        setTrainModel(metadata?.summary.trainModel ?? "");
        setOperationDays(formatOperationDaysInput(metadata?.summary.operationDays ?? []));
        setDisplayHeadsign(metadata?.names.displayHeadsign ?? "");
        setIsYangonUrbanService(metadata?.train.isYangonUrbanService ?? false);
        setError("");
    }, [open, route, metadata]);

    useEffect(() => {
        if (!open) {
            return;
        }
        cancelRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !saving) {
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose, saving]);

    if (!open || !route) {
        return null;
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError("");

        if (!hasTransportManualName(nameMm, nameEn)) {
            setError("Enter at least one of Myanmar name or English name.");
            return;
        }

        if (confidence.trim() === "") {
            setError("Confidence score is required (0–100).");
            return;
        }
        const confidenceValue = Number(confidence);
        if (!Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 100) {
            setError("Confidence score must be between 0 and 100.");
            return;
        }

        const body: PatchTransportRouteMetadataBody = {};
        const routeNames: NonNullable<PatchTransportRouteMetadataBody["routeNames"]> = {};
        const routeFields: NonNullable<PatchTransportRouteMetadataBody["route"]> = {};
        const normalizedDataPatch: NonNullable<
            PatchTransportRouteMetadataBody["normalizedDataPatch"]
        > = {};

        const newMm = normalizeTransportNameInput(nameMm);
        if (newMm !== route.name_mm) {
            routeNames.my = newMm;
        }
        const newEn = normalizeTransportNameInput(nameEn);
        if (newEn !== route.name_en) {
            routeNames.en = newEn;
        }
        if (originName.trim() !== (route.origin_name ?? "")) {
            routeFields.originName = originName.trim() || null;
        }
        if (destinationName.trim() !== (route.destination_name ?? "")) {
            routeFields.destinationName = destinationName.trim() || null;
        }
        if (reviewStatus !== route.review_status) {
            routeFields.reviewStatus = reviewStatus;
        }
        if (confidenceValue !== route.confidence_score) {
            routeFields.confidenceScore = confidenceValue;
        }

        if (isTrain) {
            const nextTrainType = trainType.trim() || null;
            const currentTrainType = metadata?.summary.trainType ?? null;
            if (nextTrainType !== currentTrainType) {
                normalizedDataPatch.train_type = nextTrainType;
            }

            const nextTrainModel = trainModel.trim() || null;
            const currentTrainModel = metadata?.summary.trainModel ?? null;
            if (nextTrainModel !== currentTrainModel) {
                normalizedDataPatch.train_model = nextTrainModel;
            }

            const nextOperationDays = parseOperationDaysInput(operationDays);
            const currentOperationDays = metadata?.summary.operationDays ?? [];
            if (!arraysEqual(nextOperationDays, currentOperationDays)) {
                normalizedDataPatch.operation_days = nextOperationDays;
            }

            const nextHeadsign = displayHeadsign.trim() || null;
            const currentHeadsign = metadata?.names.displayHeadsign ?? null;
            if (nextHeadsign !== currentHeadsign) {
                normalizedDataPatch.display_headsign = nextHeadsign;
            }

            const currentUrban = metadata?.train.isYangonUrbanService ?? false;
            if (isYangonUrbanService !== currentUrban) {
                normalizedDataPatch.is_yangon_urban_service = isYangonUrbanService;
            }
        }

        if (Object.keys(routeNames).length > 0) {
            body.routeNames = routeNames;
        }
        if (Object.keys(routeFields).length > 0) {
            body.route = routeFields;
        }
        if (Object.keys(normalizedDataPatch).length > 0) {
            body.normalizedDataPatch = normalizedDataPatch;
        }

        if (Object.keys(body).length === 0) {
            onClose();
            return;
        }

        setSaving(true);
        try {
            const updated = await patchTransportRouteMetadata(route.public_id, body);
            onSaved(updated);
            onClose();
        } catch (err) {
            if (isAbortError(err)) {
                return;
            }
            setError(err instanceof Error ? err.message : "Failed to save metadata.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            role="presentation"
            onClick={() => {
                if (!saving) {
                    onClose();
                }
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                    Edit route metadata
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                    Update route names, review fields, and train import metadata.
                </p>

                <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            Common
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Myanmar name">
                                <input
                                    className={INPUT_CLASS}
                                    value={nameMm}
                                    onChange={(event) => setNameMm(event.target.value)}
                                />
                            </Field>
                            <Field label="English name">
                                <input
                                    className={INPUT_CLASS}
                                    value={nameEn}
                                    onChange={(event) => setNameEn(event.target.value)}
                                />
                            </Field>
                            <Field label="Origin">
                                <input
                                    className={INPUT_CLASS}
                                    value={originName}
                                    onChange={(event) => setOriginName(event.target.value)}
                                />
                            </Field>
                            <Field label="Destination">
                                <input
                                    className={INPUT_CLASS}
                                    value={destinationName}
                                    onChange={(event) => setDestinationName(event.target.value)}
                                />
                            </Field>
                            <Field label="Review status">
                                <select
                                    className={INPUT_CLASS}
                                    value={reviewStatus}
                                    onChange={(event) => setReviewStatus(event.target.value)}
                                >
                                    {TRANSPORT_REVIEW_STATUS_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Confidence score">
                                <input
                                    className={INPUT_CLASS}
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={confidence}
                                    onChange={(event) => setConfidence(event.target.value)}
                                />
                            </Field>
                        </div>
                    </div>

                    {isTrain ? (
                        <div className="space-y-3 border-t border-gray-100 pt-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                Train
                            </p>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Field label="Train type">
                                    <input
                                        className={INPUT_CLASS}
                                        value={trainType}
                                        onChange={(event) => setTrainType(event.target.value)}
                                    />
                                </Field>
                                <Field label="Train model">
                                    <input
                                        className={INPUT_CLASS}
                                        value={trainModel}
                                        onChange={(event) => setTrainModel(event.target.value)}
                                    />
                                </Field>
                                <Field label="Operation days">
                                    <input
                                        className={INPUT_CLASS}
                                        value={operationDays}
                                        placeholder="daily, friday"
                                        onChange={(event) => setOperationDays(event.target.value)}
                                    />
                                </Field>
                                <Field label="Display headsign">
                                    <input
                                        className={INPUT_CLASS}
                                        value={displayHeadsign}
                                        onChange={(event) => setDisplayHeadsign(event.target.value)}
                                    />
                                </Field>
                            </div>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={isYangonUrbanService}
                                    onChange={(event) =>
                                        setIsYangonUrbanService(event.target.checked)
                                    }
                                    className="h-4 w-4 rounded border-gray-300"
                                />
                                Yangon urban / circular service
                            </label>
                        </div>
                    ) : null}

                    {error ? (
                        <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                            {error}
                        </p>
                    ) : null}

                    <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
                        <button
                            ref={cancelRef}
                            type="button"
                            onClick={onClose}
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
                </form>
            </div>
        </div>
    );
}
