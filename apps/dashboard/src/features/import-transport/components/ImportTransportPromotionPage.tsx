"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { Card, CardContent } from "@/src/components/ui/card";
import {
    getImportTransportPromotionReady,
    postImportTransportPromotionBatch,
} from "@/src/features/import-transport/api/importTransportApiClient";
import { formatImportTransportApiError } from "@/src/features/import-transport/api/importTransportApiErrors";
import ImportTransportBatchScopePanel from "@/src/features/import-transport/components/ImportTransportBatchScopePanel";
import ImportTransportErrorState from "@/src/features/import-transport/components/ImportTransportErrorState";
import { ImportTransportLoadingBannerWithSpinner } from "@/src/features/import-transport/components/ImportTransportLoadingState";
import { useImportTransportBatchContext } from "@/src/features/import-transport/hooks/useImportTransportBatchContext";
import type { ImportTransportApiFamily, ImportTransportPromotionReadyResponse } from "@/src/features/import-transport/config/types";
import { importTransportPath } from "@/src/lib/dashboardPaths";

const ENTITY_OPTIONS: { value: ImportTransportApiFamily; label: string }[] = [
    { value: "routes", label: "Routes" },
    { value: "stops", label: "Stops" },
    { value: "variants", label: "Variants" },
    { value: "route_stops", label: "Route stops" },
];

