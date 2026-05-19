"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ImportReviewPromotionReadyTable from "@/src/app/(admin)/import-review/_components/ImportReviewPromotionReadyTable";
import {
    PromotionCardBody,
    PromotionSectionHeading,
    PromotionStatusBadge,
} from "@/src/app/(admin)/import-review/_components/importReviewPromotionUi";
import StatsCard from "@/src/components/dashboard/StatsCard";
import {
    getImportReviewPromotionBatches,
    getImportReviewPromotionReadyCandidates,
    isAbortError,
    postImportReviewPromotionBatch,
    type ImportReviewCreatePublishBatchResult,
    type ImportReviewPromotionReadyCandidateItem,
    type ImportReviewPromotionReadyCandidatesCounts,
    type ImportReviewPublishBatchSummary,
} from "@/src/lib/api";
import { isImportReviewDevTokenConfigured } from "@/src/lib/importReviewDevAccess";
import {
    applyImportReviewScopeSearchParams,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
} from "@/src/lib/importReviewSnapshot";

const CANDIDATE_PAGE_SIZE = 50;

type LoadedScope =
    | { kind: "source_snapshot"; value: string }
    | { kind: "review_batch"; value: string };

function scopeQuery(scope: LoadedScope) {
    return scope.kind === "review_batch"
        ? { review_batch_id: scope.value }
        : { source_snapshot_version: scope.value };
}

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

function defaultBatchName(scope: LoadedScope): string {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const tag =
        scope.kind === "review_batch"
            ? `batch-${scope.value}`
            : scope.value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48);
    return `buildings-publish-${tag}-${stamp}`;
}

