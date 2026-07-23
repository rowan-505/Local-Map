"use client";

import { useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { mergeTransportStopsGlobal, previewTransportStopMerge } from "./api";
import { candidateDisplayName } from "./reviewMapCandidateDisplay";
import {
    canSubmitTransportStopMerge,
    defaultFieldSourcesForCanonical,
    formatDirectionUsageSummary,
    formatMergeCompareFieldValue,
    hasStopMergeDirectionUsageMismatch,
    listDifferingMergeFields,
    MERGE_COMPARE_FIELD_LABELS,
    type MergeCompareFieldKey,
} from "./reviewMapMergeCompare";
import { ReviewStatusBadge } from "./transportReviewUi";
import type {
    TransportNearbyStopCandidate,
    TransportStopMergeFieldSource,
    TransportStopMergeFieldSources,
    TransportStopMergeGlobalResult,
    TransportStopMergePreviewResponse,
} from "./types";

const SELECT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

const CHOICE_BUTTON_CLASS =
    "rounded border px-2 py-0.5 text-xs font-medium transition-colors";

function choiceButtonClass(selected: boolean): string {
    return selected
        ? `${CHOICE_BUTTON_CLASS} border-gray-900 bg-gray-900 text-white`
        : `${CHOICE_BUTTON_CLASS} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
}

function UsageSummaryBlock({
    title,
    summary,
}: {
    readonly title: string;
    readonly summary: TransportStopMergePreviewResponse["currentUsage"]["summary"];
}) {
    return (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {title}
            </p>
            <p className="mt-1 text-xs text-gray-800">{formatDirectionUsageSummary(summary)}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
                {summary.totalRoutes} routes · {summary.totalVariants} variants
            </p>
        </div>
    );
}

function FieldChoiceRow({
    field,
    preview,
    choice,
    onChoiceChange,
}: {
    readonly field: MergeCompareFieldKey;
    readonly preview: TransportStopMergePreviewResponse;
    readonly choice: TransportStopMergeFieldSource;
    readonly onChoiceChange: (field: MergeCompareFieldKey, source: TransportStopMergeFieldSource) => void;
}) {
    const comparison = preview.fieldComparison[field];
    const currentValue =
        field === "geom"
            ? comparison.current
            : (comparison as { current: unknown }).current;
    const candidateValue =
        field === "geom"
            ? comparison.candidate
            : (comparison as { candidate: unknown }).candidate;

    return (
        <div className="rounded-md border border-gray-200 px-2.5 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-gray-900">
                    {MERGE_COMPARE_FIELD_LABELS[field]}
                </p>
                <div className="flex flex-wrap gap-1">
                    <button
                        type="button"
                        className={choiceButtonClass(choice === "current")}
                        onClick={() => onChoiceChange(field, "current")}
                    >
                        Use current
                    </button>
                    <button
                        type="button"
                        className={choiceButtonClass(choice === "candidate")}
                        onClick={() => onChoiceChange(field, "candidate")}
                    >
                        Use candidate
                    </button>
                </div>
            </div>
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-500">Current</p>
                    <p className="mt-0.5 font-medium text-gray-800">
                        {field === "review_status" ? (
                            <ReviewStatusBadge reviewStatus={String(currentValue)} />
                        ) : (
                            formatMergeCompareFieldValue(
                                field,
                                currentValue,
                                preview.currentStop.adminAreaName,
                            )
                        )}
                    </p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-500">Candidate</p>
                    <p className="mt-0.5 font-medium text-gray-800">
                        {field === "review_status" ? (
                            <ReviewStatusBadge reviewStatus={String(candidateValue)} />
                        ) : (
                            formatMergeCompareFieldValue(
                                field,
                                candidateValue,
                                preview.candidateStop.adminAreaName,
                            )
                        )}
                    </p>
                    {field === "geom" && preview.fieldComparison.geom.distanceMeters !== null ? (
                        <p className="mt-0.5 text-[11px] text-gray-500">
                            {Math.round(preview.fieldComparison.geom.distanceMeters)} m apart
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

export default function ReviewMapCandidateCompareDialog({
    open,
    currentStopPublicId,
    candidate,
    initialCanonicalSide = "current",
    onClose,
    onMergeSuccess,
    onMergeError,
}: {
    readonly open: boolean;
    readonly currentStopPublicId: string;
    readonly candidate: TransportNearbyStopCandidate;
    readonly initialCanonicalSide?: "current" | "candidate";
    readonly onClose: () => void;
    readonly onMergeSuccess: (
        result: TransportStopMergeGlobalResult,
        currentStopPublicId: string,
    ) => void | Promise<void>;
    readonly onMergeError: (error: unknown) => void;
}) {
    const [preview, setPreview] = useState<TransportStopMergePreviewResponse | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const [canonicalSide, setCanonicalSide] = useState<"current" | "candidate">("current");
    const [fieldChoices, setFieldChoices] = useState<TransportStopMergeFieldSources>({});
    const [reason, setReason] = useState("");
    const [merging, setMerging] = useState(false);
    const [error, setError] = useState("");
    const [acknowledgedSameVariantOccurrences, setAcknowledgedSameVariantOccurrences] =
        useState(false);

    useEffect(() => {
        if (!open) {
            setPreview(null);
            setPreviewError("");
            setCanonicalSide("current");
            setFieldChoices({});
            setReason("");
            setError("");
            setAcknowledgedSameVariantOccurrences(false);
            return;
        }

        setCanonicalSide(initialCanonicalSide);

        const controller = new AbortController();
        setPreviewLoading(true);
        setPreviewError("");
        setAcknowledgedSameVariantOccurrences(false);
        void (async () => {
            try {
                const result = await previewTransportStopMerge(
                    {
                        currentStopId: currentStopPublicId,
                        candidateStopId: candidate.publicId,
                    },
                    { signal: controller.signal },
                );
                setPreview(result);
                const differing = listDifferingMergeFields(result.fieldComparison);
                setFieldChoices(defaultFieldSourcesForCanonical(differing, "current"));
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                setPreview(null);
                setPreviewError(err instanceof Error ? err.message : "Could not load merge preview.");
            } finally {
                if (!controller.signal.aborted) {
                    setPreviewLoading(false);
                }
            }
        })();

        return () => controller.abort();
    }, [open, currentStopPublicId, candidate.publicId, initialCanonicalSide]);

    const differingFields = useMemo(
        () => (preview ? listDifferingMergeFields(preview.fieldComparison) : []),
        [preview],
    );

    const directionMismatch = useMemo(
        () =>
            preview
                ? hasStopMergeDirectionUsageMismatch(
                      preview.currentUsage.summary,
                      preview.candidateUsage.summary,
                  )
                : false,
        [preview],
    );

    const hasSameVariantOccurrences =
        preview !== null && preview.sameVariantConflicts.length > 0;
    const hasTerminalConflict = preview?.terminalConflict?.exists === true;
    const canMerge = canSubmitTransportStopMerge({
        previewLoaded: preview !== null && !previewLoading,
        previewError: Boolean(previewError),
        mergeAllowed: preview?.mergeAllowed === true,
        terminalConflictExists: hasTerminalConflict,
        sameVariantConflictCount: preview?.sameVariantConflicts.length ?? 0,
        acknowledgedSameVariantOccurrences,
    });

    const handleCanonicalSideChange = (side: "current" | "candidate") => {
        setCanonicalSide(side);
        setFieldChoices(defaultFieldSourcesForCanonical(differingFields, side));
    };

    const handleFieldChoiceChange = (
        field: MergeCompareFieldKey,
        source: TransportStopMergeFieldSource,
    ) => {
        setFieldChoices((prev) => ({ ...prev, [field]: source }));
    };

    const handleMerge = async () => {
        if (!preview || !canMerge) {
            return;
        }
        setError("");
        setMerging(true);
        try {
            const canonicalStopId =
                canonicalSide === "current" ? currentStopPublicId : candidate.publicId;
            const duplicateStopId =
                canonicalSide === "current" ? candidate.publicId : currentStopPublicId;
            const result = await mergeTransportStopsGlobal({
                canonicalStopId,
                duplicateStopId,
                currentStopId: currentStopPublicId,
                candidateStopId: candidate.publicId,
                fieldSources: fieldChoices,
                acknowledgeSameVariantOccurrences: hasSameVariantOccurrences
                    ? acknowledgedSameVariantOccurrences
                    : undefined,
                reason: reason.trim() || undefined,
            });
            onClose();
            await onMergeSuccess(result, currentStopPublicId);
        } catch (err) {
            if (isAbortError(err)) {
                return;
            }
            onClose();
            onMergeError(err);
        } finally {
            setMerging(false);
        }
    };

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
            <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
                <h3 className="text-sm font-semibold text-gray-900">Compare &amp; merge stops</h3>
                <p className="mt-1 text-xs text-gray-600">
                    Choose which row survives and which field values to keep. The duplicate stop is
                    permanently deleted.
                </p>

                {previewLoading ? (
                    <p className="mt-4 text-xs text-gray-600">Loading comparison…</p>
                ) : null}

                {previewError ? (
                    <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                        {previewError}
                    </p>
                ) : null}

                {preview ? (
                    <>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            <UsageSummaryBlock
                                title="Current route usage"
                                summary={preview.currentUsage.summary}
                            />
                            <UsageSummaryBlock
                                title="Candidate route usage"
                                summary={preview.candidateUsage.summary}
                            />
                        </div>

                        {directionMismatch ? (
                            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                                These stops are used in different directions and may represent
                                opposite-side stops.
                            </p>
                        ) : null}

                        {hasTerminalConflict ? (
                            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                                Both stops are linked to terminals. Resolve the terminal
                                relationship first.
                            </p>
                        ) : null}

                        {hasSameVariantOccurrences ? (
                            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                                <p className="font-medium">
                                    {preview.sameVariantWarning ??
                                        "Both stops occur in the same variant. After merge, that physical stop will appear multiple times in the sequence."}
                                </p>
                                <ul className="mt-1 list-disc pl-4">
                                    {preview.sameVariantConflicts.map((conflict) => (
                                        <li
                                            key={`${conflict.routeCode}-${conflict.variantCode}-${conflict.currentSequence}-${conflict.candidateSequence}`}
                                        >
                                            {conflict.routeCode} · {conflict.variantCode} (seq{" "}
                                            {conflict.currentSequence} and {conflict.candidateSequence})
                                        </li>
                                    ))}
                                </ul>
                                <label className="mt-2 flex items-start gap-2">
                                    <input
                                        type="checkbox"
                                        checked={acknowledgedSameVariantOccurrences}
                                        onChange={(event) =>
                                            setAcknowledgedSameVariantOccurrences(
                                                event.target.checked,
                                            )
                                        }
                                        className="mt-0.5"
                                    />
                                    <span>
                                        I understand the surviving stop may appear multiple times in
                                        the same variant sequence.
                                    </span>
                                </label>
                            </div>
                        ) : null}

                        <div className="mt-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Surviving row
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className={choiceButtonClass(canonicalSide === "current")}
                                    onClick={() => handleCanonicalSideChange("current")}
                                >
                                    Keep current row ID
                                </button>
                                <button
                                    type="button"
                                    className={choiceButtonClass(canonicalSide === "candidate")}
                                    onClick={() => handleCanonicalSideChange("candidate")}
                                >
                                    Keep candidate row ID
                                </button>
                            </div>
                        </div>

                        {differingFields.length > 0 ? (
                            <div className="mt-4 space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Differing fields
                                </p>
                                {differingFields.map((field) => (
                                    <FieldChoiceRow
                                        key={field}
                                        field={field}
                                        preview={preview}
                                        choice={fieldChoices[field] ?? canonicalSide}
                                        onChoiceChange={handleFieldChoiceChange}
                                    />
                                ))}
                            </div>
                        ) : (
                            <p className="mt-4 text-xs text-gray-600">
                                All compared fields match. Merge will only move references.
                            </p>
                        )}
                    </>
                ) : null}

                <label className="mt-4 flex flex-col gap-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Reason (optional)
                    </span>
                    <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={`Merge ${candidateDisplayName(candidate)} with current stop`}
                        className={SELECT_CLASS}
                    />
                </label>

                {error ? (
                    <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                        {error}
                    </p>
                ) : null}

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        disabled={merging}
                        onClick={onClose}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        disabled={!canMerge || merging}
                        onClick={() => void handleMerge()}
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
                    >
                        {merging ? "Merging…" : "Merge stops"}
                    </button>
                </div>
            </div>
        </div>
    );
}
