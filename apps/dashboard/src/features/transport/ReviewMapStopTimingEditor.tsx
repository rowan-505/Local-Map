"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { patchTransportRouteStopTiming } from "./api";
import {
    buildRouteStopTimingRequestBody,
    draftFromRouteStop,
    draftHasPersistableChanges,
    draftHasTimingPayload,
    getStopTimingEditorClockDisplay,
    isDraftTravelMissing,
    isDraftWaitingMissing,
    previewRouteStopTimingClocks,
    type RouteStopTimingClockPreview,
    type RouteStopTimingDraft,
} from "./routeStopTimingEditor";
import { durationMinutesHint, getRouteStopSourceProvenance, ROUTE_STOP_EMPTY_DISPLAY } from "./routeStopTimingDisplay";
import type { VariantTimetableStopSchedule } from "./routeStopTimetableDisplay";
import type { TransportRouteStopItem, TransportRouteStopMutationResult } from "./types";

const INPUT_CLASS =
    "w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs tabular-nums text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL_CLASS = "text-[10px] font-medium uppercase tracking-wide text-gray-500";
const TOOLBAR_BTN_CLASS =
    "rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";
const PANEL_BTN_CLASS =
    "rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";

function DurationMinutesField({
    label,
    value,
    disabled,
    isMissing,
    onChange,
}: {
    readonly label: string;
    readonly value: string;
    readonly disabled: boolean;
    readonly isMissing: boolean;
    readonly onChange: (value: string) => void;
}) {
    const hint = durationMinutesHint(value, { isMissing });

    return (
        <div className="flex flex-col gap-0.5">
            <span className={LABEL_CLASS}>{label}</span>
            <div className="flex items-center gap-1.5">
                <input
                    type="number"
                    min={0}
                    step={1}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    disabled={disabled}
                    aria-invalid={isMissing || undefined}
                    className={`${INPUT_CLASS} ${isMissing ? "text-gray-400" : ""}`}
                />
                <span className="text-[11px] text-gray-500">min</span>
            </div>
            {hint ? <span className="text-[10px] text-gray-400">{hint}</span> : null}
        </div>
    );
}

function ReadOnlyCalculatedClocks({
    display,
    showArrival,
    showDeparture,
}: {
    readonly display: RouteStopTimingClockPreview;
    readonly showArrival: boolean;
    readonly showDeparture: boolean;
}) {
    return (
        <div className="rounded border border-gray-100 bg-gray-50/80 px-2 py-1.5">
            <p className={LABEL_CLASS}>Calculated time</p>
            <div className="mt-1 space-y-0.5 text-[11px] tabular-nums">
                {showArrival ? (
                    <p
                        className={
                            display.hasArrivalClockData ? "text-gray-700" : "text-gray-400"
                        }
                    >
                        Arrival: {display.arrival}
                    </p>
                ) : null}
                {showDeparture ? (
                    <p
                        className={
                            display.hasDepartureClockData ? "text-gray-700" : "text-gray-400"
                        }
                    >
                        Departure: {display.departure}
                    </p>
                ) : null}
            </div>
        </div>
    );
}

export type ReviewMapStopTimingEditorProps = {
    readonly stop: TransportRouteStopItem;
    readonly stops: readonly TransportRouteStopItem[];
    readonly stopIndex: number;
    /** Shared schedule row for this stop (same source as the ordered stop list). */
    readonly persistedSchedule: VariantTimetableStopSchedule;
    readonly departureTimeText?: string | null;
    readonly disabled?: boolean;
    readonly onUpdated: (result: TransportRouteStopMutationResult) => void;
};

