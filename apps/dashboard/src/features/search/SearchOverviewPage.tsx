"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { Card, CardContent } from "@/src/components/ui/card";
import { isAbortError } from "@/src/lib/api";
import { searchPath } from "@/src/lib/dashboardNavigation";

import { getSearchOverview } from "./api";
import type { SearchIndexHealthSeverity, SearchOverviewSummary } from "./types";

type SectionLink = {
    title: string;
    description: string;
    href: string;
    status: "available" | "planned";
};

const SECTION_LINKS: readonly SectionLink[] = [
    {
        title: "Documents",
        description: "Browse unified search index rows and canonical names.",
        href: searchPath("documents"),
        status: "available",
    },
    {
        title: "Aliases",
        description: "Manage search-only alternative names for indexed entities.",
        href: searchPath("aliases"),
        status: "available",
    },
    {
        title: "Failed Searches",
        description: "Review zero-result queries to improve coverage and aliases.",
        href: searchPath("failed-searches"),
        status: "available",
    },
    {
        title: "Analytics",
        description: "Search usage trends, language mix, and ranking diagnostics.",
        href: searchPath("analytics"),
        status: "available",
    },
    {
        title: "Index Health",
        description: "Compare canonical source rows vs indexed search documents.",
        href: searchPath("index-health"),
        status: "available",
    },
];

export default function SearchOverviewPage() {
    const [overview, setOverview] = useState<SearchOverviewSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError("");
        try {
            const summary = await getSearchOverview(signal ? { signal } : undefined);
            setOverview(summary);
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to load search overview.");
            setOverview(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const allCountsZero =
        overview !== null &&
        overview.total_search_documents === 0 &&
        overview.total_aliases === 0 &&
        overview.active_aliases === 0 &&
        overview.unresolved_failed_searches === 0 &&
        overview.today_searches === 0;

    const healthStatusColor = getHealthStatusColor(
        overview?.overall_index_health_severity ?? null,
    );

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Search</h1>
                    <p className="mt-1 max-w-3xl text-sm text-gray-600">
                        Unified search index management for the public map. Canonical entity names stay
                        in core data; aliases and index tooling live here.
                    </p>
                </header>

                {error ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        <span>{error}</span>
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 shadow-sm hover:bg-red-50"
                        >
                            Retry
                        </button>
                    </div>
                ) : null}

                <section aria-labelledby="search-overview-metrics">
                    <h2 id="search-overview-metrics" className="mb-3 text-lg font-semibold text-gray-900">
                        Available metrics
                    </h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <StatsCard
                            title="Indexed documents"
                            value={loading ? "…" : (overview?.total_search_documents ?? "—")}
                            description="Rows in search.search_documents"
                        />
                        <StatsCard
                            title="Search aliases"
                            value={loading ? "…" : (overview?.total_aliases ?? "—")}
                            description="All rows in search.search_aliases"
                        />
                        <StatsCard
                            title="Active aliases"
                            value={loading ? "…" : (overview?.active_aliases ?? "—")}
                            description="Aliases folded into the live search index"
                            statusColor="success"
                        />
                        <StatsCard
                            title="Unresolved failures"
                            value={loading ? "…" : (overview?.unresolved_failed_searches ?? "—")}
                            description="Open zero-result search logs"
                            statusColor={
                                overview && overview.unresolved_failed_searches > 0
                                    ? "warning"
                                    : "default"
                            }
                        />
                        <StatsCard
                            title="Searches today"
                            value={loading ? "…" : (overview?.today_searches ?? "—")}
                            description="Recorded public search requests since local day start"
                        />
                        <StatsCard
                            title="Index health"
                            value={
                                loading
                                    ? "…"
                                    : (overview?.overall_index_health_severity ?? "—")
                            }
                            description="Overall severity from index health"
                            statusColor={healthStatusColor}
                        />
                    </div>
                    {!loading && !error && allCountsZero ? (
                        <p className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
                            Search overview loaded successfully; no indexed search data has been
                            recorded yet.
                        </p>
                    ) : null}
                </section>

                <section aria-labelledby="search-overview-sections">
                    <h2 id="search-overview-sections" className="mb-3 text-lg font-semibold text-gray-900">
                        Sections
                    </h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {SECTION_LINKS.map((section) => (
                            <Link key={section.href} href={section.href} className="group block">
                                <Card className="h-full transition-shadow group-hover:shadow-md">
                                    <CardContent className="space-y-2 p-5">
                                        <div className="flex items-start justify-between gap-3">
                                            <h3 className="text-sm font-semibold text-gray-900">
                                                {section.title}
                                            </h3>
                                            <span
                                                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                                                    section.status === "available"
                                                        ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
                                                        : "bg-gray-100 text-gray-600 ring-gray-200"
                                                }`}
                                            >
                                                {section.status === "available" ? "Available" : "Planned"}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-600">{section.description}</p>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    );
}

function getHealthStatusColor(
    severity: SearchIndexHealthSeverity | null,
): "default" | "success" | "warning" | "danger" {
    if (severity === "healthy") return "success";
    if (severity === "warning") return "warning";
    if (severity === "critical") return "danger";
    return "default";
}
