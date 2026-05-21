"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
    PromotionCardBody,
    PromotionSectionHeading,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    getImportReviewPromotionBatchEligibility,
    isAbortError,
    postImportReviewPromotionBatch,
    type ImportReviewCreatePublishBatchDryRunResult,
    type ImportReviewCreatePublishBatchResult,
    type ImportReviewPromotionBatchEligibilityResponse,
    type ImportReviewPromotionScopeParams,
} from "@/src/lib/api";

const DEFAULT_PUBLISH_FAMILIES = [
    "buildings",
    "places",
    "landuse",
    "water_lines",
    "water_polygons",
    "bus_stops",
] as const;

const HIGH_RISK_PUBLISH_FAMILIES = ["roads", "addresses", "admin_areas", "routing_barriers"] as const;

const FAMILY_LABELS: Record<string, string> = {
    buildings: "Buildings",
    places: "Places",
    landuse: "Land use",
    water_lines: "Water lines",
    water_polygons: "Water polygons",
    bus_stops: "Bus stops",
    roads: "Roads",
    addresses: "Addresses",
    admin_areas: "Admin areas",
    routing_barriers: "Routing barriers",
};

type LoadedScope =
    | { kind: "source_snapshot"; value: string }
    | { kind: "review_batch"; value: string };

function scopeQuery(scope: LoadedScope): ImportReviewPromotionScopeParams {
    return scope.kind === "review_batch"
        ? { review_batch_id: scope.value }
        : { source_snapshot_version: scope.value };
}

function defaultBatchName(scope: LoadedScope, families: string[]): string {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const tag =
        scope.kind === "review_batch"
            ? `batch-${scope.value}`
            : scope.value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48);
    const familyTag = families.length === 1 ? families[0] : "multi";
    return `${familyTag}-publish-${tag}-${stamp}`;
}

function DryRunResultPanel({ result }: { result: ImportReviewCreatePublishBatchDryRunResult }) {
    return (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950" role="status">
            <div className="font-semibold">Dry-run result</div>
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
                    <dt>Excluded (other rules)</dt>
                    <dd className="tabular-nums font-medium">{result.totals.excluded.toLocaleString()}</dd>
                </div>
            </dl>
            {result.by_family.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-xs opacity-90">
                    {result.by_family.map((row) => (
                        <li key={row.entity_family}>
                            {FAMILY_LABELS[row.entity_family] ?? row.entity_family}: {row.included.toLocaleString()}{" "}
                            included
                        </li>
                    ))}
                </ul>
            ) : null}
            <p className="mt-2 text-xs opacity-90">{result.message}</p>
        </div>
    );
}

