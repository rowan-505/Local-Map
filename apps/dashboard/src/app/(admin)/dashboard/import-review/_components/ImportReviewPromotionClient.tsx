"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ImportReviewBatchPicker from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewBatchPicker";
import ImportReviewPromotionEligibilityPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionEligibilityPanel";
import {
    PromotionCardBody,
    PromotionSectionHeading,
    PromotionStatusBadge,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import ImportReviewPromotionEligibilityDetailsDrawer from "@/src/features/import-review/components/ImportReviewPromotionEligibilityDetailsDrawer";
import {
    formatImportReviewPromotionError,
    ImportReviewPromotionDryRunNotice,
    ImportReviewPromotionFamilyChecklist,
    ImportReviewPromotionStepBar,
} from "@/src/features/import-review/promotion";
import ImportReviewPromotionBatchLimitsConfirm from "@/src/features/import-review/promotion/ImportReviewPromotionBatchLimitsConfirm";
import {
    estimateAllReadyBatchItemCount,
    evaluatePublishBatchLimits,
    type PublishBatchLimitsConfirmationState,
} from "@/src/features/import-review/promotion/batchLimits";
import { importReviewPromotionEntityHref } from "@/src/features/import-review/promotion/promotionEntityUrl";
import { IMPORT_REVIEW_PROMOTION_FAMILY_META } from "@/src/features/import-review/config/importReviewPromotionFamilies";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import { logImportReviewEligibilityFetch } from "@/src/features/import-review/utils/importReviewRequestDebug";
import { IMPORT_REVIEW_PROMOTION_COMPLETED_EVENT } from "@/src/features/import-review/hooks/invalidateImportReviewAfterPromotion";
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
    getImportReviewPromotionBatches,
    getImportReviewPromotionEligibility,
    isAbortError,
    isImportReviewBatchAmbiguousError,
    postImportReviewPromotionBatch,
    type ImportReviewBatchChoice,
    type ImportReviewCreatePublishBatchDryRunResult,
    type ImportReviewPromotionEligibilityBucket,
    type ImportReviewPromotionEligibilityResponse,
    type ImportReviewPublishBatchSummary,
} from "@/src/lib/api";
import {
    applyImportReviewScopeSearchParams,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
} from "@/src/lib/importReviewSnapshot";

const DEFAULT_FAMILIES = IMPORT_REVIEW_PROMOTION_FAMILY_META.map((row) => row.family);

type BatchCreateMode = "all_ready" | "selected";

type EligibilityDetailsSelection = {
    family: string;
    label: string;
    bucket: ImportReviewPromotionEligibilityBucket;
};

function defaultBatchName(reviewBatchId: string, families: string[]): string {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const familyTag = families.length === 1 ? families[0] : "multi";
    return `${familyTag}-publish-batch-${reviewBatchId}-${stamp}`;
}

function sumEligibilityCounts(
    rows: ImportReviewPromotionEligibilityResponse["families"] | undefined,
    key: "ready" | "warnings" | "blocked"
): number {
    if (!rows?.length) {
        return 0;
    }
    return rows.reduce((sum, row) => {
        if (isDeprecatedCoreBusImportReviewFamily(row.family)) {
            return sum;
        }
        return sum + (row[key] ?? 0);
    }, 0);
}