function CandidateDetailModal({
    row,
    onClose,
}: {
    row: ImportReviewPromotionReadyCandidateItem;
    onClose: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="candidate-detail-title"
        >
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
                <div className="border-b border-gray-200 px-5 py-4">
                    <h3 id="candidate-detail-title" className="text-lg font-semibold text-gray-900">
                        Candidate {row.id}
                    </h3>
                    <p className="mt-0.5 text-sm text-gray-600">{row.name ?? row.canonical_name ?? row.public_id}</p>
                </div>
                <div className="space-y-3 px-5 py-4 text-sm">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                        <dt className="text-gray-500">External ID</dt>
                        <dd className="text-gray-900">{row.external_id ?? "—"}</dd>
                        <dt className="text-gray-500">Class</dt>
                        <dd>{row.class_code ?? "—"}</dd>
                        <dt className="text-gray-500">Building type</dt>
                        <dd>{row.building_type ?? "—"}</dd>
                        <dt className="text-gray-500">Confidence</dt>
                        <dd>{row.confidence_score ?? "—"}</dd>
                        <dt className="text-gray-500">Warnings / errors</dt>
                        <dd>
                            {row.validation_warnings_count} / {row.validation_errors_count}
                        </dd>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                        <PromotionStatusBadge value={row.match_status} />
                        <PromotionStatusBadge value={row.auto_action} />
                        <PromotionStatusBadge value={row.review_decision} />
                        <PromotionStatusBadge value={row.promotion_status} />
                    </div>
                </div>
                <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}


export default function ImportReviewPromotionClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const urlVersion = snapshotVersionFromImportReviewSearch(searchParams);
    const urlBatch = reviewBatchIdFromImportReviewSearch(searchParams);
    const envDefault = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION?.trim() ?? "";

    const [versionInput, setVersionInput] = useState(
        () => (urlBatch ? "" : urlVersion || envDefault || "")
    );
    const [batchInput, setBatchInput] = useState(() => urlBatch || "");
    const [includeMerged, setIncludeMerged] = useState(false);
    const [counts, setCounts] = useState<ImportReviewPromotionReadyCandidatesCounts | null>(null);
    const [candidates, setCandidates] = useState<ImportReviewPromotionReadyCandidateItem[]>([]);
    const [candidatesTotal, setCandidatesTotal] = useState(0);
    const [candidateOffset, setCandidateOffset] = useState(0);
    const [batches, setBatches] = useState<ImportReviewPublishBatchSummary[]>([]);
    const [batchesTotal, setBatchesTotal] = useState(0);
    const [detailCandidate, setDetailCandidate] = useState<ImportReviewPromotionReadyCandidateItem | null>(null);
    const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);
    const [batchName, setBatchName] = useState("");
    const [batchNote, setBatchNote] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [lastLoaded, setLastLoaded] = useState<LoadedScope | null>(null);

    const readyCount = counts?.ready ?? 0;

    useEffect(() => {
        setVersionInput(urlBatch ? "" : urlVersion || envDefault || "");
    }, [urlVersion, envDefault, urlBatch]);

    useEffect(() => {
        setBatchInput(urlBatch || "");
    }, [urlBatch]);

    const loadAll = useCallback(
        async (opts: {
            snapshotVersion: string;
            reviewBatchId: string;
            includeMerged: boolean;
            candidateOffset: number;
            signal?: AbortSignal;
            syncUrl: boolean;
        }): Promise<boolean> => {
            const snap = opts.snapshotVersion.trim();
            const batch = opts.reviewBatchId.trim();

            if (!snap && !batch) {
                setError("Provide source_snapshot_version or review_batch_id.");
                setCounts(null);
                setCandidates([]);
                setCandidatesTotal(0);
                setBatches([]);
                setBatchesTotal(0);
                setLastLoaded(null);
                return false;
            }
            if (snap && batch) {
                setError("Use only one of source_snapshot_version or review_batch_id.");
                setCounts(null);
                setCandidates([]);
                setCandidatesTotal(0);
                setLastLoaded(null);
                return false;
            }

            const scope: LoadedScope = snap
                ? { kind: "source_snapshot", value: snap }
                : { kind: "review_batch", value: batch };
            const query = {
                ...scopeQuery(scope),
                include_merged: opts.includeMerged,
            };

            setIsLoading(true);
            setError("");
            setSuccessMessage("");

            try {
                const [candidatesRes, listRes] = await Promise.all([
                    getImportReviewPromotionReadyCandidates(
                        {
                            ...query,
                            limit: CANDIDATE_PAGE_SIZE,
                            offset: opts.candidateOffset,
                            sort: "updated_at_desc",
                        },
                        opts.signal ? { signal: opts.signal } : undefined
                    ),
                    getImportReviewPromotionBatches(
                        { ...query, limit: 50, offset: 0 },
                        opts.signal ? { signal: opts.signal } : undefined
                    ),
                ]);
                setCounts(candidatesRes.counts);
                setCandidates(candidatesRes.items);
                setCandidatesTotal(candidatesRes.total);
                setCandidateOffset(opts.candidateOffset);
                setBatches(listRes.items);
                setBatchesTotal(listRes.total);
                setLastLoaded(scope);
                setBatchName((prev) => (prev.trim() ? prev : defaultBatchName(scope)));
                if (opts.syncUrl) {
                    const params = new URLSearchParams(searchParams.toString());
                    applyImportReviewScopeSearchParams(params, snap, batch);
                    router.replace(`/import-review/promotion?${params.toString()}`, { scroll: false });
                }
                return true;
            } catch (err) {
                if (isAbortError(err)) {
                    return false;
                }
                setError(formatPromotionError(err));
                setCounts(null);
                setCandidates([]);
                setCandidatesTotal(0);
                setBatches([]);
                setBatchesTotal(0);
                setLastLoaded(null);
                return false;
            } finally {
                setIsLoading(false);
            }
        },
        [router, searchParams]
    );

    const loadRef = useRef(loadAll);
    loadRef.current = loadAll;

    const chosenSnapshot = urlBatch ? "" : urlVersion || envDefault;
    const chosenBatch = urlBatch;

    useEffect(() => {
        if (chosenBatch) {
            const controller = new AbortController();
            void loadRef.current({
                snapshotVersion: "",
                reviewBatchId: chosenBatch,
                includeMerged,
                candidateOffset: 0,
                signal: controller.signal,
                syncUrl: false,
            });
            return () => controller.abort();
        }
        const v = chosenSnapshot.trim();
        if (!v) {
            return;
        }
        const controller = new AbortController();
        void loadRef.current({
            snapshotVersion: v,
            reviewBatchId: "",
            includeMerged,
            candidateOffset: 0,
            signal: controller.signal,
            syncUrl: false,
        });
        return () => controller.abort();
    }, [chosenBatch, chosenSnapshot, includeMerged]);

    async function handleApplyScope() {
        setCandidateOffset(0);
        await loadAll({
            snapshotVersion: versionInput,
            reviewBatchId: batchInput,
            includeMerged,
            candidateOffset: 0,
            syncUrl: true,
        });
    }

    async function handleCandidatePageChange(nextOffset: number) {
        if (!lastLoaded) {
            return;
        }
        await loadAll({
            snapshotVersion: lastLoaded.kind === "source_snapshot" ? lastLoaded.value : "",
            reviewBatchId: lastLoaded.kind === "review_batch" ? lastLoaded.value : "",
            includeMerged,
            candidateOffset: nextOffset,
            syncUrl: false,
        });
    }

    async function handleCreateBatchConfirmed() {
        if (!lastLoaded) {
            return;
        }
        const name = batchName.trim();
        if (!name) {
            setError("Batch name is required.");
            return;
        }

        setConfirmCreateOpen(false);
        setIsCreating(true);
        setError("");
        setSuccessMessage("");

        try {
            const result: ImportReviewCreatePublishBatchResult = await postImportReviewPromotionBatch({
                ...scopeQuery(lastLoaded),
                batch_name: name,
                note: batchNote.trim() || undefined,
                include_merged: includeMerged,
            });
            setSuccessMessage(result.message);
            setBatchName(defaultBatchName(lastLoaded));
            setBatchNote("");
            setCandidateOffset(0);
            await loadAll({
                snapshotVersion:
                    lastLoaded.kind === "source_snapshot" ? lastLoaded.value : "",
                reviewBatchId: lastLoaded.kind === "review_batch" ? lastLoaded.value : "",
                includeMerged,
                candidateOffset: 0,
                syncUrl: false,
            });
            const detailQuery = searchParams.toString();
            router.push(
                `/import-review/promotion/${result.batch.id}${detailQuery ? `?${detailQuery}` : ""}`
            );
        } catch (err) {
            setError(formatPromotionError(err));
        } finally {
            setIsCreating(false);
        }
    }

    const scopeLabel = useMemo(() => {
        if (!lastLoaded) {
            return null;
        }
        return lastLoaded.kind === "review_batch"
            ? `review_batch_id=${lastLoaded.value}`
            : `source_snapshot_version=${lastLoaded.value}`;
    }, [lastLoaded]);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-8">
                <header className="border-b border-gray-200 pb-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Publish batches</h1>
                            <p className="mt-1 max-w-2xl text-sm text-gray-600">
                                Create publish batches from approved import-review candidates. This does not write to
                                core yet.
                            </p>
                            {scopeLabel ? (
                                <p className="mt-2 text-xs text-gray-500">
                                    Scope: <strong>{scopeLabel}</strong>
                                </p>
                            ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Link
                                href="/import-review"
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                            >
                                Import review
                            </Link>
                            <Link
                                href="/import-review/buildings"
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                            >
                                Review buildings
                            </Link>
                        </div>
                    </div>
                </header>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            title="Scope"
                            subtitle="Choose exactly one: snapshot version or review batch ID."
                        />
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">source_snapshot_version</span>
                                <input
                                    type="text"
                                    value={versionInput}
                                    onChange={(e) => setVersionInput(e.target.value)}
                                    disabled={Boolean(batchInput.trim())}
                                    placeholder={envDefault || "e.g. kyauktan_2026_05_15_v2"}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm disabled:bg-gray-50"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">review_batch_id</span>
                                <input
                                    type="text"
                                    value={batchInput}
                                    onChange={(e) => setBatchInput(e.target.value)}
                                    disabled={Boolean(versionInput.trim())}
                                    placeholder="numeric review batch id"
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm disabled:bg-gray-50"
                                />
                            </label>
                        </div>
                        <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={includeMerged}
                                onChange={(e) => setIncludeMerged(e.target.checked)}
                            />
                            Include merged duplicate candidates (review_decision=merged)
                        </label>
                        <button
                            type="button"
                            onClick={() => void handleApplyScope()}
                            disabled={isLoading}
                            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                        >
                            {isLoading ? "Loading…" : "Apply scope"}
                        </button>
                    </PromotionCardBody>
                </section>

                {error ? (
                    <PromotionBanner variant="error" message={error} />
                ) : null}
                {successMessage ? (
                    <PromotionBanner variant="success" message={successMessage} />
                ) : null}

                <section className="space-y-3">
                    <PromotionSectionHeading
                        id="promotion-readiness"
                        title="Readiness"
                        subtitle="Server-side counts for this scope (buildings only)."
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <StatsCard
                            title="Ready"
                            value={counts?.ready ?? "—"}
                            description="Approved and eligible for a new publish batch now."
                            statusColor="success"
                        />
                        <StatsCard
                            title="Already batched"
                            value={counts?.already_batched ?? "—"}
                            description="promotion_status=batched (reserved in a prior batch)."
                        />
                        <StatsCard
                            title="Promoted"
                            value={counts?.promoted ?? "—"}
                            description="Already promoted to core (excluded from new batches)."
                        />
                        <StatsCard
                            title="Blocked (active batch)"
                            value={counts?.blocked_active_batch ?? "—"}
                            description="Linked to a draft/validating/ready/promoting publish batch."
                            statusColor="warning"
                        />
                    </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            id="promotion-preview"
                            title="Ready candidates preview"
                            subtitle="These rows match publish-batch eligibility rules and are not in an active batch."
                        />
                        <div className="mt-4">
                            <ImportReviewPromotionReadyTable
                                items={candidates}
                                total={candidatesTotal}
                                limit={CANDIDATE_PAGE_SIZE}
                                offset={candidateOffset}
                                scope={lastLoaded}
                                isLoading={isLoading}
                                onPageChange={(next) => void handleCandidatePageChange(next)}
                                onViewDetails={setDetailCandidate}
                            />
                        </div>
                    </PromotionCardBody>
                </section>

                <section className="rounded-xl border border-amber-200 bg-amber-50/40 shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            id="promotion-create"
                            title="Create publish batch"
                            subtitle={`${readyCount.toLocaleString()} building candidate(s) will be added if you proceed.`}
                        />
                        <p className="mt-2 text-sm text-amber-900">
                            Creating a batch does not write to core. It only reserves these candidates for
                            validation/promotion.
                        </p>
                        <div className="mt-4 space-y-4">
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">batch_name</span>
                                <input
                                    type="text"
                                    value={batchName}
                                    onChange={(e) => setBatchName(e.target.value)}
                                    maxLength={200}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">note (optional)</span>
                                <textarea
                                    value={batchNote}
                                    onChange={(e) => setBatchNote(e.target.value)}
                                    rows={2}
                                    maxLength={4000}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() => setConfirmCreateOpen(true)}
                                disabled={isCreating || isLoading || !lastLoaded || readyCount === 0}
                                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                                {isCreating ? "Creating…" : "Create publish batch…"}
                            </button>
                        </div>
                    </PromotionCardBody>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <PromotionCardBody>
                        <PromotionSectionHeading
                            id="promotion-batches"
                            title="Existing publish batches"
                            subtitle={
                                batchesTotal > 0
                                    ? `${batchesTotal} batch(es) for this scope.`
                                    : "No batches created for this scope yet."
                            }
                        />
                        {batches.length === 0 ? (
                            <p className="mt-4 text-sm text-gray-500">No publish batches yet.</p>
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
                                                    <PromotionStatusBadge value={b.status} />
                                                </td>
                                                <td className="px-4 py-3 tabular-nums">{b.total_item_count}</td>
                                                <td className="px-4 py-3 tabular-nums text-emerald-700">
                                                    {b.success_count}
                                                </td>
                                                <td className="px-4 py-3 tabular-nums text-red-700">{b.failed_count}</td>
                                                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                                    {new Date(b.created_at).toLocaleString()}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Link
                                                        href={`/import-review/promotion/${b.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}
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

            {detailCandidate ? (
                <CandidateDetailModal row={detailCandidate} onClose={() => setDetailCandidate(null)} />
            ) : null}

            {confirmCreateOpen ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    role="dialog"
                    aria-modal="true"
                >
                    <CreateBatchConfirmDialog
                        readyCount={readyCount}
                        batchName={batchName}
                        isCreating={isCreating}
                        onCancel={() => setConfirmCreateOpen(false)}
                        onConfirm={() => void handleCreateBatchConfirmed()}
                    />
                </div>
            ) : null}
        </main>
    );
}

function PromotionBanner({ variant, message }: { variant: "error" | "success"; message: string }) {
    const cls =
        variant === "error"
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-green-200 bg-green-50 text-green-900";
    return (
        <div className={`rounded-md border px-4 py-3 text-sm whitespace-pre-wrap ${cls}`}>{message}</div>
    );
}

function CreateBatchConfirmDialog({
    readyCount,
    batchName,
    isCreating,
    onCancel,
    onConfirm,
}: {
    readyCount: number;
    batchName: string;
    isCreating: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Create publish batch?</h3>
            <p className="mt-2 text-sm text-gray-600">
                Create publish batch from <strong>{readyCount.toLocaleString()}</strong> ready building candidate
                {readyCount === 1 ? "" : "s"}?
            </p>
            <p className="mt-2 text-sm text-gray-500">
                Batch name: <strong>{batchName.trim() || "(empty)"}</strong>
            </p>
            <p className="mt-2 text-xs text-amber-800">No core writes. Candidates will be marked promotion_status=batched.</p>
            <div className="mt-6 flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={isCreating}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={isCreating}
                    className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                    {isCreating ? "Creating…" : "Create batch"}
                </button>
            </div>
        </div>
    );
}