export default function ImportReviewPromotionCreateBatchPanel({
    scope,
    onCreated,
    onError,
}: {
    scope: LoadedScope | null;
    onCreated: (result: ImportReviewCreatePublishBatchResult) => void;
    onError: (message: string) => void;
}) {
    const [selectedFamilies, setSelectedFamilies] = useState<string[]>([...DEFAULT_PUBLISH_FAMILIES]);
    const [highRiskEnabled, setHighRiskEnabled] = useState(false);
    const [includeMerged, setIncludeMerged] = useState(false);
    const [includeWarnings, setIncludeWarnings] = useState(false);
    const [warningNote, setWarningNote] = useState("");
    const [batchName, setBatchName] = useState("");
    const [batchNote, setBatchNote] = useState("");
    const [eligibility, setEligibility] = useState<ImportReviewPromotionBatchEligibilityResponse | null>(null);
    const [eligibilityLoading, setEligibilityLoading] = useState(false);
    const [dryRunResult, setDryRunResult] = useState<ImportReviewCreatePublishBatchDryRunResult | null>(null);
    const [isDryRunning, setIsDryRunning] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const readyTotal = eligibility?.totals.approved_ready ?? 0;

    const toggleFamily = useCallback((family: string, checked: boolean) => {
        setSelectedFamilies((prev) => {
            if (checked) {
                return prev.includes(family) ? prev : [...prev, family];
            }
            return prev.filter((f) => f !== family);
        });
    }, []);

    useEffect(() => {
        if (!scope || selectedFamilies.length === 0) {
            setEligibility(null);
            return;
        }
        const controller = new AbortController();
        setEligibilityLoading(true);
        void getImportReviewPromotionBatchEligibility(
            {
                ...scopeQuery(scope),
                entity_families: selectedFamilies,
                include_merged: includeMerged,
                include_warnings: includeWarnings,
            },
            { signal: controller.signal }
        )
            .then((res) => {
                setEligibility(res);
                setBatchName((prev) => (prev.trim() ? prev : defaultBatchName(scope, selectedFamilies)));
            })
            .catch((err) => {
                if (isAbortError(err)) {
                    return;
                }
                onError(err instanceof Error ? err.message : "Failed to load eligibility.");
                setEligibility(null);
            })
            .finally(() => setEligibilityLoading(false));
        return () => controller.abort();
    }, [scope, selectedFamilies, includeMerged, includeWarnings, onError]);

    const requestBody = useMemo(() => {
        if (!scope) {
            return null;
        }
        return {
            ...scopeQuery(scope),
            batch_name: batchName.trim() || defaultBatchName(scope, selectedFamilies),
            note: batchNote.trim() || undefined,
            entity_families: selectedFamilies,
            mode: "approved_only" as const,
            include_warnings: includeWarnings,
            warning_confirmation_note: includeWarnings ? warningNote.trim() : undefined,
            include_merged: includeMerged,
            allow_high_risk_families: highRiskEnabled,
        };
    }, [
        scope,
        batchName,
        batchNote,
        selectedFamilies,
        includeWarnings,
        warningNote,
        includeMerged,
        highRiskEnabled,
    ]);

    async function handleDryRun() {
        if (!requestBody) {
            return;
        }
        setIsDryRunning(true);
        setDryRunResult(null);
        onError("");
        try {
            const result = await postImportReviewPromotionBatch({ ...requestBody, dry_run: true });
            if ("dry_run" in result && result.dry_run) {
                setDryRunResult(result);
            }
        } catch (err) {
            onError(err instanceof Error ? err.message : "Dry-run failed.");
        } finally {
            setIsDryRunning(false);
        }
    }

    async function handleCreateConfirmed() {
        if (!requestBody) {
            return;
        }
        setConfirmOpen(false);
        setIsCreating(true);
        onError("");
        try {
            const result = await postImportReviewPromotionBatch({ ...requestBody, dry_run: false });
            if ("dry_run" in result && result.dry_run) {
                return;
            }
            setDryRunResult(null);
            onCreated(result as ImportReviewCreatePublishBatchResult);
        } catch (err) {
            onError(err instanceof Error ? err.message : "Create batch failed.");
        } finally {
            setIsCreating(false);
        }
    }

    if (!scope) {
        return null;
    }

    return (
        <>
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                <PromotionCardBody>
                    <PromotionSectionHeading
                        id="promotion-entities"
                        title="Entity families"
                        subtitle="Select which candidate tables to include in the publish batch."
                    />
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {DEFAULT_PUBLISH_FAMILIES.map((family) => (
                            <label key={family} className="flex items-center gap-2 text-sm text-gray-800">
                                <input
                                    type="checkbox"
                                    checked={selectedFamilies.includes(family)}
                                    onChange={(e) => toggleFamily(family, e.target.checked)}
                                />
                                {FAMILY_LABELS[family] ?? family}
                            </label>
                        ))}
                    </div>
                    <details className="mt-4 rounded-md border border-amber-200 bg-amber-50/50 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-amber-950">
                            Advanced / high-risk families
                        </summary>
                        <label className="mt-3 flex items-center gap-2 text-sm text-amber-950">
                            <input
                                type="checkbox"
                                checked={highRiskEnabled}
                                onChange={(e) => setHighRiskEnabled(e.target.checked)}
                            />
                            Enable high-risk families (roads, addresses, admin areas, routing barriers)
                        </label>
                        {highRiskEnabled ? (
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                {HIGH_RISK_PUBLISH_FAMILIES.map((family) => (
                                    <label key={family} className="flex items-center gap-2 text-sm text-gray-800">
                                        <input
                                            type="checkbox"
                                            checked={selectedFamilies.includes(family)}
                                            onChange={(e) => toggleFamily(family, e.target.checked)}
                                        />
                                        {FAMILY_LABELS[family] ?? family}
                                    </label>
                                ))}
                            </div>
                        ) : null}
                    </details>
                </PromotionCardBody>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                <PromotionCardBody>
                    <PromotionSectionHeading
                        id="promotion-eligibility"
                        title="Eligibility by family"
                        subtitle="Approved-ready counts for the selected families."
                    />
                    {eligibilityLoading ? (
                        <div className="mt-3">
                            <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingEligibility} />
                        </div>
                    ) : null}
                    {eligibility && eligibility.by_family.length > 0 ? (
                        <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    <tr>
                                        <th className="px-4 py-3">Family</th>
                                        <th className="px-4 py-3">Approved ready</th>
                                        <th className="px-4 py-3">With warnings</th>
                                        <th className="px-4 py-3">Blocked</th>
                                        <th className="px-4 py-3">Already promoted</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {eligibility.by_family.map((row) => (
                                        <tr key={row.entity_family}>
                                            <td className="px-4 py-3 font-medium text-gray-900">
                                                {FAMILY_LABELS[row.entity_family] ?? row.entity_family}
                                            </td>
                                            <td className="px-4 py-3 tabular-nums">{row.approved_ready}</td>
                                            <td className="px-4 py-3 tabular-nums">{row.with_warnings}</td>
                                            <td className="px-4 py-3 tabular-nums">{row.blocked}</td>
                                            <td className="px-4 py-3 tabular-nums">{row.already_promoted}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="mt-4 text-sm text-gray-500">
                            {selectedFamilies.length === 0
                                ? "Select at least one entity family."
                                : "No eligibility data for this scope."}
                        </p>
                    )}
                </PromotionCardBody>
            </section>

            <section className="rounded-xl border border-amber-200 bg-amber-50/40 shadow-sm">
                <PromotionCardBody>
                    <PromotionSectionHeading
                        id="promotion-create"
                        title="Create publish batch"
                        subtitle={`${readyTotal.toLocaleString()} candidate(s) ready across selected families.`}
                    />
                    <p className="mt-2 text-sm text-amber-900">
                        Creating a batch reserves candidates for validation. Validate / promote to core on batch
                        detail is still buildings-only until a follow-up phase.
                    </p>
                    <div className="mt-4 space-y-4">
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={includeMerged}
                                onChange={(e) => setIncludeMerged(e.target.checked)}
                            />
                            Include merged duplicate candidates (review_decision=merged)
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={includeWarnings}
                                onChange={(e) => setIncludeWarnings(e.target.checked)}
                            />
                            Include candidates with validation warnings
                        </label>
                        {includeWarnings ? (
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Warning confirmation note</span>
                                <textarea
                                    value={warningNote}
                                    onChange={(e) => setWarningNote(e.target.value)}
                                    rows={2}
                                    maxLength={4000}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                                    placeholder="Required when including warning rows"
                                />
                            </label>
                        ) : null}
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
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => void handleDryRun()}
                                disabled={
                                    isDryRunning ||
                                    isCreating ||
                                    eligibilityLoading ||
                                    selectedFamilies.length === 0 ||
                                    (includeWarnings && !warningNote.trim())
                                }
                                className="rounded-md border border-blue-700 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                            >
                                {isDryRunning ? "Dry-running…" : "Dry-run preview"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmOpen(true)}
                                disabled={
                                    isCreating ||
                                    isDryRunning ||
                                    eligibilityLoading ||
                                    selectedFamilies.length === 0 ||
                                    readyTotal === 0 ||
                                    (includeWarnings && !warningNote.trim())
                                }
                                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                                {isCreating ? IMPORT_REVIEW_LOADING.creatingPublishBatch : "Create publish batch…"}
                            </button>
                        </div>
                        {dryRunResult ? <div className="mt-3"><DryRunResultPanel result={dryRunResult} /></div> : null}
                    </div>
                </PromotionCardBody>
            </section>

            {confirmOpen ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                        <h3 className="text-lg font-semibold text-gray-900">Create publish batch?</h3>
                        <p className="mt-2 text-sm text-gray-600">
                            Create publish batch from <strong>{readyTotal.toLocaleString()}</strong> ready candidate
                            {readyTotal === 1 ? "" : "s"} across{" "}
                            <strong>{selectedFamilies.length}</strong> famil
                            {selectedFamilies.length === 1 ? "y" : "ies"}?
                        </p>
                        <p className="mt-2 text-sm text-gray-500">
                            Batch name: <strong>{batchName.trim() || "(empty)"}</strong>
                        </p>
                        <p className="mt-2 text-xs text-amber-800">
                            No core writes. Candidates will be marked promotion_status=batched.
                        </p>
                        <div className="mt-6 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmOpen(false)}
                                disabled={isCreating}
                                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleCreateConfirmed()}
                                disabled={isCreating}
                                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                                {isCreating ? IMPORT_REVIEW_LOADING.creatingPublishBatch : "Create batch"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
}

/** Exposed for readiness totals in parent. */
export function usePromotionEligibilityTotals(
    scope: LoadedScope | null,
    families: string[],
    includeMerged: boolean
) {
    const [totals, setTotals] = useState<ImportReviewPromotionBatchEligibilityResponse["totals"] | null>(null);

    useEffect(() => {
        if (!scope || families.length === 0) {
            return;
        }
        const controller = new AbortController();
        void getImportReviewPromotionBatchEligibility(
            {
                ...scopeQuery(scope),
                entity_families: families,
                include_merged: includeMerged,
            },
            { signal: controller.signal }
        )
            .then((res) => setTotals(res.totals))
            .catch(() => setTotals(null));
        return () => controller.abort();
    }, [scope, families, includeMerged]);

    if (!scope || families.length === 0) {
        return null;
    }
    return totals;
}

export { DEFAULT_PUBLISH_FAMILIES, type LoadedScope as PromotionLoadedScope, scopeQuery as promotionScopeQuery };
