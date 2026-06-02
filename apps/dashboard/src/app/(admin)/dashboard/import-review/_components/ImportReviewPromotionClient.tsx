"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ImportReviewBatchPicker from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewBatchPicker";
import {
    PromotionCardBody,
    PromotionSectionHeading,
    PromotionStatusBadge,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import ImportReviewPromotionEligibilityDetailsDrawer from "@/src/features/import-review/components/ImportReviewPromotionEligibilityDetailsDrawer";
import ImportReviewTransportMovedNotice from "@/src/features/import-review/components/ImportReviewTransportMovedNotice";
import {
    HIGH_RISK_IMPORT_REVIEW_PROMOTION_FAMILY_META,
    NORMAL_IMPORT_REVIEW_PROMOTION_FAMILY_META,
} from "@/src/features/import-review/config/importReviewPromotionFamilies";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    logImportReviewRouterCall,
    logImportReviewUserAction,
} from "@/src/features/import-review/utils/importReviewRequestDebug";
import { IMPORT_REVIEW_PROMOTION_COMPLETED_EVENT } from "@/src/features/import-review/hooks/invalidateImportReviewAfterPromotion";
import { isDeprecatedCoreBusImportReviewFamily } from "@/src/features/import-review/utils/deprecatedCoreBusPromotion";
import { replaceImportReviewSearchParams } from "@/src/features/import-review/navigation/replaceImportReviewSearchParams";
import { normalizePromotionEligibilityResponse } from "@/src/features/import-review/utils/normalizePromotionEligibilityResponse";
import { logImportReviewEligibilityFetch } from "@/src/features/import-review/utils/importReviewRequestDebug";
import { importReviewPath } from "@/src/lib/dashboardNavigation";
import {
    getImportReviewPromotionBatches,
    getImportReviewPromotionEligibility,
    isAbortError,
    isImportReviewBatchAmbiguousError,
    postImportReviewPromotionBatch,
    type ImportReviewBatchChoice,
    type ImportReviewCreatePublishBatchDryRunResult,
    type ImportReviewCreatePublishBatchResult,
    type ImportReviewPromotionEligibilityBucket,
    type ImportReviewPromotionEligibilityResponse,
    type ImportReviewPublishBatchSummary,
} from "@/src/lib/api";
import ImportReviewPromotionEligibilityPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionEligibilityPanel";
import { isImportReviewDevTokenConfigured } from "@/src/lib/importReviewDevAccess";
import {
    applyImportReviewScopeSearchParams,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
} from "@/src/lib/importReviewSnapshot";

const DEFAULT_SELECTED_FAMILIES = NORMAL_IMPORT_REVIEW_PROMOTION_FAMILY_META.map((row) => row.family);

type EligibilityDetailsSelection = {
    family: string;
    label: string;
    bucket: ImportReviewPromotionEligibilityBucket;
};

function formatPromotionError(err: unknown): string {
    if (!(err instanceof Error)) {
        return "Request failed.";
    }
    const m = err.message;
    if (m.includes("401") || m.toLowerCase().includes("authentication")) {
        if (isImportReviewDevTokenConfigured()) {
            return "Unauthorized — check NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN matches the API IMPORT_REVIEW_ADMIN_TOKEN.";
        }
        return "Unauthorized — sign in as an admin or configure the dev admin token.";
    }
    if (m.includes("403") || m.toLowerCase().includes("forbidden")) {
        return "Forbidden — import review requires admin access.";
    }
    return m;
}

function defaultBatchName(reviewBatchId: string, families: string[]): string {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const familyTag = families.length === 1 ? families[0] : "multi";
    return `${familyTag}-publish-batch-${reviewBatchId}-${stamp}`;
}

