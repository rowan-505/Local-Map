"use client";

import { useMemo, useState } from "react";

import {
    PromotionSectionHeading,
    publishEntityFamilyLabel,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import {
    postImportReviewPromotionReleaseStaleBatched,
    type ImportReviewReleaseStaleBatchedResponse,
} from "@/src/lib/api";

const ALL_FAMILIES = [
    "roads",
    "buildings",
    "places",
    "land_areas",
    "water_lines",
    "water_polygons",
    "addresses",
    "admin_areas",
    "routing_barriers",
] as const;

function ReleaseResults({ result }: { result: ImportReviewReleaseStaleBatchedResponse }) {
    const eligibleTotal = result.by_family.reduce((sum, row) => sum + row.eligible_count, 0);

    return (
        <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
            <p className="font-semibold">
                {result.dry_run ? "Dry-run preview" : "Release complete"}
            </p>
            <p className="text-xs opacity-90">
                {result.dry_run
                    ? `${result.released_total.toLocaleString()} candidate(s) would be released to not_ready.`
                    : `${result.released_total.toLocaleString()} candidate(s) released to not_ready.`}
            </p>
            {eligibleTotal > 0 ? (
                <ul className="space-y-0.5">
                    {result.by_family
                        .filter((row) => row.eligible_count > 0)
                        .map((row) => (
                            <li key={row.entity_family} className="flex justify-between gap-4">
                                <span>{publishEntityFamilyLabel(row.entity_family)}</span>
                                <span className="tabular-nums font-medium">
                                    {result.dry_run
                                        ? row.eligible_count.toLocaleString()
                                        : row.released_count.toLocaleString()}
                                </span>
                            </li>
                        ))}
                </ul>
            ) : (
                <p className="text-xs">No stale batched candidates matched the safety rules.</p>
            )}
            {result.samples.length > 0 ? (
                <details className="text-xs">
                    <summary className="cursor-pointer font-medium">Sample candidates</summary>
                    <pre className="mt-2 overflow-auto rounded bg-white/60 p-2">
                        {JSON.stringify(result.samples, null, 2)}
                    </pre>
                </details>
            ) : null}
        </div>
    );
}

type Props = {
    reviewBatchId: string;
    defaultFamilies?: string[];
    formatError?: (err: unknown) => string;
    onReleased?: () => void;
};

export default function ImportReviewPromotionStaleBatchedReleasePanel({
    reviewBatchId,
    defaultFamilies,
    formatError = (err) => (err instanceof Error ? err.message : "Request failed."),
    onReleased,
}: Props) {
    const [selectedFamilies, setSelectedFamilies] = useState<string[]>(
        defaultFamilies?.length ? [...defaultFamilies] : [...ALL_FAMILIES]
    );
    const [previewResult, setPreviewResult] = useState<ImportReviewReleaseStaleBatchedResponse | null>(
        null
    );
    const [releaseResult, setReleaseResult] = useState<ImportReviewReleaseStaleBatchedResponse | null>(
        null
    );
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isReleasing, setIsReleasing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const requestBody = useMemo(
        () => ({
            review_batch_id: Number.parseInt(reviewBatchId, 10),
            families: selectedFamilies,
        }),
        [reviewBatchId, selectedFamilies]
    );

    const canRelease = (previewResult?.released_total ?? 0) > 0;

    function toggleFamily(family: string) {
        setSelectedFamilies((prev) =>
            prev.includes(family) ? prev.filter((f) => f !== family) : [...prev, family]
        );
        setPreviewResult(null);
        setReleaseResult(null);
    }

    async function handlePreview() {
        setIsPreviewing(true);
        setError(null);
        setReleaseResult(null);
        try {
            setPreviewResult(
                await postImportReviewPromotionReleaseStaleBatched({
                    ...requestBody,
                    dry_run: true,
                })
            );
        } catch (err) {
            setError(formatError(err));
            setPreviewResult(null);
        } finally {
            setIsPreviewing(false);
        }
    }

    async function handleRelease() {
        setIsReleasing(true);
        setError(null);
        try {
            const result = await postImportReviewPromotionReleaseStaleBatched({
                ...requestBody,
                dry_run: false,
            });
            setReleaseResult(result);
            setPreviewResult(null);
            setConfirmOpen(false);
            onReleased?.();
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsReleasing(false);
        }
    }

    return (
        <div className="space-y-4">
            <PromotionSectionHeading
                title="Release stale locked items"
                subtitle="Moves candidates stuck in promotion_status=batched after failed or closed publish batches back to not_ready. Does not touch promoted rows or batches still validating or promoting."
            />
            {error ? <ImportReviewStatusBanner message={error} tone="error" /> : null}
            {releaseResult ? <ReleaseResults result={releaseResult} /> : null}
            {previewResult && !releaseResult ? <ReleaseResults result={previewResult} /> : null}

            <div className="flex flex-wrap gap-2">
                {ALL_FAMILIES.map((family) => (
                    <label
                        key={family}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs shadow-sm has-[:checked]:border-emerald-600 has-[:checked]:ring-1 has-[:checked]:ring-emerald-600"
                    >
                        <input
                            type="checkbox"
                            checked={selectedFamilies.includes(family)}
                            onChange={() => toggleFamily(family)}
                        />
                        {publishEntityFamilyLabel(family)}
                    </label>
                ))}
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={isPreviewing || isReleasing || !reviewBatchId.trim()}
                    onClick={() => void handlePreview()}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                >
                    {isPreviewing ? <ImportReviewInlineSpinner /> : null}
                    Preview (dry-run)
                </button>
                <button
                    type="button"
                    disabled={!canRelease || isReleasing || isPreviewing}
                    onClick={() => setConfirmOpen(true)}
                    className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                    Release stale locked items
                </button>
            </div>

            {confirmOpen ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    <p className="font-medium">
                        Release {previewResult?.released_total.toLocaleString() ?? "0"} stale batched
                        candidate(s) for review batch {reviewBatchId}?
                    </p>
                    <p className="mt-1 text-xs opacity-90">
                        Candidates move to promotion_status=not_ready so they can re-enter promotion
                        eligibility. This does not change review decisions.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={isReleasing}
                            onClick={() => void handleRelease()}
                            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                            {isReleasing ? <ImportReviewInlineSpinner /> : null}
                            Confirm release
                        </button>
                        <button
                            type="button"
                            disabled={isReleasing}
                            onClick={() => setConfirmOpen(false)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