export default function ImportReviewPromotionClient() {
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

    const [selectedFamilies, setSelectedFamilies] = useState<string[]>([...DEFAULT_FAMILIES]);
    const [batchMode, setBatchMode] = useState<BatchCreateMode>("all_ready");
    const [includeWarnings, setIncludeWarnings] = useState(false);
    const [batchName, setBatchName] = useState("");
    const [batchNote, setBatchNote] = useState("");

    const [eligibility, setEligibility] = useState<ImportReviewPromotionEligibilityResponse | null>(null);
    const [eligibilityLoading, setEligibilityLoading] = useState(false);
    const [eligibilityError, setEligibilityError] = useState("");
    const [eligibilityDetailsSelection, setEligibilityDetailsSelection] =
        useState<EligibilityDetailsSelection | null>(null);
    const [promotionRefreshToken, setPromotionRefreshToken] = useState(0);
    const [eligibilityFetchNonce, setEligibilityFetchNonce] = useState(0);
    const eligibilityFetchGenerationRef = useRef(0);

    const [batches, setBatches] = useState<ImportReviewPublishBatchSummary[]>([]);
    const [batchesTotal, setBatchesTotal] = useState(0);
    const [batchesLoading, setBatchesLoading] = useState(false);

    const [dryRunResult, setDryRunResult] = useState<ImportReviewCreatePublishBatchDryRunResult | null>(null);
    const [isDryRunning, setIsDryRunning] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");

    const [error, setError] = useState("");
    const [limitsConfirmation, setLimitsConfirmation] = useState<PublishBatchLimitsConfirmationState>({
        confirmLargeBatch: false,
        allowHighRiskFamilies: false,
        mixedHighRiskConfirm: false,
    });
    const [ambiguousBatches, setAmbiguousBatches] = useState<ImportReviewBatchChoice[] | null>(null);
    const [ambiguousSnapshot, setAmbiguousSnapshot] = useState("");

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
    const hasRoutingBarriers = selectedSet.has("routing_barriers");

    const toggleFamily = useCallback((family: string, checked: boolean) => {
        setSelectedFamilies((prev) => {
            if (checked) {
                return prev.includes(family) ? prev : [...prev, family];
            }
            return prev.filter((f) => f !== family);
        });
        setDryRunResult(null);
        setSuccessMessage("");
        setLimitsConfirmation({
            confirmLargeBatch: false,
            allowHighRiskFamilies: false,
            mixedHighRiskConfirm: false,
        });
    }, []);

    const eligibilityRows = useMemo(
        () =>
            (eligibility?.families ?? [])
                .filter((row) => !isDeprecatedCoreBusImportReviewFamily(row.family))
                .map((row) => ({
                    family: row.family,
                    label: row.label,
                    target: row.target,
                    ready: row.ready,
                    warnings: row.warnings,
                    blocked: row.blocked,
                    batched: row.batched,
                    promoted: row.promoted,
                })),
        [eligibility?.families]
    );

    const readyTotal = sumEligibilityCounts(eligibility?.families, "ready");
    const warningTotal = sumEligibilityCounts(eligibility?.families, "warnings");
    const blockedTotal = sumEligibilityCounts(eligibility?.families, "blocked");

    const loadBatches = useCallback(
        async (reviewBatchId: string, signal?: AbortSignal) => {
            if (!reviewBatchId.trim()) {
                setBatches([]);
                setBatchesTotal(0);
                return;
            }
            setBatchesLoading(true);
            try {
                const listRes = await getImportReviewPromotionBatches(
                    { review_batch_id: reviewBatchId, limit: 50, offset: 0 },
                    signal ? { signal } : undefined
                );
                setBatches(listRes.items);
                setBatchesTotal(listRes.total);
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                if (isImportReviewBatchAmbiguousError(err)) {
                    setAmbiguousBatches(err.batches);
                    setAmbiguousSnapshot(err.sourceSnapshotVersion || snapshotDraft);
                    return;
                }
                setAmbiguousBatches(null);
                throw err;
            } finally {
                setBatchesLoading(false);
            }
        },
        [snapshotDraft]
    );

    useEffect(() => {
        if (!activeReviewBatchId) {
            setBatches([]);
            setBatchesTotal(0);
            return;
        }
        const controller = new AbortController();
        setError("");
        void loadBatches(activeReviewBatchId, controller.signal).catch((err) => {
            if (!isAbortError(err)) {
                setError(formatImportReviewPromotionError(err));
            }
        });
        return () => controller.abort();
    }, [activeReviewBatchId, loadBatches, promotionRefreshToken]);

    useEffect(() => {
        const onPromotionCompleted = () => setPromotionRefreshToken((t) => t + 1);
        window.addEventListener(IMPORT_REVIEW_PROMOTION_COMPLETED_EVENT, onPromotionCompleted);
        return () => window.removeEventListener(IMPORT_REVIEW_PROMOTION_COMPLETED_EVENT, onPromotionCompleted);
    }, []);

    const loadEligibility = useCallback(async () => {
        if (!activeReviewBatchId || selectedFamilies.length === 0) {
            setEligibility(null);
            setEligibilityError("");
            setEligibilityLoading(false);
            return;
        }

        const fetchGeneration = ++eligibilityFetchGenerationRef.current;
        const families = selectedFamiliesKey.split(",").filter(Boolean);

        setEligibilityLoading(true);
        setEligibilityError("");

        logImportReviewEligibilityFetch({
            phase: "start",
            review_batch_id: activeReviewBatchId,
            families: families.join(","),
            include_warnings: includeWarnings,
        });

        try {
            const raw = await getImportReviewPromotionEligibility({
                review_batch_id: activeReviewBatchId,
                families,
                include_warnings: includeWarnings,
            });
            if (fetchGeneration !== eligibilityFetchGenerationRef.current) {
                return;
            }
            const res = normalizePromotionEligibilityResponse(raw);
            setEligibility(res);
            setBatchName((prev) =>
                prev.trim() ? prev : defaultBatchName(String(res.review_batch_id), families)
            );
        } catch (err) {
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
    }, [activeReviewBatchId, selectedFamilies.length, selectedFamiliesKey, includeWarnings]);

    useEffect(() => {
        void loadEligibility();
        return () => {
            eligibilityFetchGenerationRef.current += 1;
        };
    }, [loadEligibility, promotionRefreshToken, eligibilityFetchNonce]);

    const projectedItemCount = useMemo(() => {
        if (dryRunResult?.totals?.included !== undefined) {
            return dryRunResult.totals.included;
        }
        return estimateAllReadyBatchItemCount({
            families: selectedFamilies,
            eligibilityRows: eligibility?.families ?? [],
            includeWarnings,
        });
    }, [dryRunResult, selectedFamilies, eligibility?.families, includeWarnings]);

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
        return {
            review_batch_id: activeReviewBatchId,
            mode: batchMode,
            families: selectedFamilies,
            filters: {
                review_decision: "approved",
                include_warnings: includeWarnings,
            },
            include_warnings: includeWarnings,
            batch_name: batchName.trim() || defaultBatchName(activeReviewBatchId, selectedFamilies),
            note: batchNote.trim() || undefined,
            confirm_large_batch: limitsConfirmation.confirmLargeBatch,
            allow_high_risk_families: limitsConfirmation.allowHighRiskFamilies,
            mixed_high_risk_confirm: limitsConfirmation.mixedHighRiskConfirm,
        };
    }, [
        activeReviewBatchId,
        selectedFamilies,
        batchMode,
        includeWarnings,
        batchName,
        batchNote,
        limitsConfirmation,
    ]);

    const canCreateBatch =
        Boolean(eligibility?.can_create_batch) &&
        selectedFamilies.length > 0 &&
        Boolean(activeReviewBatchId) &&
        batchMode === "all_ready" &&
        limitsEvaluation.canProceed;

    async function handleDryRun() {
        if (!createBody) {
            return;
        }
        setIsDryRunning(true);
        setDryRunResult(null);
        setError("");
        setSuccessMessage("");
        try {
            const result = await postImportReviewPromotionBatch({ ...createBody, dry_run: true });
            if ("dry_run" in result && result.dry_run) {
                setDryRunResult(result);
                setSuccessMessage("Dry-run completed. No publish batch was created.");
            }
        } catch (err) {
            setError(formatImportReviewPromotionError(err));
        } finally {
            setIsDryRunning(false);
        }
    }

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
            setSuccessMessage(
                `Publish batch #${publishBatchId} created with ${result.items_added ?? result.total_selected ?? "—"} item(s). Continue with Validate → Promote → Verify.`
            );
            void loadBatches(activeReviewBatchId);
            const detailQuery = searchParams.toString();
            const detailHref = `${importReviewPath("promotion")}/${publishBatchId}${detailQuery ? `?${detailQuery}` : ""}`;
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
        setDryRunResult(null);
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

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-8">
                <header className="space-y-4 border-b border-gray-200 pb-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Promotion</h1>
                            <p className="mt-1 max-w-2xl text-sm text-gray-600">
                                Select scope, review typed-column readiness, validate the publish batch, promote to
                                core or routing tables, then verify results.
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
                    <ImportReviewPromotionStepBar activeStep="scope" />
                </header>

                {successMessage ? (
                    <ImportReviewStatusBanner message={successMessage} tone="success" />
                ) : null}
                {error ? <ImportReviewStatusBanner message={error} tone="error" /> : null}

                {ambiguousBatches && ambiguousBatches.length > 0 ? (
                    <>
                        <ImportReviewStatusBanner
                            message={IMPORT_REVIEW_LOADING.multipleBatchesFound}
                            tone="warning"
                        />
                        <ImportReviewBatchPicker
                            sourceSnapshotVersion={ambiguousSnapshot}
                            batches={ambiguousBatches}
                            onSelectBatch={(id) => applyReviewBatchId(id)}
                            onUseLatest={() => {
                                const latest = ambiguousBatches[0];
                                if (latest?.id) {
                                    applyReviewBatchId(String(latest.id));
                                }
                            }}
                        />
                    </>
                ) : null}

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="1. Scope"
                            subtitle="Choose the import review batch and entity families for this promotion run."
                        />
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

                        <div className="mt-4 rounded-md border border-gray-100 bg-gray-50/80 px-3 py-3">
                            <p className="text-sm font-medium text-gray-800">Batch mode</p>
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-6">
                                <label className="flex items-center gap-2 text-sm text-gray-800">
                                    <input
                                        type="radio"
                                        name="batch_mode"
                                        checked={batchMode === "all_ready"}
                                        onChange={() => setBatchMode("all_ready")}
                                        disabled={!activeReviewBatchId}
                                    />
                                    All ready — include approved candidates in selected families
                                </label>
                                <label className="flex items-center gap-2 text-sm text-gray-500">
                                    <input
                                        type="radio"
                                        name="batch_mode"
                                        checked={batchMode === "selected"}
                                        onChange={() => setBatchMode("selected")}
                                        disabled
                                    />
                                    Selected IDs — pick rows on entity pages first (not wired here yet)
                                </label>
                            </div>
                            <label className="mt-3 flex items-center gap-2 text-sm text-gray-800">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-300"
                                    checked={includeWarnings}
                                    onChange={(e) => setIncludeWarnings(e.target.checked)}
                                    disabled={!activeReviewBatchId}
                                />
                                Include warning candidates when creating an all-ready batch
                            </label>
                        </div>

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

                        <ImportReviewPromotionDryRunNotice
                            hasRoads={hasRoads}
                            hasRoutingBarriers={hasRoutingBarriers}
                            className="mt-4"
                        />
                    </PromotionCardBody>
                </section>

                {!activeReviewBatchId ? (
                    <ImportReviewStatusBanner
                        message="Set a review batch id to see candidate counts and create a publish batch."
                        tone="info"
                    />
                ) : null}

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="2. Candidate selection"
                            subtitle="Ready counts per family in this review batch. Open entity pages to review typed fields before promoting."
                        />
                        {eligibilityLoading && eligibilityRows.length === 0 ? (
                            <div className="mt-4">
                                <ImportReviewLoadingBannerWithSpinner
                                    message={IMPORT_REVIEW_LOADING.loadingEligibility}
                                />
                            </div>
                        ) : eligibilityRows.length === 0 ? (
                            <p className="mt-4 text-sm text-gray-600">
                                Select families in scope to load counts.
                            </p>
                        ) : (
                            <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                                <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                                    <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        <tr>
                                            <th className="px-4 py-3">Family</th>
                                            <th className="px-4 py-3 text-right">Ready</th>
                                            <th className="px-4 py-3">Entity page</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 bg-white">
                                        {eligibilityRows.map((row) => {
                                            const href = importReviewPromotionEntityHref(
                                                row.family,
                                                activeReviewBatchId
                                            );
                                            return (
                                                <tr key={row.family}>
                                                    <td className="px-4 py-3 font-medium text-gray-900">
                                                        {row.label}
                                                    </td>
                                                    <td className="px-4 py-3 text-right tabular-nums text-emerald-800">
                                                        {row.ready.toLocaleString()}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {href ? (
                                                            <Link
                                                                href={href}
                                                                prefetch={false}
                                                                className="font-medium text-emerald-800 hover:underline"
                                                            >
                                                                Open {row.label.toLowerCase()}
                                                            </Link>
                                                        ) : (
                                                            <span className="text-gray-400">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </PromotionCardBody>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="3. Validation result"
                            subtitle="Pre-batch eligibility. After you create a publish batch, run batch validation on the batch page."
                        />
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                                <p className="text-xs font-semibold uppercase text-emerald-800">Ready</p>
                                <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-950">
                                    {readyTotal.toLocaleString()}
                                </p>
                            </div>
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                                <p className="text-xs font-semibold uppercase text-amber-800">Warnings</p>
                                <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-950">
                                    {warningTotal.toLocaleString()}
                                </p>
                                <p className="mt-1 text-xs text-amber-900">
                                    Promote requires a confirmation note when warnings remain on the batch.
                                </p>
                            </div>
                            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                                <p className="text-xs font-semibold uppercase text-red-800">Blocked</p>
                                <p className="mt-1 text-2xl font-semibold tabular-nums text-red-950">
                                    {blockedTotal.toLocaleString()}
                                </p>
                                <p className="mt-1 text-xs text-red-900">Blocked items cannot be promoted.</p>
                            </div>
                        </div>
                        <ImportReviewPromotionEligibilityPanel
                            reviewBatchId={activeReviewBatchId}
                            selectedFamilyCount={selectedFamilies.length}
                            isLoading={eligibilityLoading}
                            errorMessage={eligibilityError}
                            eligibility={eligibility}
                            rows={eligibilityRows}
                            onRetry={() => setEligibilityFetchNonce((n) => n + 1)}
                            onOpenDetails={(family, label, bucket) =>
                                setEligibilityDetailsSelection({ family, label, bucket })
                            }
                        />
                    </PromotionCardBody>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="4. Promotion action"
                            subtitle="Create a publish batch, then validate and promote on the batch page."
                        />
                        <div className="mt-4 space-y-4">
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Batch name</span>
                                <input
                                    type="text"
                                    value={batchName}
                                    onChange={(e) => setBatchName(e.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                                    disabled={!activeReviewBatchId}
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Note</span>
                                <span className="ml-1 text-xs text-gray-500">(optional, stored on batch)</span>
                                <textarea
                                    value={batchNote}
                                    onChange={(e) => setBatchNote(e.target.value)}
                                    rows={2}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                                    disabled={!activeReviewBatchId}
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
                                disabled={!canCreateBatch || isCreating || isDryRunning}
                                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                                {isCreating
                                    ? IMPORT_REVIEW_LOADING.loadingPromotionBatch
                                    : "Create publish batch (all ready)"}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleDryRun()}
                                disabled={
                                    !createBody ||
                                    isDryRunning ||
                                    isCreating ||
                                    limitsEvaluation.missingConfirmations.some(
                                        (key) => key !== "confirm_large_batch"
                                    )
                                }
                                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                            >
                                {isDryRunning ? "Previewing…" : "Preview batch (dry-run)"}
                            </button>
                        </div>
                        {!canCreateBatch && activeReviewBatchId && selectedFamilies.length > 0 && !eligibilityLoading ? (
                            <p className="mt-3 text-sm text-amber-800">
                                Cannot create batch yet — resolve blocked items or adjust family selection.
                            </p>
                        ) : null}
                        {dryRunResult ? (
                            <p className="mt-3 text-sm text-blue-900">
                                Preview: {dryRunResult.totals.included.toLocaleString()} would be included,{" "}
                                {dryRunResult.totals.skipped.toLocaleString()} skipped.
                            </p>
                        ) : null}
                        {batches.length > 0 ? (
                            <div className="mt-6 border-t border-gray-100 pt-4">
                                <p className="text-sm font-medium text-gray-900">Continue on an existing batch</p>
                                <ul className="mt-2 space-y-2">
                                    {batches.slice(0, 5).map((b) => (
                                        <li key={b.id} className="flex flex-wrap items-center gap-2 text-sm">
                                            <span className="font-mono text-xs text-gray-600">#{b.id}</span>
                                            <span className="font-medium text-gray-900">{b.batch_name}</span>
                                            <PromotionStatusBadge value={b.derived_status ?? b.status} />
                                            <Link
                                                href={`${importReviewPath("promotion")}/${b.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}
                                                prefetch={false}
                                                className="font-medium text-emerald-800 hover:underline"
                                            >
                                                Validate → Promote → Verify
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </PromotionCardBody>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="5. History"
                            subtitle="Audit past review and publish batches."
                        />
                        <Link
                            href={importReviewHistoryHref()}
                            prefetch={false}
                            className="mt-3 inline-flex rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                        >
                            Open promotion history
                        </Link>
                    </PromotionCardBody>
                </section>
            </div>

            <ImportReviewPromotionEligibilityDetailsDrawer
                open={eligibilityDetailsSelection !== null}
                onClose={() => setEligibilityDetailsSelection(null)}
                reviewBatchId={activeReviewBatchId}
                family={eligibilityDetailsSelection?.family ?? ""}
                familyLabel={eligibilityDetailsSelection?.label ?? ""}
                bucket={eligibilityDetailsSelection?.bucket ?? "ready"}
                includeWarnings={includeWarnings}
                formatError={formatImportReviewPromotionError}
            />
        </main>
    );
}
