"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { Card, CardContent } from "@/src/components/ui/card";
import { isAbortError } from "@/src/lib/api";
import { searchPath } from "@/src/lib/dashboardNavigation";

import { listSearchAliases, listSearchDocuments } from "./api";

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
    const [aliasTotal, setAliasTotal] = useState<number | null>(null);
    const [activeAliasTotal, setActiveAliasTotal] = useState<number | null>(null);
    const [documentTotal, setDocumentTotal] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError("");
        try {
            const [all, active, documents] = await Promise.all([
                listSearchAliases({ page: 1, pageSize: 1 }, signal ? { signal } : undefined),
                listSearchAliases(
                    { page: 1, pageSize: 1, is_active: true },
                    signal ? { signal } : undefined,
                ),
                listSearchDocuments({ page: 1, pageSize: 1 }, signal ? { signal } : undefined),
            ]);
            setAliasTotal(all.total);
            setActiveAliasTotal(active.total);
            setDocumentTotal(documents.total);
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to load search overview.");
            setAliasTotal(null);
            setActiveAliasTotal(null);
            setDocumentTotal(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

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
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                <section aria-labelledby="search-overview-metrics">
                    <h2 id="search-overview-metrics" className="mb-3 text-lg font-semibold text-gray-900">
                        Available metrics
                    </h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <StatsCard
                            title="Search aliases"
                            value={loading ? "…" : aliasTotal ?? "—"}
                            description="All rows in search.search_aliases"
                        />
                        <StatsCard
                            title="Active aliases"
                            value={loading ? "…" : activeAliasTotal ?? "—"}
                            description="Aliases folded into the live search index"
                            statusColor="success"
                        />
                        <StatsCard
                            title="Indexed documents"
                            value={loading ? "…" : (documentTotal ?? "—")}
                            description="Rows in search.search_documents (first page total)"
                        />
                    </div>
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
