"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { createTransportRoute } from "./api";
import { transportModeLabel } from "./constants";
import type { CreateTransportRouteBody } from "./types";

/** Modes the create-route endpoint supports (route_kind is derived server-side). */
const CREATE_ROUTE_MODES = ["bus", "train", "ferry"] as const;
type CreateRouteMode = (typeof CREATE_ROUTE_MODES)[number];

const INPUT_CLASS =
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

/**
 * Describes the variants the backend will auto-create, mirroring the POST
 * /transport/routes rules: loop → one loop variant; ferry → outbound (+ inbound
 * when return is checked); bus/train → outbound + inbound.
 */
function variantPreview(mode: CreateRouteMode, isLoop: boolean, createReturn: boolean): string {
    if (isLoop) {
        return "Will create one loop variant";
    }
    if (mode === "ferry") {
        return createReturn
            ? "Will create outbound and inbound variants"
            : "Will create outbound variant";
    }
    return "Will create outbound and inbound variants";
}

/**
 * "New transport route" modal. Collects the minimal fields for POST
 * /transport/routes (mode, codes, names, optional operator, loop/return flags),
 * shows a small variant preview, and on success hands the new route's public_id
 * back to the caller (to refresh the list and open the detail drawer).
 *
 * Mount this only while open (the caller renders it conditionally) so each open
 * starts from fresh form state without a reset effect.
 */
export default function NewTransportRouteDialog({
    onClose,
    onCreated,
}: {
    readonly onClose: () => void;
    readonly onCreated: (publicId: string) => void;
}) {
    const titleId = useId();

    const [mode, setMode] = useState<CreateRouteMode>("bus");
    const [routeCode, setRouteCode] = useState("");
    const [publicName, setPublicName] = useState("");
    const [originName, setOriginName] = useState("");
    const [destinationName, setDestinationName] = useState("");
    const [operatorId, setOperatorId] = useState("");
    const [isLoop, setIsLoop] = useState(false);
    const [createReturn, setCreateReturn] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !submitting) {
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [submitting, onClose]);

    const trimmedCode = routeCode.trim();
    const trimmedName = publicName.trim();
    const operatorIdNum = operatorId.trim() === "" ? null : Number(operatorId.trim());
    const operatorIdValid =
        operatorIdNum === null || (Number.isInteger(operatorIdNum) && operatorIdNum >= 1);
    const canSubmit =
        trimmedCode.length > 0 && trimmedName.length > 0 && operatorIdValid && !submitting;

    const preview = useMemo(
        () => variantPreview(mode, isLoop, createReturn),
        [mode, isLoop, createReturn]
    );

    const handleSubmit = useCallback(async () => {
        if (!canSubmit) {
            return;
        }
        setSubmitting(true);
        setSubmitError("");
        try {
            const body: CreateTransportRouteBody = {
                mode,
                route_code: trimmedCode,
                public_name: trimmedName,
                ...(originName.trim() ? { origin_name: originName.trim() } : {}),
                ...(destinationName.trim() ? { destination_name: destinationName.trim() } : {}),
                ...(operatorIdNum !== null ? { operator_id: operatorIdNum } : {}),
                is_loop: isLoop,
                // Only meaningful for ferry; harmless (ignored) for other modes.
                ...(mode === "ferry" ? { create_return_variant: createReturn } : {}),
            };
            const result = await createTransportRoute(body);
            onCreated(result.public_id);
        } catch (err) {
            if (isAbortError(err)) return;
            setSubmitError(err instanceof Error ? err.message : "Failed to create route.");
            setSubmitting(false);
        }
    }, [
        canSubmit,
        mode,
        trimmedCode,
        trimmedName,
        originName,
        destinationName,
        operatorIdNum,
        isLoop,
        createReturn,
        onCreated,
    ]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            role="presentation"
            onClick={() => {
                if (!submitting) {
                    onClose();
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
                        New transport route
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        Creates the route and its default variants. Review status starts as
                        “needs review”.
                    </p>
                </div>

                <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                            Mode
                            <select
                                value={mode}
                                onChange={(e) => {
                                    const next = e.target.value as CreateRouteMode;
                                    setMode(next);
                                    if (next !== "ferry") {
                                        setCreateReturn(false);
                                    }
                                }}
                                className={INPUT_CLASS}
                            >
                                {CREATE_ROUTE_MODES.map((m) => (
                                    <option key={m} value={m}>
                                        {transportModeLabel(m)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                            Route code <span className="text-red-500">*</span>
                            <input
                                type="text"
                                value={routeCode}
                                onChange={(e) => setRouteCode(e.target.value)}
                                placeholder="e.g. YBS-37"
                                autoComplete="off"
                                className={INPUT_CLASS}
                            />
                        </label>
                    </div>

                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                        Public name <span className="text-red-500">*</span>
                        <input
                            type="text"
                            value={publicName}
                            onChange={(e) => setPublicName(e.target.value)}
                            placeholder="Display name shown to users"
                            autoComplete="off"
                            className={INPUT_CLASS}
                        />
                    </label>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                            Origin name
                            <input
                                type="text"
                                value={originName}
                                onChange={(e) => setOriginName(e.target.value)}
                                placeholder="Optional"
                                autoComplete="off"
                                className={INPUT_CLASS}
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                            Destination name
                            <input
                                type="text"
                                value={destinationName}
                                onChange={(e) => setDestinationName(e.target.value)}
                                placeholder="Optional"
                                autoComplete="off"
                                className={INPUT_CLASS}
                            />
                        </label>
                    </div>

                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                        Operator ID
                        <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            value={operatorId}
                            onChange={(e) => setOperatorId(e.target.value)}
                            placeholder="Optional — leave blank for now"
                            className={INPUT_CLASS}
                        />
                        {!operatorIdValid ? (
                            <span className="text-xs font-normal text-red-600">
                                Operator ID must be a positive whole number.
                            </span>
                        ) : null}
                    </label>

                    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                                type="checkbox"
                                checked={isLoop}
                                onChange={(e) => setIsLoop(e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                            />
                            Loop route (single circular variant)
                        </label>
                        {mode === "ferry" && !isLoop ? (
                            <label className="flex items-center gap-2 text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={createReturn}
                                    onChange={(e) => setCreateReturn(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                                />
                                Create return variant
                            </label>
                        ) : null}
                        <p className="text-xs font-medium text-slate-500">{preview}</p>
                    </div>

                    {submitError ? (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {submitError}
                        </div>
                    ) : null}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={onClose}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        disabled={!canSubmit}
                        onClick={() => void handleSubmit()}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? "Creating route…" : "Create route"}
                    </button>
                </div>
            </div>
        </div>
    );
}
