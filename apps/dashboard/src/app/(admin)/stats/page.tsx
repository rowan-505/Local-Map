"use client";

import { useCallback, useEffect, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import {
    getDashboardStats,
    isAbortError,
    type DashboardStatsResponse,
} from "@/src/lib/api";

function SectionTitle({
    title,
    subtitle,
    id,
}: {
    title: string;
    subtitle?: string;
    id?: string;
}) {
    return (
        <div className="mb-4">
            <h2
                id={id}
                className="text-lg font-semibold tracking-tight text-gray-900"
            >
                {title}
            </h2>
            {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
        </div>
    );
}

export default function StatsPage() {
    const [data, setData] = useState<DashboardStatsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const load = useCallback(async (signal?: AbortSignal) => {
        setIsLoading(true);
        setError("");

        try {
            const response = await getDashboardStats(signal ? { signal } : undefined);
            setData(response);
            setLastUpdated(new Date());
        } catch (err) {
            if (isAbortError(err)) {
                return;
            }

            setError(err instanceof Error ? err.message : "Failed to load statistics.");
            setData(null);
            setLastUpdated(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    if (isLoading) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-7xl rounded-lg border border-gray-200 bg-white p-6 text-gray-700 shadow-sm">
                    Loading statistics...
                </div>
            </main>
        );
    }

    if (error) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-7xl">
                    <h1 className="mb-4 text-2xl font-bold text-gray-900">Statistics</h1>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">{error}</div>
                </div>
            </main>
        );
    }

    if (!data) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-7xl rounded-lg border border-gray-200 bg-white p-6 text-gray-600 shadow-sm">
                    No statistics available.
                </div>
            </main>
        );
    }

    const { overview, main, metadata, transit, health } = data;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-12">
                <header className="border-b border-gray-200 pb-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Statistics</h1>
                            <p className="mt-1 max-w-2xl text-sm text-gray-600">
                                Row counts and health splits from the API. Figures reflect the database
                                at fetch time.
                            </p>
                        </div>
                        {lastUpdated ? (
                            <div className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                                <span className="text-gray-500">Last updated </span>
                                <time
                                    dateTime={lastUpdated.toISOString()}
                                    className="font-medium text-gray-900"
                                >
                                    {lastUpdated.toLocaleString()}
                                </time>
                            </div>
                        ) : null}
                    </div>
                </header>

                <section aria-labelledby="stats-overview-heading">
                    <SectionTitle
                        title="Overview"
                        id="stats-overview-heading"
                        subtitle="Rollups across primary entity groups."
                    />
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <StatsCard
                            title="Total main rows"
                            value={overview.total_main_rows}
                            description="Sum of places, buildings, streets, admin areas, and addresses."
                        />
                        <StatsCard
                            title="Total metadata rows"
                            value={overview.total_metadata_rows}
                            description="Names, contacts, sources, media, and version records."
                        />
                        <StatsCard
                            title="Total transit rows"
                            value={overview.total_transit_rows}
                            description="Routes, variants, stops, and route-stop links."
                        />
                    </div>
                </section>

                <section aria-labelledby="stats-main-heading">
                    <SectionTitle
                        title="Main Map Data"
                        id="stats-main-heading"
                        subtitle="Core geographic and boundary entities."
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                        <StatsCard title="Places" value={main.places} description="core.core_places" />
                        <StatsCard
                            title="Map buildings"
                            value={main.map_buildings}
                            description="core.core_map_buildings"
                        />
                        <StatsCard title="Streets" value={main.streets} description="core.core_streets" />
                        <StatsCard
                            title="Admin areas"
                            value={main.admin_areas}
                            description="core.core_admin_areas"
                        />
                        <StatsCard
                            title="Addresses"
                            value={main.addresses}
                            description="core.core_addresses"
                        />
                    </div>
                </section>

                <section aria-labelledby="stats-metadata-heading">
                    <SectionTitle
                        title="Names & Metadata"
                        id="stats-metadata-heading"
                        subtitle="Supporting names and ancillary place records."
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        <StatsCard
                            title="Place names"
                            value={metadata.place_names}
                            description="core.core_place_names"
                        />
                        <StatsCard
                            title="Street names"
                            value={metadata.street_names}
                            description="core.core_street_names"
                        />
                        <StatsCard
                            title="Admin area names"
                            value={metadata.admin_area_names}
                            description="core.core_admin_area_names"
                        />
                        <StatsCard
                            title="Place contacts"
                            value={metadata.place_contacts}
                            description="core.core_place_contacts"
                        />
                        <StatsCard
                            title="Place sources"
                            value={metadata.place_sources}
                            description="core.core_place_sources"
                        />
                        <StatsCard
                            title="Place media"
                            value={metadata.place_media}
                            description="core.core_place_media"
                        />
                        <StatsCard
                            title="Place versions"
                            value={metadata.place_versions}
                            description="core.core_place_versions"
                        />
                    </div>
                </section>

                <section aria-labelledby="stats-transit-heading">
                    <SectionTitle
                        title="Transit"
                        id="stats-transit-heading"
                        subtitle="Bus routes, variants, stops, and stop sequences."
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <StatsCard
                            title="Bus routes"
                            value={transit.bus_routes}
                            description="core.core_bus_routes"
                        />
                        <StatsCard
                            title="Route variants"
                            value={transit.bus_route_variants}
                            description="core.core_bus_route_variants"
                        />
                        <StatsCard
                            title="Bus stops"
                            value={transit.bus_stops}
                            description="core.core_bus_stops"
                        />
                        <StatsCard
                            title="Route stops"
                            value={transit.bus_route_stops}
                            description="core.core_bus_route_stops"
                        />
                    </div>
                </section>

                <section aria-labelledby="stats-health-heading">
                    <SectionTitle
                        title="Data Health"
                        id="stats-health-heading"
                        subtitle="Active, deleted, and verification splits where applicable."
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <StatsCard
                            title="Places (active)"
                            value={health.places_active}
                            description="deleted_at IS NULL"
                            statusColor="success"
                        />
                        <StatsCard
                            title="Places (deleted)"
                            value={health.places_deleted}
                            description="Soft-deleted rows"
                            statusColor="danger"
                        />
                        <StatsCard
                            title="Places (verified)"
                            value={health.places_verified}
                            description="Non-deleted & verified"
                            statusColor="success"
                        />
                        <StatsCard
                            title="Places (unverified)"
                            value={health.places_unverified}
                            description="Non-deleted & not verified"
                            statusColor="warning"
                        />
                        <StatsCard
                            title="Buildings (active)"
                            value={health.buildings_active}
                            description="Not deleted & active"
                            statusColor="success"
                        />
                        <StatsCard
                            title="Buildings (deleted)"
                            value={health.buildings_deleted}
                            statusColor="danger"
                        />
                        <StatsCard
                            title="Streets (active)"
                            value={health.streets_active}
                            statusColor="success"
                        />
                        <StatsCard
                            title="Streets (inactive)"
                            value={health.streets_inactive}
                            statusColor="warning"
                        />
                    </div>
                </section>
            </div>
        </main>
    );
}