function ImportTransportPromotionInner() {
    const router = useRouter();
    const batchContext = useImportTransportBatchContext();

    const [mode, setMode] = useState<"one_entity" | "all_entities">("all_entities");
    const [entityFamily, setEntityFamily] = useState<ImportTransportApiFamily>("routes");
    const [includeWarnings, setIncludeWarnings] = useState(false);
    const [ready, setReady] = useState<ImportTransportPromotionReadyResponse | null>(null);
    const [readyLoading, setReadyLoading] = useState(false);
    const [readyError, setReadyError] = useState("");
    const [createError, setCreateError] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    const hasScope = batchContext.status === "resolved" && Boolean(batchContext.importBatchId);
    const importBatchIdForBody = hasScope ? Number.parseInt(batchContext.importBatchId ?? "", 10) : null;

    const loadReady = useCallback(async () => {
        if (!hasScope || !batchContext.importBatchId) {
            setReady(null);
            return;
        }
        setReadyLoading(true);
        setReadyError("");
        try {
            const response = await getImportTransportPromotionReady({
                import_batch_id: batchContext.importBatchId,
                include_warnings: includeWarnings,
            });
            setReady(response);
        } catch (err) {
            setReady(null);
            setReadyError(formatImportTransportApiError(err, "Failed to load promotion-ready counts."));
        } finally {
            setReadyLoading(false);
        }
    }, [hasScope, batchContext.importBatchId, includeWarnings]);

    useEffect(() => {
        void loadReady();
    }, [loadReady]);

    const eligibleTotal = useMemo(() => {
        if (!ready) {
            return 0;
        }
        const families =
            mode === "one_entity"
                ? ready.by_family.filter((row) => row.entity_family === entityFamily)
                : ready.by_family;
        return families.reduce(
            (sum, row) => sum + row.ready + (includeWarnings ? row.with_warnings : 0),
            0
        );
    }, [ready, mode, entityFamily, includeWarnings]);

    const createBatch = useCallback(async () => {
        if (!hasScope || importBatchIdForBody == null) {
            return;
        }
        setIsCreating(true);
        setCreateError("");
        try {
            const result = await postImportTransportPromotionBatch({
                import_batch_id: importBatchIdForBody,
                mode,
                entity_family: mode === "one_entity" ? entityFamily : null,
                include_warnings: includeWarnings,
            });
            router.push(importTransportPath(`promotion/${result.batch.id}`));
        } catch (err) {
            setCreateError(formatImportTransportApiError(err, "Failed to create promotion batch."));
        } finally {
            setIsCreating(false);
        }
    }, [entityFamily, hasScope, importBatchIdForBody, includeWarnings, mode, router]);

    return (
        <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
            <div className="mx-auto max-w-5xl space-y-6">
                <header className="border-b border-gray-200 pb-6">
                    <h1 className="text-2xl font-bold text-gray-900">Transport promotion</h1>
                    <p className="mt-1 max-w-3xl text-sm text-gray-600">
                        Create draft promotion batches from approved, validated import_transport candidates.
                        No core_transport writes are performed yet.
                    </p>
                </header>

                <ImportTransportBatchScopePanel />

                {hasScope ? (
                    <>
                        <Card className="border-gray-200 shadow-sm">
                            <CardContent className="space-y-5 p-5">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <fieldset className="space-y-2">
                                        <legend className="text-xs font-semibold uppercase text-gray-600">
                                            Promotion mode
                                        </legend>
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="radio"
                                                checked={mode === "one_entity"}
                                                onChange={() => setMode("one_entity")}
                                            />
                                            One entity
                                        </label>
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="radio"
                                                checked={mode === "all_entities"}
                                                onChange={() => setMode("all_entities")}
                                            />
                                            All entities
                                        </label>
                                    </fieldset>

                                    {mode === "one_entity" ? (
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs font-semibold text-gray-600">
                                                Entity family
                                            </span>
                                            <select
                                                value={entityFamily}
                                                onChange={(e) =>
                                                    setEntityFamily(e.target.value as ImportTransportApiFamily)
                                                }
                                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                                            >
                                                {ENTITY_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ) : null}
                                </div>

                                <label className="flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={includeWarnings}
                                        onChange={(e) => setIncludeWarnings(e.target.checked)}
                                    />
                                    Include warning candidates (requires review note on each row)
                                </label>
                            </CardContent>
                        </Card>

                        {readyLoading ? (
                            <ImportTransportLoadingBannerWithSpinner message="Loading promotion-ready counts…" />
                        ) : null}

                        <ImportTransportErrorState message={readyError} />
                        <ImportTransportErrorState message={createError} />

                        {ready ? (
                            <Card className="border-gray-200 shadow-sm">
                                <CardContent className="space-y-4 p-5">
                                    <h2 className="text-sm font-semibold text-gray-900">Ready counts</h2>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full text-left text-sm">
                                            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
                                                <tr>
                                                    <th className="px-3 py-2">Entity</th>
                                                    <th className="px-3 py-2">Ready</th>
                                                    <th className="px-3 py-2">Warnings</th>
                                                    <th className="px-3 py-2">Blocked</th>
                                                    <th className="px-3 py-2">Promoted</th>
                                                    <th className="px-3 py-2">Batched</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(mode === "one_entity"
                                                    ? ready.by_family.filter(
                                                          (row) => row.entity_family === entityFamily
                                                      )
                                                    : ready.by_family
                                                ).map((row) => (
                                                    <tr key={row.entity_family} className="border-b border-gray-100">
                                                        <td className="px-3 py-2 font-mono text-xs">
                                                            {row.entity_family}
                                                        </td>
                                                        <td className="px-3 py-2">{row.ready}</td>
                                                        <td className="px-3 py-2">{row.with_warnings}</td>
                                                        <td className="px-3 py-2">{row.blocked}</td>
                                                        <td className="px-3 py-2">{row.already_promoted}</td>
                                                        <td className="px-3 py-2">{row.already_batched}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="text-sm text-gray-600">
                                        Eligible for this batch:{" "}
                                        <span className="font-semibold text-gray-900">
                                            {eligibleTotal.toLocaleString()}
                                        </span>
                                    </p>
                                </CardContent>
                            </Card>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                disabled={!hasScope || isCreating || eligibleTotal <= 0}
                                onClick={() => void createBatch()}
                                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                                {isCreating ? "Creating batch…" : "Create promotion batch"}
                            </button>
                            <Link
                                href={importTransportPath()}
                                className="text-sm text-gray-600 underline-offset-2 hover:underline"
                            >
                                Back to overview
                            </Link>
                        </div>
                    </>
                ) : null}
            </div>
        </main>
    );
}

export default function ImportTransportPromotionPage() {
    return (
        <Suspense fallback={null}>
            <ImportTransportPromotionInner />
        </Suspense>
    );
}
