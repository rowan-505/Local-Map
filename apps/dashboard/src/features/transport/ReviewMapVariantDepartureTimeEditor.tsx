"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { patchTransportVariantDepartureTime } from "./api";
import {
    formatVariantDepartureTimeDisplay,
    formatVariantDepartureTimeForInput,
    hasExplicitVariantDepartureTime,
    resolveVariantDepartureAnchor,
    validateCanonicalTime,
} from "./routeStopTimetableDisplay";
import type { TransportRouteStopMutationResult } from "./types";

const INPUT_CLASS =
    "w-24 rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] tabular-nums text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const TOOLBAR_BTN_CLASS =
    "rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";
const PANEL_BTN_CLASS =
    "rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";

type PendingConfirmAction = "save" | "clear";

type ConfirmOverlayProps = {
    readonly open: boolean;
    readonly title: string;
    readonly description: string;
    readonly confirmLabel: string;
    readonly confirmTone?: "primary" | "danger";
    readonly isBusy?: boolean;
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
};

function ConfirmOverlay({
    open,
    title,
    description,
    confirmLabel,
    confirmTone = "primary",
    isBusy = false,
    onConfirm,
    onCancel,
}: ConfirmOverlayProps) {
    const titleId = useId();
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        confirmRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onCancel();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onCancel]);

    if (!open) {
        return null;
    }

    const confirmClass =
        confirmTone === "danger"
            ? "bg-red-700 text-white hover:bg-red-800"
            : "bg-gray-900 text-white hover:bg-gray-800";

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            role="presentation"
            onClick={onCancel}
        >
            <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <h2 id={titleId} className="text-sm font-semibold text-slate-900">
                    {title}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{description}</p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={onCancel}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        ref={confirmRef}
                        type="button"
                        disabled={isBusy}
                        onClick={onConfirm}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${confirmClass}`}
                    >
                        {isBusy ? "Saving…" : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

export type ReviewMapVariantDepartureTimeEditorProps = {
    readonly variantPublicId: string;
    /** Raw normalized_data.departure_time_text from the variant. */
    readonly departureTimeText: string | null | undefined;
    readonly disabled?: boolean;
    readonly onUpdated: (
        result: TransportRouteStopMutationResult,
        departureTimeText: string | null,
    ) => void;
};

export default function ReviewMapVariantDepartureTimeEditor({
    variantPublicId,
    departureTimeText,
    disabled = false,
    onUpdated,
}: ReviewMapVariantDepartureTimeEditorProps) {
    const [editorOpen, setEditorOpen] = useState(false);
    const [draft, setDraft] = useState(() => formatVariantDepartureTimeForInput(departureTimeText));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmAction | null>(null);

    const storedAnchor = resolveVariantDepartureAnchor(departureTimeText);
    const hasExplicitDepartureTime = hasExplicitVariantDepartureTime(departureTimeText);
    const readOnlyDisplay = formatVariantDepartureTimeDisplay(departureTimeText);

    useEffect(() => {
        setEditorOpen(false);
        setDraft(formatVariantDepartureTimeForInput(departureTimeText));
        setError("");
        setPendingConfirm(null);
    }, [departureTimeText, variantPublicId]);

    const closeEditor = useCallback(() => {
        setEditorOpen(false);
        setDraft(formatVariantDepartureTimeForInput(departureTimeText));
        setError("");
        setPendingConfirm(null);
    }, [departureTimeText]);

    const persistDepartureTime = useCallback(
        (nextValue: string | null) => {
            setSaving(true);
            setError("");
            void patchTransportVariantDepartureTime(variantPublicId, {
                departureTimeText: nextValue,
            })
                .then((result) => {
                    onUpdated(result, nextValue);
                    setEditorOpen(false);
                    setPendingConfirm(null);
                })
                .catch((err: unknown) => {
                    if (isAbortError(err)) {
                        return;
                    }
                    setError(
                        err instanceof Error ? err.message : "Failed to save departure time.",
                    );
                    setPendingConfirm(null);
                })
                .finally(() => setSaving(false));
        },
        [onUpdated, variantPublicId],
    );

    const requestSave = useCallback(() => {
        const trimmed = draft.trim();

        if (trimmed.length === 0) {
            setError('Enter strict HH:mm like "16:45" or use Clear to remove the anchor.');
            return;
        }

        if (!validateCanonicalTime(trimmed)) {
            setError('Use strict HH:mm like "16:45".');
            return;
        }

        if (trimmed === storedAnchor) {
            closeEditor();
            return;
        }

        setError("");
        setPendingConfirm("save");
    }, [closeEditor, draft, storedAnchor]);

    const requestClear = useCallback(() => {
        if (!hasExplicitDepartureTime) {
            return;
        }
        setError("");
        setPendingConfirm("clear");
    }, [hasExplicitDepartureTime]);

    const handleConfirm = useCallback(() => {
        if (pendingConfirm === "clear") {
            persistDepartureTime(null);
            return;
        }
        if (pendingConfirm === "save") {
            const trimmed = draft.trim();
            if (!validateCanonicalTime(trimmed)) {
                setError('Use strict HH:mm like "16:45".');
                setPendingConfirm(null);
                return;
            }
            persistDepartureTime(trimmed);
        }
    }, [draft, pendingConfirm, persistDepartureTime]);

    const confirmCopy =
        pendingConfirm === "clear"
            ? {
                  title: "Clear departure time?",
                  description:
                      "The variant departure time will be removed. Calculated stop clock times will show — until a departure time is set. Travel, waiting, and imported source times will not change.",
                  confirmLabel: "Clear departure time",
                  confirmTone: "danger" as const,
              }
            : {
                  title: "Save departure time?",
                  description:
                      "This will recalculate displayed stop times for the whole variant. Travel and waiting intervals will not change.",
                  confirmLabel: "Save departure time",
                  confirmTone: "primary" as const,
              };

    const openEditor = useCallback(() => {
        setDraft(formatVariantDepartureTimeForInput(departureTimeText));
        setError("");
        setEditorOpen(true);
    }, [departureTimeText]);

    return (
        <Fragment>
            {!editorOpen ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-600">
                    <span>
                        Departure time:{" "}
                        <span className="font-medium text-gray-800">{readOnlyDisplay}</span>
                    </span>
                    <button
                        type="button"
                        onClick={openEditor}
                        disabled={disabled || saving}
                        className={TOOLBAR_BTN_CLASS}
                    >
                        Edit
                    </button>
                </div>
            ) : (
                <div className="rounded border border-gray-200 bg-gray-50/80 px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-gray-600">Departure time:</span>
                        <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            spellCheck={false}
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder="HH:mm"
                            disabled={disabled || saving}
                            className={INPUT_CLASS}
                            aria-label="Variant departure time in HH:mm"
                        />
                        <button
                            type="button"
                            onClick={requestSave}
                            disabled={disabled || saving}
                            className="rounded bg-gray-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Save
                        </button>
                        <button
                            type="button"
                            onClick={requestClear}
                            disabled={disabled || saving || !hasExplicitDepartureTime}
                            className={PANEL_BTN_CLASS}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            onClick={closeEditor}
                            disabled={saving}
                            className={PANEL_BTN_CLASS}
                        >
                            Cancel
                        </button>
                    </div>
                    {error ? (
                        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-800">
                            {error}
                        </p>
                    ) : null}
                </div>
            )}
            <ConfirmOverlay
                open={pendingConfirm !== null}
                title={confirmCopy.title}
                description={confirmCopy.description}
                confirmLabel={confirmCopy.confirmLabel}
                confirmTone={confirmCopy.confirmTone}
                isBusy={saving}
                onConfirm={handleConfirm}
                onCancel={() => setPendingConfirm(null)}
            />
        </Fragment>
    );
}
