"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import StatsCard, { type StatsCardStatusColor } from "@/src/components/dashboard/StatsCard";
import { Card, CardContent } from "@/src/components/ui/card";
import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import {
    getTransportDataQualityQueues,
    getTransportOverview,
    getTransportQualitySummary,
} from "./api";
import type {
    TransportCountsByKey,
    TransportDataQualityQueues,
    TransportImportIssueBreakdown,
    TransportOverview,
    TransportQualitySummary,
    TransportQualitySummaryRow,
} from "./types";

type CountCard = { title: string; value: number };

type QueueCard = {
    title: string;
    value: number;
    description: string;
    href: string;
    statusColor: StatsCardStatusColor;
    /** When true, the destination list cannot pre-filter this exact queue. */
    approximateLink?: boolean;
};

type QueueGroup = { heading: string; cards: QueueCard[] };

const MODE_LABELS: Record<string, string> = {
    bus: "Bus",
    express_bus: "Express bus",
    train: "Train",
    ferry: "Ferry",
    air: "Air",
    other: "Other",
    unknown: "Unknown",
};

function modeLabel(key: string): string {
    return MODE_LABELS[key] ?? key;
}

function ModeBreakdown({
    title,
    counts,
}: {
    readonly title: string;
    readonly counts: TransportCountsByKey;
}) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    return (
        <Card>
            <CardContent className="space-y-3 p-5">
                <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                {entries.length === 0 ? (
                    <p className="text-sm text-gray-500">No data.</p>
                ) : (
                    <ul className="space-y-1.5">
                        {entries.map(([key, value]) => (
                            <li
                                key={key}
                                className="flex items-center justify-between gap-3 text-sm"
                            >
                                <span className="text-gray-700">{modeLabel(key)}</span>
                                <span className="font-medium tabular-nums text-gray-900">
                                    {value.toLocaleString()}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

/** Quality review queues (excluding imports, which get their own section). */
function buildQualityGroups(d: TransportDataQualityQueues): QueueGroup[] {
    const low = d.lowConfidenceThreshold;
    const confMax = Math.max(0, low - 1);

    return [
        {
            heading: "Naming",
            cards: [
                {
                    title: "Generated-name stops",
                    value: d.generatedNameStops,
                    description: "Synthetic OSM-derived stop names",
                    href: transportPath("stops?generatedName=true"),
                    statusColor: "warning",
                },
                {
                    title: "Generated-name terminals",
                    value: d.generatedNameTerminals,
                    description: "Synthetic OSM-derived terminal names",
                    href: transportPath("terminals?generatedName=true"),
                    statusColor: "warning",
                },
                {
                    title: "Missing-name stops",
                    value: d.missingNameStops,
                    description: "Stops with no name at all",
                    href: transportPath("stops"),
                    statusColor: d.missingNameStops > 0 ? "danger" : "default",
                    approximateLink: true,
                },
                {
                    title: "Missing-name terminals",
                    value: d.missingNameTerminals,
                    description: "Terminals with no name at all",
                    href: transportPath("terminals"),
                    statusColor: d.missingNameTerminals > 0 ? "danger" : "default",
                    approximateLink: true,
                },
            ],
        },
        {
            heading: "Route geometry & stops",
            cards: [
                {
                    title: "Routes without path",
                    value: d.routesWithoutPath,
                    description: "No drawn path on any variant",
                    href: transportPath("routes?hasPath=false"),
                    statusColor: "warning",
                },
                {
                    title: "Routes with stops, no path",
                    value: d.routesWithStopsButNoPath,
                    description: "Have a stop sequence but no path",
                    href: transportPath("routes?hasStops=true&hasPath=false"),
                    statusColor: "warning",
                },
                {
                    title: "Routes with path, no stops",
                    value: d.routesWithPathButNoStops,
                    description: "Have a path but no stop sequence",
                    href: transportPath("routes?hasStops=false&hasPath=true"),
                    statusColor: "warning",
                },
                {
                    title: "Ferry landing candidates",
                    value: d.ferryLandingCandidates,
                    description: "Unreviewed ferry terminals",
                    href: transportPath("terminals?mode=ferry&reviewStatus=imported_unreviewed"),
                    statusColor: "warning",
                },
            ],
        },
        {
            heading: `Low confidence (< ${low})`,
            cards: [
                {
                    title: "Low-confidence stops",
                    value: d.lowConfidenceStops,
                    description: `Confidence score below ${low}`,
                    href: transportPath("stops"),
                    statusColor: d.lowConfidenceStops > 0 ? "warning" : "default",
                    approximateLink: true,
                },
                {
                    title: "Low-confidence terminals",
                    value: d.lowConfidenceTerminals,
                    description: `Confidence score below ${low}`,
                    href: transportPath(`terminals?confidenceMax=${confMax}`),
                    statusColor: d.lowConfidenceTerminals > 0 ? "warning" : "default",
                },
                {
                    title: "Low-confidence routes",
                    value: d.lowConfidenceRoutes,
                    description: `Confidence score below ${low}`,
                    href: transportPath("routes"),
                    statusColor: d.lowConfidenceRoutes > 0 ? "warning" : "default",
                    approximateLink: true,
                },
            ],
        },
    ];
}

function QueueGroupSection({ group }: { readonly group: QueueGroup }) {
    return (
        <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">{group.heading}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {group.cards.map((card) => (
                    <Link
                        key={card.title}
                        href={card.href}
                        prefetch={false}
                        className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                    >
                        <StatsCard
                            title={card.title}
                            value={card.value}
                            description={
                                card.approximateLink
                                    ? `${card.description} · opens list`
                                    : card.description
                            }
                            statusColor={card.statusColor}
                            className="h-full transition-shadow hover:shadow-md"
                        />
                    </Link>
                ))}
            </div>
        </section>
    );
}

const IMPORT_ISSUE_LABELS: { key: keyof TransportImportIssueBreakdown; label: string }[] = [
    { key: "missingNameMm", label: "Missing Myanmar name" },
    { key: "missingNameEn", label: "Missing English name" },
    { key: "fallbackName", label: "Fallback / generated name" },
    { key: "lowConfidence", label: "Low confidence" },
    { key: "routeGeometry", label: "Route geometry issue" },
    { key: "routeStopMember", label: "Missing route stop member" },
    { key: "other", label: "Other issues" },
];

function ImportIssuesBreakdown({
    issues,
    total,
}: {
    readonly issues: TransportImportIssueBreakdown;
    readonly total: number;
}) {
    const entries = IMPORT_ISSUE_LABELS.map((entry) => ({
        ...entry,
        value: issues[entry.key],
    })).sort((a, b) => b.value - a.value);

    return (
        <Card>
            <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900">
                            Import Warnings / Issues ({total.toLocaleString()})
                        </h3>
                        <p className="text-xs text-gray-500">
                            Warnings and issues recorded during import
                        </p>
                    </div>
                    <Link
                        href={transportPath("imports?tab=errors")}
                        prefetch={false}
                        className="text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline"
                    >
                        View in Imports →
                    </Link>
                </div>
                {total === 0 ? (
                    <p className="text-sm text-gray-500">No import warnings or issues recorded.</p>
                ) : (
                    <ul className="space-y-1.5">
                        {entries.map((entry) => (
                            <li
                                key={entry.key}
                                className="flex items-center justify-between gap-3 text-sm"
                            >
                                <span className="text-gray-700">{entry.label}</span>
                                <span className="font-medium tabular-nums text-gray-900">
                                    {entry.value.toLocaleString()}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

/** A count cell that highlights non-zero "needs fixing" values. */
function IssueCell({ value }: { readonly value: number }) {
    return (
        <td className="px-3 py-2 text-right tabular-nums">
            <span className={value > 0 ? "font-medium text-amber-700" : "text-gray-400"}>
                {value.toLocaleString()}
            </span>
        </td>
    );
}

/**
 * Read-only per-mode triage table. No links or fix actions — it only tells the
 * admin which modes have the most variants missing stops/path/direction.
 */
function QualitySummaryTable({ summary }: { readonly summary: TransportQualitySummary }) {
    const rows = [...summary.items].sort((a, b) => b.routes - a.routes);

    const totals: Omit<TransportQualitySummaryRow, "mode"> = rows.reduce(
        (acc, r) => ({
            routes: acc.routes + r.routes,
            variants: acc.variants + r.variants,
            variants_without_stops: acc.variants_without_stops + r.variants_without_stops,
            variants_without_path: acc.variants_without_path + r.variants_without_path,
            variants_unknown_direction:
                acc.variants_unknown_direction + r.variants_unknown_direction,
            routes_without_variants: acc.routes_without_variants + r.routes_without_variants,
        }),
        {
            routes: 0,
            variants: 0,
            variants_without_stops: 0,
            variants_without_path: 0,
            variants_unknown_direction: 0,
            routes_without_variants: 0,
        },
    );

    return (
        <Card>
            <CardContent className="p-0">
                {rows.length === 0 ? (
                    <p className="p-5 text-sm text-gray-500">No routes to summarise.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                                    <th className="px-3 py-2 text-left font-medium">Mode</th>
                                    <th className="px-3 py-2 text-right font-medium">Routes</th>
                                    <th className="px-3 py-2 text-right font-medium">Variants</th>
                                    <th className="px-3 py-2 text-right font-medium">No stops</th>
                                    <th className="px-3 py-2 text-right font-medium">No path</th>
                                    <th className="px-3 py-2 text-right font-medium">
                                        Unknown direction
                                    </th>
                                    <th className="px-3 py-2 text-right font-medium">No variants</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {rows.map((row) => (
                                    <tr key={row.mode} className="text-gray-700">
                                        <td className="px-3 py-2 font-medium text-gray-900">
                                            {modeLabel(row.mode)}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            {row.routes.toLocaleString()}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            {row.variants.toLocaleString()}
                                        </td>
                                        <IssueCell value={row.variants_without_stops} />
                                        <IssueCell value={row.variants_without_path} />
                                        <IssueCell value={row.variants_unknown_direction} />
                                        <IssueCell value={row.routes_without_variants} />
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t border-gray-200 font-medium text-gray-900">
                                    <td className="px-3 py-2">Total</td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        {totals.routes.toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        {totals.variants.toLocaleString()}
                                    </td>
                                    <IssueCell value={totals.variants_without_stops} />
                                    <IssueCell value={totals.variants_without_path} />
                                    <IssueCell value={totals.variants_unknown_direction} />
                                    <IssueCell value={totals.routes_without_variants} />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default function TransportOverviewPage() {
    const [data, setData] = useState<TransportOverview | null>(null);
    const [quality, setQuality] = useState<TransportDataQualityQueues | null>(null);
    const [qualitySummary, setQualitySummary] = useState<TransportQualitySummary | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError("");
        try {
            const init = signal ? { signal } : undefined;
            const [overview, queues, summary] = await Promise.all([
                getTransportOverview(init),
                getTransportDataQualityQueues(init),
                getTransportQualitySummary(init),
            ]);
            setData(overview);
            setQuality(queues);
            setQualitySummary(summary);
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to load transport overview.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    if (loading) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-7xl rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
                    Loading transport overview…
                </div>
            </main>
        );
    }

    if (error) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-7xl space-y-4">
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            void load();
                        }}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
                    >
                        Retry
                    </button>
                </div>
            </main>
        );
    }

    if (!data || !quality) {
        return null;
    }

    const countCards: CountCard[] = [
        { title: "Routes", value: data.counts.routes },
        { title: "Variants", value: data.counts.routeVariants },
        { title: "Route paths", value: data.counts.routePaths },
        { title: "Route stop rows", value: data.counts.routeStops },
        { title: "Stops", value: data.counts.stops },
        { title: "Terminals", value: data.counts.terminals },
        { title: "Infrastructure lines", value: data.counts.infrastructureLines },
        { title: "Import Warnings / Issues", value: data.counts.importErrors },
    ];

    const qualityGroups = buildQualityGroups(quality);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-8">
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Transport</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Network data counts and review queues. Each quality card opens the
                            relevant list — fix data there, not here.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            void load();
                        }}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
                    >
                        Refresh
                    </button>
                </header>

                {!data.schemaAvailable ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        Transport tables are not available in the connected database. Counts are shown
                        as zero.
                    </div>
                ) : null}

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-gray-900">Counts</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {countCards.map((card) => (
                            <StatsCard key={card.title} title={card.title} value={card.value} />
                        ))}
                    </div>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-gray-900">By mode</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <ModeBreakdown title="Routes by mode" counts={data.byMode.routes} />
                        <ModeBreakdown title="Stops by mode" counts={data.byMode.stops} />
                        <ModeBreakdown title="Terminals by mode" counts={data.byMode.terminals} />
                        <ModeBreakdown
                            title="Infrastructure by mode"
                            counts={data.byMode.infrastructureLines}
                        />
                    </div>
                </section>

                {qualitySummary ? (
                    <section className="space-y-3">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                                Quality summary by mode
                            </h2>
                            <p className="text-sm text-gray-600">
                                Read-only triage. Highlighted counts show variants/routes that
                                likely need attention — fix them in the route detail page.
                            </p>
                        </div>
                        <QualitySummaryTable summary={qualitySummary} />
                    </section>
                ) : null}

                {qualityGroups.map((group) => (
                    <QueueGroupSection key={group.heading} group={group} />
                ))}

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-gray-900">Imports</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <ImportIssuesBreakdown
                            issues={data.importIssues}
                            total={data.counts.importErrors}
                        />
                    </div>
                </section>
            </div>
        </main>
    );
}