export default function ReviewMapStopTimingEditor({
    stop,
    stops,
    stopIndex,
    persistedSchedule,
    departureTimeText = null,
    disabled = false,
    onUpdated,
}: ReviewMapStopTimingEditorProps) {
    const [editorOpen, setEditorOpen] = useState(false);
    const [draft, setDraft] = useState<RouteStopTimingDraft>(() => draftFromRouteStop(stop));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setEditorOpen(false);
        setDraft(draftFromRouteStop(stop));
        setError("");
    }, [stop.id]);

    const closeEditor = useCallback(() => {
        setEditorOpen(false);
        setDraft(draftFromRouteStop(stop));
        setError("");
    }, [stop]);

    const showTravelField = !persistedSchedule.isFirst;
    const showWaitingField = !persistedSchedule.isLast;
    const showArrivalField = !persistedSchedule.isFirst;
    const showDepartureField = !persistedSchedule.isLast || persistedSchedule.isFirst;
    const travelIsMissing = showTravelField && isDraftTravelMissing(draft);
    const waitingIsMissing = showWaitingField && isDraftWaitingMissing(draft);

    const persistedClocks = useMemo(
        () => getStopTimingEditorClockDisplay(stop, persistedSchedule),
        [persistedSchedule, stop],
    );

    const calculatedClocks = useMemo(() => {
        if (!editorOpen) {
            return persistedClocks;
        }
        return previewRouteStopTimingClocks(stops, stopIndex, draft, departureTimeText);
    }, [
        departureTimeText,
        draft,
        editorOpen,
        persistedClocks,
        stopIndex,
        stops,
    ]);

    const sourceProvenance = useMemo(() => getRouteStopSourceProvenance(stop), [stop]);
    const hasImportedSourceTime =
        sourceProvenance.importedSourceTime !== ROUTE_STOP_EMPTY_DISPLAY ||
        sourceProvenance.sourceTimeType !== ROUTE_STOP_EMPTY_DISPLAY;

    const handleSave = useCallback(() => {
        if (!draftHasPersistableChanges(draft, stop)) {
            closeEditor();
            return;
        }

        const requestBody = buildRouteStopTimingRequestBody(draft);
        if (!draftHasTimingPayload(draft)) {
            closeEditor();
            return;
        }

        setSaving(true);
        setError("");
        void patchTransportRouteStopTiming(stop.id, requestBody)
            .then((result) => {
                onUpdated(result);
                setEditorOpen(false);
            })
            .catch((err: unknown) => {
                if (isAbortError(err)) {
                    return;
                }
                setError(err instanceof Error ? err.message : "Failed to save timing.");
            })
            .finally(() => setSaving(false));
    }, [closeEditor, draft, onUpdated, stop]);

    const updateTravelMinutes = useCallback((travelMinutes: string) => {
        setDraft((prev) => ({ ...prev, travelMinutes, travelTouched: true }));
    }, []);

    const updateWaitingMinutes = useCallback((waitingMinutes: string) => {
        setDraft((prev) => ({ ...prev, waitingMinutes, waitingTouched: true }));
    }, []);

    return (
        <Fragment>
            <ReadOnlyCalculatedClocks
                display={calculatedClocks}
                showArrival={showArrivalField}
                showDeparture={showDepartureField}
            />
            {hasImportedSourceTime ? (
                <p className="mt-1 text-[10px] leading-relaxed text-gray-400">
                    Import source
                    {sourceProvenance.importedSourceTime !== ROUTE_STOP_EMPTY_DISPLAY
                        ? `: ${sourceProvenance.importedSourceTime}`
                        : ""}
                    {sourceProvenance.sourceTimeType !== ROUTE_STOP_EMPTY_DISPLAY
                        ? ` (${sourceProvenance.sourceTimeType})`
                        : ""}
                </p>
            ) : null}
            {!editorOpen ? (
                <button
                    type="button"
                    onClick={() => setEditorOpen(true)}
                    disabled={disabled || saving}
                    className={`mt-1.5 ${TOOLBAR_BTN_CLASS}`}
                >
                    Edit timing
                </button>
            ) : (
                <div className="mt-1.5 w-full basis-full rounded border border-gray-200 bg-white/90 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-gray-700">Edit timing</p>
                        <button
                            type="button"
                            onClick={closeEditor}
                            disabled={saving}
                            className="text-[10px] font-medium text-gray-500 hover:text-gray-800"
                        >
                            Close
                        </button>
                    </div>

                    <div className="space-y-2">
                        {showTravelField ? (
                            <DurationMinutesField
                                label="Travel from previous"
                                value={draft.travelMinutes}
                                disabled={disabled || saving}
                                isMissing={travelIsMissing}
                                onChange={updateTravelMinutes}
                            />
                        ) : null}
                        {showWaitingField ? (
                            <DurationMinutesField
                                label="Waiting at this stop"
                                value={draft.waitingMinutes}
                                disabled={disabled || saving}
                                isMissing={waitingIsMissing}
                                onChange={updateWaitingMinutes}
                            />
                        ) : null}
                        <p className="text-[10px] leading-relaxed text-gray-500">
                            Offsets and clock times are recalculated for the whole variant when you
                            save.
                        </p>
                    </div>

                    {error ? (
                        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-800">
                            {error}
                        </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={disabled || saving}
                            className="rounded bg-gray-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {saving ? "Saving…" : "Save timing"}
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
                </div>
            )}
        </Fragment>
    );
}