function DryRunResultPanel({ result }: { result: ImportReviewCreatePublishBatchDryRunResult }) {
    const rows = result.families?.length ? result.families : [];
    return (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950" role="status">
            <div className="font-semibold">Dry-run preview</div>
            <dl className="mt-2 space-y-1">
                <div className="flex justify-between gap-4">
                    <dt>Would include</dt>
                    <dd className="tabular-nums font-medium">{result.totals.included.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt>Would skip</dt>
                    <dd className="tabular-nums font-medium">{result.totals.skipped.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt>Excluded</dt>
                    <dd className="tabular-nums font-medium">{result.totals.excluded.toLocaleString()}</dd>
                </div>
            </dl>
            {rows.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-xs opacity-90">
                    {rows.map((row) => (
                        <li key={row.family}>
                            {row.label}: {row.included.toLocaleString()} included
                        </li>
                    ))}
                </ul>
            ) : null}
            {result.messages.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-xs opacity-90">
                    {result.messages.map((msg) => (
                        <li key={msg}>{msg}</li>
                    ))}
                </ul>
            ) : null}
            <p className="mt-2 text-xs opacity-90">{result.message}</p>
        </div>
    );
}

function FamilyCheckboxGroup({
    title,
    families,
    selected,
    onToggle,
    disabled,
}: {
    title: string;
    families: readonly { family: string; label: string }[];
    selected: Set<string>;
    onToggle: (family: string, checked: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <fieldset className="space-y-2" disabled={disabled}>
            <legend className="text-sm font-medium text-gray-900">{title}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
                {families.map((row) => (
                    <label key={row.family} className="flex items-center gap-2 text-sm text-gray-800">
                        <input
                            type="checkbox"
                            className="rounded border-gray-300"
                            checked={selected.has(row.family)}
                            onChange={(e) => onToggle(row.family, e.target.checked)}
                        />
                        {row.label}
                    </label>
                ))}
            </div>
        </fieldset>
    );
}

export default function ImportReviewPromotionClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const urlVersion = snapshotVersionFromImportReviewSearch(searchParams);
    const urlBatch = reviewBatchIdFromImportReviewSearch(searchParams);
    const envDefault = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION?.trim() ?? "";

    /** Active scope for API queries (synced from URL; Apply updates both). */
    const [scopeReviewBatchId, setScopeReviewBatchId] = useState(urlBatch);
    const activeReviewBatchId = scopeReviewBatchId.trim();

    const [changeBatchOpen, setChangeBatchOpen] = useState(false);
    const [batchDraft, setBatchDraft] = useState(urlBatch);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [snapshotDraft, setSnapshotDraft] = useState(urlVersion || envDefault);

    const [selectedFamilies, setSelectedFamilies] = useState<string[]>([...DEFAULT_SELECTED_FAMILIES]);
    const [includeWarnings, setIncludeWarnings] = useState(false);
    const [reviewNote, setReviewNote] = useState("");
    const [batchName, setBatchName] = useState("");

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

    const [error, setError] = useState("");
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

    const hasHighRiskSelected = useMemo(
        () => selectedFamilies.some((f) => HIGH_RISK_IMPORT_REVIEW_PROMOTION_FAMILY_META.some((m) => m.family === f)),
        [selectedFamilies]
    );

    const routingBarriersSelected = selectedSet.has("routing_barriers");

    const toggleFamily = useCallback((family: string, checked: boolean) => {
        setSelectedFamilies((prev) => {
            if (checked) {
                return prev.includes(family) ? prev : [...prev, family];
            }
            return prev.filter((f) => f !== family);
        });
        setDryRunResult(null);
    }, []);

    const openEligibilityDetails = useCallback(
        (family: string, label: string, bucket: ImportReviewPromotionEligibilityBucket) => {
            setEligibilityDetailsSelection({ family, label, bucket });
        },
        []
    );

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
                setError(formatPromotionError(err));
            }
        });
        return () => controller.abort();
    }, [activeReviewBatchId, loadBatches, promotionRefreshToken]);

    useEffect(() => {
        const onPromotionCompleted = () => {
            setPromotionRefreshToken((t) => t + 1);
        };
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
            logImportReviewEligibilityFetch({
                phase: "success",
                review_batch_id: activeReviewBatchId,
                families: families.join(","),
                row_count: res.families.length,
            });
        } catch (err) {
            if (fetchGeneration !== eligibilityFetchGenerationRef.current) {
                return;
            }
            setEligibility(null);
            setEligibilityError(formatPromotionError(err));
            logImportReviewEligibilityFetch({
                phase: "error",
                review_batch_id: activeReviewBatchId,
                families: families.join(","),
                message: err instanceof Error ? err.message : "unknown",
            });
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

    const createBody = useMemo(() => {
        if (!activeReviewBatchId || selectedFamilies.length === 0) {
            return null;
        }
        return {
            review_batch_id: activeReviewBatchId,
            families: selectedFamilies,
            include_warnings: includeWarnings,
            batch_name: batchName.trim() || defaultBatchName(activeReviewBatchId, selectedFamilies),
            note: reviewNote.trim() || undefined,
        };
    }, [activeReviewBatchId, selectedFamilies, includeWarnings, batchName, reviewNote]);

    const canCreate =
        Boolean(eligibility?.can_create_batch) &&
        selectedFamilies.length > 0 &&
        Boolean(activeReviewBatchId);

    async function handleDryRun() {
        if (!createBody) {
            return;
        }
        setIsDryRunning(true);
        setDryRunResult(null);
        setError("");
        try {
            const result = await postImportReviewPromotionBatch({ ...createBody, dry_run: true });
            if ("dry_run" in result && result.dry_run) {
                setDryRunResult(result);
            }
        } catch (err) {
            setError(formatPromotionError(err));
        } finally {
            setIsDryRunning(false);
        }
    }

    async function handleCreate() {
        if (!createBody) {
            return;
        }
        setIsCreating(true);
        setError("");
        try {
            const result = await postImportReviewPromotionBatch({ ...createBody, dry_run: false });
            if ("dry_run" in result) {
                return;
            }
            const publishBatchId = result.publish_batch_id || result.batch_id || result.batch?.id;
            if (!publishBatchId) {
                setError("Batch created but no publish batch id was returned.");
                return;
            }
            void loadBatches(activeReviewBatchId);
            const detailQuery = searchParams.toString();
            const detailHref = `${importReviewPath("promotion")}/${publishBatchId}${detailQuery ? `?${detailQuery}` : ""}`;
            logImportReviewRouterCall({
                method: "push",
                source: "ImportReviewPromotionClient:create_batch",
                pathname: importReviewPath("promotion"),
                from_query: searchParams.toString(),
                to_href: detailHref,
            });
            router.push(detailHref);
        } catch (err) {
            setError(formatPromotionError(err));
        } finally {
            setIsCreating(false);
        }
    }

    function applyReviewBatchId(batchId: string, source: "change_batch" | "apply_draft" = "change_batch") {
        const id = batchId.trim();
        if (!id) {
            return;
        }
        logImportReviewUserAction({
            action: "select_batch",
            source: `ImportReviewPromotionClient:${source}`,
            route_slug: "promotion",
        });
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
            { source: `ImportReviewPromotionClient:${source}` }
        );
        setChangeBatchOpen(false);
        setDryRunResult(null);
    }

    function applyReviewBatchFromDraft() {
        applyReviewBatchId(batchDraft, "apply_draft");
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
        setAdvancedOpen(false);
    }

    const eligibilityRows = (eligibility?.families ?? []).filter(
        (row) => !isDeprecatedCoreBusImportReviewFamily(row.family)
    );

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-8">
                <header className="border-b border-gray-200 pb-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Create publish batch</h1>
                            <p className="mt-1 max-w-2xl text-sm text-gray-600">
                                Select approved import-review candidates and create a draft publish batch. Validation
                                and promotion happen on the batch detail page.
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
                        </div>
                    </div>
                </header>

                <ImportReviewTransportMovedNotice compact />

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="Scope"
                            subtitle="Publish batches are scoped to a single import review batch."
                        />
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <p className="text-sm text-gray-700">
                                Review batch:{" "}
                                <span className="font-mono font-semibold text-gray-900">
                                    {activeReviewBatchId || "—"}
                                </span>
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    setChangeBatchOpen((open) => !open);
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
                                        placeholder="numeric review batch id"
                                        className="mt-1 w-full min-w-[12rem] rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm sm:w-64"
                                    />
                                </label>
                                <button
                                    type="button"
                                    disabled={!batchDraft.trim() || eligibilityLoading}
                                    onClick={() => applyReviewBatchFromDraft()}
                                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                                >
                                    {eligibilityLoading ? "Applying…" : "Apply"}
                                </button>
                            </div>
                        ) : null}

                        <details
                            className="mt-4 rounded-md border border-gray-200 bg-gray-50/80"
                            open={advancedOpen}
                            onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
                        >
                            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700">
                                Advanced
                            </summary>
                            <div className="border-t border-gray-200 px-3 py-3">
                                <label className="block text-sm">
                                    <span className="font-medium text-gray-700">source_snapshot_version</span>
                                    <span className="ml-1 text-xs font-normal text-gray-500">
                                        (resolve batch from snapshot — optional)
                                    </span>
                                    <input
                                        type="text"
                                        value={snapshotDraft}
                                        onChange={(e) => setSnapshotDraft(e.target.value)}
                                        placeholder={envDefault || "e.g. kyauktan_2026_05_15_v2"}
                                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={() => applySnapshotScope()}
                                    disabled={!snapshotDraft.trim()}
                                    className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Load by snapshot
                                </button>
                            </div>
                        </details>
                    </PromotionCardBody>
                </section>

                {ambiguousBatches && ambiguousBatches.length > 0 ? (
                    <>
                        <ImportReviewStatusBanner
                            message={IMPORT_REVIEW_LOADING.multipleBatchesFound}
                            tone="warning"
                        />
                        <ImportReviewBatchPicker
                            sourceSnapshotVersion={ambiguousSnapshot}
                            batches={ambiguousBatches}
                            onSelectBatch={(batchId) => applyReviewBatchId(batchId)}
                            onUseLatest={() => {
                                const latest = ambiguousBatches[0];
                                if (latest?.id) {
                                    applyReviewBatchId(String(latest.id));
                                }
                            }}
                        />
                    </>
                ) : null}

                {!activeReviewBatchId ? (
                    <ImportReviewStatusBanner
                        message="Select a review batch to choose entity families and check eligibility."
                        tone="info"
                    />
                ) : null}

                {error ? <ImportReviewStatusBanner message={error} tone="error" /> : null}

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="Entity families"
                            subtitle="Choose which approved candidates to include in the publish batch."
                        />
                        <div className="mt-4 space-y-6">
                            <FamilyCheckboxGroup
                                title="Normal"
                                families={NORMAL_IMPORT_REVIEW_PROMOTION_FAMILY_META}
                                selected={selectedSet}
                                onToggle={toggleFamily}
                                disabled={!activeReviewBatchId}
                            />
                            <FamilyCheckboxGroup
                                title="High-risk"
                                families={HIGH_RISK_IMPORT_REVIEW_PROMOTION_FAMILY_META}
                                selected={selectedSet}
                                onToggle={toggleFamily}
                                disabled={!activeReviewBatchId}
                            />
                        </div>
                        {hasHighRiskSelected ? (
                            <ImportReviewStatusBanner
                                message="High-risk entities can affect routing, search, admin hierarchy, address linking, and production behavior. Review carefully before creating a publish batch."
                                tone="warning"
                                compact
                                className="mt-4"
                            />
                        ) : null}
                        {routingBarriersSelected ? (
                            <ImportReviewStatusBanner
                                message="Routing barriers will promote to routing.routing_barriers, not core.*."
                                tone="info"
                                compact
                                className="mt-3"
                            />
                        ) : null}
                    </PromotionCardBody>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="Eligibility"
                            subtitle="Counts for selected families in this review batch."
                        />
                        <ImportReviewPromotionEligibilityPanel
                            reviewBatchId={activeReviewBatchId}
                            selectedFamilyCount={selectedFamilies.length}
                            isLoading={eligibilityLoading}
                            errorMessage={eligibilityError}
                            eligibility={eligibility}
                            rows={eligibilityRows}
                            onRetry={() => {
                                setEligibilityFetchNonce((n) => n + 1);
                            }}
                            onOpenDetails={openEligibilityDetails}
                        />
                    </PromotionCardBody>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading title="Options" />
                        <div className="mt-4 space-y-4">
                            <label className="flex items-center gap-2 text-sm text-gray-800">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-300"
                                    checked={includeWarnings}
                                    onChange={(e) => {
                                        setIncludeWarnings(e.target.checked);
                                        setDryRunResult(null);
                                    }}
                                    disabled={!activeReviewBatchId}
                                />
                                Include candidates with warnings
                            </label>
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Review note</span>
                                <span className="ml-1 text-xs font-normal text-gray-500">(optional at creation)</span>
                                <textarea
                                    value={reviewNote}
                                    onChange={(e) => setReviewNote(e.target.value)}
                                    rows={3}
                                    placeholder="Optional note stored on the publish batch"
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                                    disabled={!activeReviewBatchId}
                                />
                            </label>
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
                        </div>
                    </PromotionCardBody>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading title="Actions" />
                        <div className="mt-4 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => void handleDryRun()}
                                disabled={!createBody || isDryRunning || isCreating}
                                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                            >
                                {isDryRunning ? IMPORT_REVIEW_LOADING.loadingPromotionBatch : "Dry-run preview"}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleCreate()}
                                disabled={!canCreate || isDryRunning || isCreating}
                                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                                {isCreating ? IMPORT_REVIEW_LOADING.loadingPromotionBatch : "Create publish batch"}
                            </button>
                        </div>
                        {dryRunResult ? (
                            <div className="mt-4">
                                <DryRunResultPanel result={dryRunResult} />
                            </div>
                        ) : null}
                    </PromotionCardBody>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            id="promotion-batches"
                            title="Existing publish batches"
                            subtitle={
                                activeReviewBatchId
                                    ? batchesTotal > 0
                                        ? `${batchesTotal} batch(es) for review batch ${activeReviewBatchId}.`
                                        : "No batches created for this review batch yet."
                                    : "Select a review batch to list publish batches."
                            }
                        />
                        {batchesLoading && batches.length === 0 ? (
                            <div className="mt-4">
                                <ImportReviewLoadingBannerWithSpinner
                                    message={IMPORT_REVIEW_LOADING.loadingPromotionBatch}
                                />
                            </div>
                        ) : batches.length === 0 ? (
                            <ImportReviewStatusBanner message="No publish batches yet." tone="info" compact />
                        ) : (
                            <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                                <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                                    <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        <tr>
                                            <th className="px-4 py-3">ID</th>
                                            <th className="px-4 py-3">Name</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3">Items</th>
                                            <th className="px-4 py-3">Success</th>
                                            <th className="px-4 py-3">Failed</th>
                                            <th className="px-4 py-3">Created</th>
                                            <th className="px-4 py-3" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 bg-white">
                                        {batches.map((b) => (
                                            <tr key={b.id}>
                                                <td className="px-4 py-3 font-mono text-xs">{b.id}</td>
                                                <td className="px-4 py-3 font-medium text-gray-900">{b.batch_name}</td>
                                                <td className="px-4 py-3">
                                                    <PromotionStatusBadge value={b.derived_status ?? b.status} />
                                                </td>
                                                <td className="px-4 py-3 tabular-nums">{b.total_item_count}</td>
                                                <td className="px-4 py-3 tabular-nums text-emerald-700">
                                                    {b.success_count}
                                                </td>
                                                <td className="px-4 py-3 tabular-nums text-red-700">{b.failed_count}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                                                    {new Date(b.created_at).toLocaleString()}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Link
                                                        href={`${importReviewPath("promotion")}/${b.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}
                                                        prefetch={false}
                                                        className="text-sm font-medium text-emerald-800 hover:underline"
                                                    >
                                                        View details
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
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
                formatError={formatPromotionError}
            />
        </main>
    );
}
