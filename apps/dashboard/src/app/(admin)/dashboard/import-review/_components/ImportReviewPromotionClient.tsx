"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ImportReviewPromotionEligibilityPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionEligibilityPanel";
import {
    PromotionCardBody,
    PromotionSectionHeading,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { formatImportReviewPromotionError } from "@/src/features/import-review/promotion";
import ImportReviewPromotionBatchLimitsConfirm from "@/src/features/import-review/promotion/ImportReviewPromotionBatchLimitsConfirm";
import {
    evaluatePublishBatchLimits,
    type PublishBatchLimitsConfirmationState,
} from "@/src/features/import-review/promotion/batchLimits";
import {
    buildCreatePublishBatchFamilies,
    PROMOTION_SCOPE_ELIGIBILITY_DEBOUNCE_MS,
    shouldAutoRetryPromotionScopeEligibility,
    shouldFetchPromotionScopeEligibility,
} from "@/src/features/import-review/promotion/promotionScopeEligibility";
import {
    createPublishBatchButtonLabel,
    defaultPromotionScopeBatchSize,
    effectiveCreateBatchItemCount,
    PROMOTION_SCOPE_BATCH_SIZE_OPTIONS,
    PROMOTION_SCOPE_NO_READY_MESSAGE,
    requiresLargeRoadBatchConfirmation,
    resolvePromotionScopeMaxItems,
    type PromotionScopeBatchSizeOption,
} from "@/src/features/import-review/promotion/promotionScopeBatchSize";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import { isDeprecatedCoreBusImportReviewFamily } from "@/src/features/import-review/utils/deprecatedCoreBusPromotion";
import { normalizePromotionEligibilityResponse } from "@/src/features/import-review/utils/normalizePromotionEligibilityResponse";
import {
    logCreatePublishBatchResponseDev,
    resolveCreatedPublishBatchId,
} from "@/src/features/import-review/utils/createPublishBatchResponse";
import { replaceImportReviewSearchParams } from "@/src/features/import-review/navigation/replaceImportReviewSearchParams";
import { importReviewPath } from "@/src/lib/dashboardNavigation";
import { importReviewHistoryHref } from "@/src/lib/importReviewEntityConfig";
import {
    getImportReviewPromotionEligibility,
    isAbortError,
    postImportReviewPromotionBatch,
    type ImportReviewPromotionEligibilityResponse,
} from "@/src/lib/api";
import {
    applyImportReviewScopeSearchParams,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
} from "@/src/lib/importReviewSnapshot";
import ImportReviewPromotionStaleBatchedReleasePanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionStaleBatchedReleasePanel";
import { ImportReviewPromotionFamilyChecklist } from "@/src/features/import-review/promotion";
import { useDashboardRoleAccess } from "@/src/hooks/useDashboardRoleAccess";

function defaultBatchName(reviewBatchId: string, families: string[]): string {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const familyTag = families.length === 1 ? families[0] : "multi";
    return `${familyTag}-publish-batch-${reviewBatchId}-${stamp}`;
}

export default function ImportReviewPromotionClient() {
    const dashboardAccess = useDashboardRoleAccess();
    const router = useRouter();
    const searchParams = useSearchParams();
    const urlVersion = snapshotVersionFromImportReviewSearch(searchParams);
    const urlBatch = reviewBatchIdFromImportReviewSearch(searchParams);
    const envDefault = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION?.trim() ?? "";

    const [scopeReviewBatchId, setScopeReviewBatchId] = useState(urlBatch);
    const activeReviewBatchId = scopeReviewBatchId.trim();

    const [changeBatchOpen, setChangeBatchOpen] = useState(false);
    const [batchDraft, setBatchDraft] = useState(urlBatch);
    const [snapshotDraft, setSnapshotDraft] = useState(urlVersion || envDefault);

    const [selectedFamilies, setSelectedFamilies] = useState<string[]>([]);
    const [batchSize, setBatchSize] = useState<PromotionScopeBatchSizeOption>(20);
    const [confirmLargeRoadBatch, setConfirmLargeRoadBatch] = useState(false);
    const [includeWarnings, setIncludeWarnings] = useState(false);
    const [batchName, setBatchName] = useState("");
    const [batchNote, setBatchNote] = useState("");

    const [eligibility, setEligibility] = useState<ImportReviewPromotionEligibilityResponse | null>(null);
    const [eligibilityLoading, setEligibilityLoading] = useState(false);
    const [eligibilityError, setEligibilityError] = useState("");
    const [eligibilityFetchNonce, setEligibilityFetchNonce] = useState(0);
    const eligibilityFetchGenerationRef = useRef(0);

    const [isCreating, setIsCreating] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");
    const [error, setError] = useState("");
    const [limitsConfirmation, setLimitsConfirmation] = useState<PublishBatchLimitsConfirmationState>({
        confirmLargeBatch: false,
        allowHighRiskFamilies: false,
        mixedHighRiskConfirm: false,
    });

    useEffect(() => {
        setScopeReviewBatchId(urlBatch);
    }, [urlBatch]);

    useEffect(() => {
        setBatchDraft(scopeReviewBatchId);
    }, [scopeReviewBatchId]);

    useEffect(() => {
        setSnapshotDraft(urlVersion || envDefault);
    }, [urlVersion, envDefault]);

    const selectedSet = useMemo(() => new Set(selectedFamilies), [selectedFamilies]);
    const selectedFamiliesKey = useMemo(
        () => [...selectedFamilies].sort().join(","),
        [selectedFamilies]
    );
    const hasRoads = selectedSet.has("roads");
    const needsLargeRoadConfirm = useMemo(
        () =>
            requiresLargeRoadBatchConfirmation({
                batchSize,
                selectedFamilies,
            }),
        [batchSize, selectedFamilies]
    );

    useEffect(() => {
        setBatchSize(defaultPromotionScopeBatchSize(selectedFamilies));
        setConfirmLargeRoadBatch(false);
    }, [selectedFamiliesKey]);

    const eligibilityRows = useMemo(
        () =>
            (eligibility?.families ?? [])
                .filter((row) => !isDeprecatedCoreBusImportReviewFamily(row.family))
                .map((row) => ({
                    family: row.family,
                    label: row.label,
                    target: row.target,
                    ready_now: row.ready_now,
                    retry_needed: row.retry_needed,
                    active_locked: row.active_locked,
                    stale_locked: row.stale_locked,
                    promoted: row.promoted,
                    counts_ok: row.counts_ok,
                    count_error: row.count_error
                        ? { code: row.count_error.code, message: row.count_error.message }
                        : null,
                })),
        [eligibility?.families]
    );

    const toggleFamily = useCallback((family: string, checked: boolean) => {
        setSelectedFamilies((prev) => {
            if (checked) {
                return prev.includes(family) ? prev : [...prev, family];
            }
            return prev.filter((f) => f !== family);
        });
        setSuccessMessage("");
        setEligibilityError("");
        setLimitsConfirmation({
            confirmLargeBatch: false,
            allowHighRiskFamilies: false,
            mixedHighRiskConfirm: false,
        });
    }, []);

    const loadEligibility = useCallback(
        async (signal?: AbortSignal) => {
            if (
                !activeReviewBatchId ||
                !shouldFetchPromotionScopeEligibility(selectedFamilies)
            ) {
                setEligibility(null);
                setEligibilityError("");
                setEligibilityLoading(false);
                return;
            }

            const fetchGeneration = ++eligibilityFetchGenerationRef.current;
            const families = buildCreatePublishBatchFamilies(
                selectedFamiliesKey.split(",").filter(Boolean)
            );

            setEligibilityLoading(true);
            setEligibilityError("");

            try {
                const raw = await getImportReviewPromotionEligibility(
                    {
                        review_batch_id: activeReviewBatchId,
                        families,
                        include_warnings: includeWarnings,
                    },
                    signal ? { signal } : undefined
                );
                if (fetchGeneration !== eligibilityFetchGenerationRef.current) {
                    return;
                }
                const res = normalizePromotionEligibilityResponse(raw);
                setEligibility(res);
                setBatchName((prev) =>
                    prev.trim() ? prev : defaultBatchName(String(res.review_batch_id), families)
                );
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                if (fetchGeneration !== eligibilityFetchGenerationRef.current) {
                    return;
                }
                setEligibility(null);
                setEligibilityError(formatImportReviewPromotionError(err));
            } finally {
                if (fetchGeneration === eligibilityFetchGenerationRef.current) {
                    setEligibilityLoading(false);
                }
            }
        },
        [activeReviewBatchId, selectedFamiliesKey, includeWarnings]
    );

    useEffect(() => {
        if (!shouldFetchPromotionScopeEligibility(selectedFamilies) || !activeReviewBatchId) {
            setEligibility(null);
            setEligibilityError("");
            setEligibilityLoading(false);
            return;
        }

        if (!shouldAutoRetryPromotionScopeEligibility(eligibilityError.length > 0)) {
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void loadEligibility(controller.signal);
        }, PROMOTION_SCOPE_ELIGIBILITY_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
            eligibilityFetchGenerationRef.current += 1;
        };
    }, [
        activeReviewBatchId,
        selectedFamiliesKey,
        includeWarnings,
        eligibilityFetchNonce,
        eligibilityError,
        loadEligibility,
        selectedFamilies.length,
    ]);

    const readyNowTotal = useMemo(
        () =>
            eligibilityRows.reduce((sum, row) => {
                if (!row.counts_ok) {
                    return sum;
                }
                return sum + row.ready_now;
            }, 0),
        [eligibilityRows]
    );

    const projectedItemCount = useMemo(
        () =>
            effectiveCreateBatchItemCount({
                batchSize,
                selectedFamilyCount: selectedFamilies.length,
                readyNowTotal,
            }),
        [batchSize, selectedFamilies.length, readyNowTotal]
    );

    const limitsEvaluation = useMemo(
        () =>
            evaluatePublishBatchLimits({
                families: selectedFamilies,
                totalItems: projectedItemCount,
                confirmation: limitsConfirmation,
            }),
        [selectedFamilies, projectedItemCount, limitsConfirmation]
    );

    const createBody = useMemo(() => {
        if (!activeReviewBatchId || selectedFamilies.length === 0) {
            return null;
        }
        const families = buildCreatePublishBatchFamilies(selectedFamilies);
        const maxItems = resolvePromotionScopeMaxItems(batchSize);
        return {
            review_batch_id: activeReviewBatchId,
            mode: "all_ready" as const,
            families,
            max_items: maxItems,
            filters: {
                review_decision: "approved" as const,
                include_warnings: includeWarnings,
            },
            include_warnings: includeWarnings,
            batch_name: batchName.trim() || defaultBatchName(activeReviewBatchId, families),
            note: batchNote.trim() || undefined,
            confirm_large_batch: limitsConfirmation.confirmLargeBatch,
            allow_high_risk_families: hasRoads || limitsConfirmation.allowHighRiskFamilies,
            mixed_high_risk_confirm: limitsConfirmation.mixedHighRiskConfirm,
        };
    }, [
        activeReviewBatchId,
        selectedFamilies,
        batchSize,
        hasRoads,
        includeWarnings,
        batchName,
        batchNote,
        limitsConfirmation,
    ]);

    const canCreateBatch =
        selectedFamilies.length > 0 &&
        Boolean(activeReviewBatchId) &&
        limitsEvaluation.canProceed &&
        (!needsLargeRoadConfirm || confirmLargeRoadBatch) &&
        readyNowTotal > 0 &&
        Boolean(eligibility?.can_create_batch);

    const createBatchButtonLabel = useMemo(
        () =>
            createPublishBatchButtonLabel({
                isCreating,
                creatingLabel: IMPORT_REVIEW_LOADING.loadingPromotionBatch,
                batchSize,
                selectedFamilyCount: selectedFamilies.length,
                readyNowTotal,
            }),
        [isCreating, batchSize, selectedFamilies.length, readyNowTotal]
    );

    async function handleCreateAllReady() {
        if (!createBody) {
            return;
        }
        setIsCreating(true);
        setError("");
        setSuccessMessage("");
        try {
            const result = await postImportReviewPromotionBatch({ ...createBody, dry_run: false });
            if ("dry_run" in result) {
                return;
            }
            const publishBatchId = resolveCreatedPublishBatchId(result);
            logCreatePublishBatchResponseDev(
                "createPublishBatch(all ready)",
                { ...createBody, dry_run: false },
                result,
                publishBatchId
            );
            if (!publishBatchId) {
                setError("Failed to create promotion batch.");
                return;
            }
            const itemsAdded =
                typeof result.items_added === "number"
                    ? result.items_added
                    : typeof result.total_selected === "number"
                      ? result.total_selected
                      : projectedItemCount;
            const familyLabel =
                selectedFamilies.length === 1 ? selectedFamilies[0] : "multi-family";
            setSuccessMessage(`Created ${familyLabel} batch with ${itemsAdded} item(s).`);
            const detailParams = new URLSearchParams();
            applyImportReviewScopeSearchParams(detailParams, "", activeReviewBatchId);
            const detailHref = `${importReviewPath("promotion")}/${publishBatchId}?${detailParams.toString()}`;
            router.push(detailHref);
        } catch (err) {
            setError(formatImportReviewPromotionError(err));
        } finally {
            setIsCreating(false);
        }
    }

    function applyReviewBatchId(batchId: string) {
        const id = batchId.trim();
        if (!id) {
            return;
        }
        setScopeReviewBatchId(id);
        setBatchDraft(id);
        setEligibility(null);
        setEligibilityError("");
        setEligibilityFetchNonce((n) => n + 1);
        replaceImportReviewSearchParams(
            router,
            importReviewPath("promotion"),
            searchParams,
            (params) => {
                applyImportReviewScopeSearchParams(params, "", id);
            },
            { source: "ImportReviewPromotionClient:apply_batch" }
        );
        setChangeBatchOpen(false);
        setSuccessMessage("");
    }

    function applySnapshotScope() {
        const snap = snapshotDraft.trim();
        if (!snap) {
            return;
        }
        replaceImportReviewSearchParams(
            router,
            importReviewPath("promotion"),
            searchParams,
            (params) => {
                applyImportReviewScopeSearchParams(params, snap, "");
            },
            { source: "ImportReviewPromotionClient:apply_snapshot" }
        );
    }

    function handleEligibilityRetry() {
        setEligibilityError("");
        setEligibilityFetchNonce((n) => n + 1);
    }

    if (dashboardAccess.ready && !dashboardAccess.canWrite) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-5xl">
                    <ImportReviewStatusBanner
                        message="Read-only demo — promotion actions are disabled. Use History to inspect prior publish batches."
                        tone="warning"
                    />
                </div>
            </main>
        );
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-5xl space-y-8">
                <header className="space-y-4 border-b border-gray-200 pb-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Promotion scope</h1>
                            <p className="mt-1 max-w-2xl text-sm text-gray-600">
                                Choose a review batch and entity families, then create a publish batch.
                                Validation, dry-run, and promotion run on the batch detail page.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Link
                                href={importReviewPath()}
                                prefetch={false}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                            >
                                Import review
                            </Link>
                            <Link
                                href={importReviewHistoryHref()}
                                prefetch={false}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                            >
                                History
                            </Link>
                        </div>
                    </div>
                </header>

                {successMessage ? (
                    <ImportReviewStatusBanner message={successMessage} tone="success" />
                ) : null}
                {error ? <ImportReviewStatusBanner message={error} tone="error" /> : null}

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="1. Review batch and families"
                            subtitle="Select one or more entity families to create a publish batch."
                        />
                        <p className="mt-2 text-sm text-gray-600">
                            Select one entity family to create a publish batch (you may select more than one).
                        </p>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <p className="text-sm text-gray-700">
                                <span className="font-medium text-gray-900">review_batch_id:</span>{" "}
                                <span className="font-mono">{activeReviewBatchId || "—"}</span>
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    setChangeBatchOpen((o) => !o);
                                    setBatchDraft(activeReviewBatchId);
                                }}
                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                            >
                                {changeBatchOpen ? "Cancel" : "Change batch"}
                            </button>
                        </div>
                        {changeBatchOpen ? (
                            <div className="mt-4 flex flex-wrap items-end gap-3">
                                <label className="block text-sm">
                                    <span className="font-medium text-gray-700">review_batch_id</span>
                                    <input
                                        type="text"
                                        value={batchDraft}
                                        onChange={(e) => setBatchDraft(e.target.value)}
                                        className="mt-1 w-full min-w-[12rem] rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm sm:w-64"
                                    />
                                </label>
                                <button
                                    type="button"
                                    disabled={!batchDraft.trim()}
                                    onClick={() => applyReviewBatchId(batchDraft)}
                                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                                >
                                    Apply
                                </button>
                            </div>
                        ) : null}

                        <label className="mt-4 flex items-center gap-2 text-sm text-gray-800">
                            <input
                                type="checkbox"
                                className="rounded border-gray-300"
                                checked={includeWarnings}
                                onChange={(e) => {
                                    setIncludeWarnings(e.target.checked);
                                    setEligibilityError("");
                                }}
                                disabled={!activeReviewBatchId || selectedFamilies.length === 0}
                            />
                            Include warning candidates when creating an all-ready batch
                        </label>

                        <details className="mt-4 text-sm">
                            <summary className="cursor-pointer font-medium text-gray-700">
                                Resolve batch from snapshot (optional)
                            </summary>
                            <div className="mt-2 flex flex-wrap items-end gap-3">
                                <input
                                    type="text"
                                    value={snapshotDraft}
                                    onChange={(e) => setSnapshotDraft(e.target.value)}
                                    placeholder={envDefault || "snapshot version"}
                                    className="min-w-[16rem] rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                                <button
                                    type="button"
                                    disabled={!snapshotDraft.trim()}
                                    onClick={() => applySnapshotScope()}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Load by snapshot
                                </button>
                            </div>
                        </details>

                        <div className="mt-6">
                            <ImportReviewPromotionFamilyChecklist
                                selected={selectedSet}
                                onToggle={toggleFamily}
                                disabled={!activeReviewBatchId}
                            />
                        </div>
                    </PromotionCardBody>
                </section>

                {!activeReviewBatchId ? (
                    <ImportReviewStatusBanner
                        message="Set a review batch id to choose families and load counts."
                        tone="info"
                    />
                ) : null}

                {activeReviewBatchId && selectedFamilies.length === 0 ? (
                    <ImportReviewStatusBanner
                        message="Select one entity family to create a publish batch."
                        tone="info"
                    />
                ) : null}

                {activeReviewBatchId ? (
                    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                        <PromotionCardBody>
                            <ImportReviewPromotionStaleBatchedReleasePanel
                                reviewBatchId={activeReviewBatchId}
                                defaultFamilies={
                                    selectedFamilies.length > 0 ? selectedFamilies : undefined
                                }
                                formatError={formatImportReviewPromotionError}
                                onReleased={() => setEligibilityFetchNonce((n) => n + 1)}
                            />
                        </PromotionCardBody>
                    </section>
                ) : null}

                {shouldFetchPromotionScopeEligibility(selectedFamilies) && activeReviewBatchId ? (
                    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                        <PromotionCardBody>
                            <PromotionSectionHeading
                                title="2. Scope counts"
                                subtitle="Truthful buckets for batch creation. Validation runs after you create a publish batch."
                            />
                            {eligibilityLoading && eligibilityRows.length === 0 ? (
                                <div className="mt-4">
                                    <ImportReviewLoadingBannerWithSpinner
                                        message={IMPORT_REVIEW_LOADING.loadingEligibility}
                                    />
                                </div>
                            ) : null}
                            <ImportReviewPromotionEligibilityPanel
                                reviewBatchId={activeReviewBatchId}
                                selectedFamilyCount={selectedFamilies.length}
                                isLoading={eligibilityLoading}
                                errorMessage={eligibilityError}
                                eligibility={eligibility}
                                rows={eligibilityRows}
                                onRetry={handleEligibilityRetry}
                            />
                        </PromotionCardBody>
                    </section>
                ) : null}

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="3. Create publish batch"
                            subtitle="Pick a batch size (recommended for roads), then create. Validate and promote on the batch page."
                        />
                        <div className="mt-4">
                            <p className="text-sm font-medium text-gray-800">Batch size (per family)</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {PROMOTION_SCOPE_BATCH_SIZE_OPTIONS.map((size) => (
                                    <label
                                        key={size}
                                        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm has-[:checked]:border-emerald-600 has-[:checked]:ring-1 has-[:checked]:ring-emerald-600"
                                    >
                                        <input
                                            type="radio"
                                            name="promotion_batch_size"
                                            checked={batchSize === size}
                                            onChange={() => {
                                                setBatchSize(size);
                                                setConfirmLargeRoadBatch(false);
                                            }}
                                            disabled={selectedFamilies.length === 0}
                                        />
                                        {size}
                                    </label>
                                ))}
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm has-[:checked]:border-emerald-600 has-[:checked]:ring-1 has-[:checked]:ring-emerald-600">
                                    <input
                                        type="radio"
                                        name="promotion_batch_size"
                                        checked={batchSize === "all"}
                                        onChange={() => setBatchSize("all")}
                                        disabled={selectedFamilies.length === 0}
                                    />
                                    All eligible
                                </label>
                            </div>
                            {hasRoads && batchSize !== "all" ? (
                                <p className="mt-2 text-xs text-gray-600">
                                    Roads use approved + promotion_status not_ready (up to {batchSize} per
                                    family).
                                </p>
                            ) : null}
                            {needsLargeRoadConfirm ? (
                                <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
                                    <input
                                        type="checkbox"
                                        className="mt-0.5 rounded border-gray-300"
                                        checked={confirmLargeRoadBatch}
                                        onChange={(e) => setConfirmLargeRoadBatch(e.target.checked)}
                                    />
                                    <span>I understand this is a large road batch.</span>
                                </label>
                            ) : null}
                        </div>
                        <div className="mt-4 space-y-4">
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Batch name</span>
                                <input
                                    type="text"
                                    value={batchName}
                                    onChange={(e) => setBatchName(e.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                                    disabled={!activeReviewBatchId || selectedFamilies.length === 0}
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Note</span>
                                <span className="ml-1 text-xs text-gray-500">(optional)</span>
                                <textarea
                                    value={batchNote}
                                    onChange={(e) => setBatchNote(e.target.value)}
                                    rows={2}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                                    disabled={!activeReviewBatchId || selectedFamilies.length === 0}
                                />
                            </label>
                        </div>
                        {activeReviewBatchId && selectedFamilies.length > 0 ? (
                            <ImportReviewPromotionBatchLimitsConfirm
                                evaluation={limitsEvaluation}
                                confirmation={limitsConfirmation}
                                onConfirmationChange={setLimitsConfirmation}
                                actionLabel="Create this publish batch"
                            />
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => void handleCreateAllReady()}
                                disabled={!canCreateBatch || isCreating}
                                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                                {createBatchButtonLabel}
                            </button>
                        </div>
                        {!canCreateBatch &&
                        activeReviewBatchId &&
                        selectedFamilies.length > 0 &&
                        !eligibilityLoading &&
                        !eligibilityError &&
                        readyNowTotal === 0 ? (
                            <p className="mt-3 text-sm text-amber-800">{PROMOTION_SCOPE_NO_READY_MESSAGE}</p>
                        ) : null}
                    </PromotionCardBody>
                </section>
            </div>
        </main>
    );
}
