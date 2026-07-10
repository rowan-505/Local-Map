"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import {
    AdvancedToolSection,
    TransportMetricPill,
    TransportToolbarButton,
} from "./TransportRouteDetailCards";
import { getTransportRouteDiagnostics } from "./api";
import type { TransportRouteDiagnostics } from "./types";

function formatJson(value: unknown): string {
    return JSON.stringify(value ?? null, null, 2);
}

function jsonPayloadSize(value: unknown): string {
    const bytes = new Blob([formatJson(value)]).size;
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function isEmptyJson(value: unknown): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value as object).length === 0;
    }
    if (Array.isArray(value)) {
        return value.length === 0;
    }
    return false;
}

function JsonBlock({ title, value }: { readonly title: string; readonly value: unknown }) {
    const empty = isEmptyJson(value);
    const sizeLabel = jsonPayloadSize(value);

    return (
        <details className="group overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm open:ring-1 open:ring-violet-100">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-medium text-slate-700 marker:content-none hover:bg-slate-50/80">
                <span className="min-w-0 truncate font-mono text-[11px] text-slate-800">{title}</span>
                <span className="flex shrink-0 items-center gap-2">
                    <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            empty
                                ? "bg-slate-100 text-slate-500"
                                : "bg-violet-50 text-violet-700"
                        }`}
                    >
                        {empty ? "empty" : sizeLabel}
                    </span>
                    <span className="text-slate-400 transition group-open:rotate-180">▾</span>
                </span>
            </summary>
            <pre className="max-h-56 overflow-auto border-t border-slate-100 bg-slate-950/95 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                {formatJson(value)}
            </pre>
        </details>
    );
}

function DiagnosticsSkeleton() {
    return (
        <div className="space-y-2">
            {[0, 1, 2, 3].map((index) => (
                <div key={index} className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ))}
        </div>
    );
}

function mergeWarnings(server: string[], client: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const message of [...server, ...client]) {
        if (seen.has(message)) continue;
        seen.add(message);
        out.push(message);
    }
    return out;
}

export function TransportRouteAdvancedDiagnosticsPanel({
    routePublicId,
    open,
    clientWarnings = [],
    onRefreshReadiness,
}: {
    readonly routePublicId: string;
    readonly open: boolean;
    readonly clientWarnings?: string[];
    readonly onRefreshReadiness?: () => void;
}) {
    const [diagnostics, setDiagnostics] = useState<TransportRouteDiagnostics | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

    const validationWarnings = useMemo(
        () =>
            diagnostics
                ? mergeWarnings(diagnostics.validation_warnings, clientWarnings)
                : clientWarnings,
        [diagnostics, clientWarnings],
    );

    const exportPayload = useMemo(() => {
        if (!diagnostics) {
            return clientWarnings.length > 0
                ? { validation_warnings: clientWarnings }
                : null;
        }
        return {
            ...diagnostics,
            validation_warnings: validationWarnings,
        };
    }, [diagnostics, clientWarnings, validationWarnings]);

    const loadDiagnostics = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError("");
            try {
                const result = await getTransportRouteDiagnostics(routePublicId, { signal });
                setDiagnostics(result);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load diagnostics.");
            } finally {
                setLoading(false);
            }
        },
        [routePublicId],
    );

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        void loadDiagnostics(controller.signal);
        return () => controller.abort();
    }, [open, loadDiagnostics]);

    const handleRefresh = useCallback(() => {
        void loadDiagnostics();
        onRefreshReadiness?.();
    }, [loadDiagnostics, onRefreshReadiness]);

    const handleCopy = useCallback(async () => {
        if (!exportPayload) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
            setCopyState("copied");
            window.setTimeout(() => setCopyState("idle"), 2000);
        } catch {
            setCopyState("failed");
            window.setTimeout(() => setCopyState("idle"), 2000);
        }
    }, [exportPayload]);

    const copyLabel =
        copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy JSON";

    return (
        <AdvancedToolSection
            accent="violet"
            title="Technical diagnostics"
            description="Raw import payloads and validation warnings."
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                    <TransportMetricPill
                        label="Warnings"
                        value={validationWarnings.length}
                        tone={validationWarnings.length > 0 ? "warning" : "success"}
                    />
                    {diagnostics ? (
                        <>
                            <TransportMetricPill
                                label="Variants"
                                value={diagnostics.variants.length}
                            />
                            <TransportMetricPill
                                label="Links"
                                value={diagnostics.source_links.length}
                            />
                        </>
                    ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <TransportToolbarButton
                        onClick={() => void handleCopy()}
                        disabled={!exportPayload || loading}
                    >
                        {copyLabel}
                    </TransportToolbarButton>
                    <TransportToolbarButton
                        variant="primary"
                        onClick={handleRefresh}
                        disabled={loading}
                    >
                        {loading ? "Refreshing…" : "Refresh"}
                    </TransportToolbarButton>
                </div>
            </div>

            {error ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    {error}
                </p>
            ) : null}

            {loading && !diagnostics ? (
                <div className="mt-3">
                    <DiagnosticsSkeleton />
                </div>
            ) : null}

            {diagnostics ? (
                <div className="mt-3 space-y-3">
                    <div>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Validation
                        </p>
                        {validationWarnings.length > 0 ? (
                            <ul className="space-y-1.5">
                                {validationWarnings.map((warning) => (
                                    <li
                                        key={warning}
                                        className="flex gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-950"
                                    >
                                        <span
                                            className="mt-0.5 shrink-0 font-semibold text-amber-600"
                                            aria-hidden
                                        >
                                            !
                                        </span>
                                        <span>{warning}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="rounded-lg border border-emerald-200/80 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
                                No validation warnings.
                            </p>
                        )}
                    </div>

                    <div>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Route
                        </p>
                        <div className="space-y-2">
                            <JsonBlock
                                title="route.normalized_data"
                                value={diagnostics.route.normalized_data}
                            />
                            <JsonBlock title="route.source_refs" value={diagnostics.route.source_refs} />
                        </div>
                    </div>

                    <div>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Variants
                        </p>
                        <div className="space-y-2">
                            {diagnostics.variants.length > 0 ? (
                                diagnostics.variants.map((variant) => (
                                    <JsonBlock
                                        key={variant.public_id}
                                        title={`variant.normalized_data · ${variant.variant_code}`}
                                        value={variant.normalized_data}
                                    />
                                ))
                            ) : (
                                <JsonBlock title="variant.normalized_data" value={null} />
                            )}
                        </div>
                    </div>

                    <div>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Sources
                        </p>
                        <JsonBlock title="source_links" value={diagnostics.source_links} />
                    </div>
                </div>
            ) : null}
        </AdvancedToolSection>
    );
}
