"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BUILDINGS_LIST_LIMIT, getBuildings, type Building } from "@/src/lib/api";

function dash(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
        return "-";
    }

    if (typeof value === "string" && value.trim() === "") {
        return "-";
    }

    return String(value);
}

function formatDate(value: string | null | undefined): string {
    if (value === null || value === undefined || value.trim() === "") {
        return "-";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return date.toLocaleString();
}

function formatArea(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "-";
    }

    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function BuildingsPage() {
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");

    const loadBuildings = useCallback(async () => {
        setIsLoading(true);
        setError("");

        try {
            const data = await getBuildings({ limit: BUILDINGS_LIST_LIMIT });
            setBuildings(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load buildings");
            setBuildings([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadBuildings();
    }, [loadBuildings]);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Buildings</h1>
                        {!isLoading && !error ? (
                            <p className="mt-1 text-sm text-gray-600">
                                Returned {buildings.length} building{buildings.length === 1 ? "" : "s"}
                            </p>
                        ) : null}
                    </div>
                    <Link
                        href="/buildings/new"
                        className="rounded bg-gray-900 px-4 py-2 text-sm text-white"
                    >
                        Add Building
                    </Link>
                </div>

                {isLoading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
                        Loading buildings...
                    </div>
                ) : null}

                {!isLoading && error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">{error}</div>
                ) : null}

                {!isLoading && !error ? (
                    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                                <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
                                    <tr>
                                        <th className="px-4 py-3 font-medium">id</th>
                                        <th className="px-4 py-3 font-medium">name</th>
                                        <th className="px-4 py-3 font-medium">building_type</th>
                                        <th className="px-4 py-3 font-medium">area_m2</th>
                                        <th className="px-4 py-3 font-medium">levels</th>
                                        <th className="px-4 py-3 font-medium">confidence_score</th>
                                        <th className="px-4 py-3 font-medium">is_verified</th>
                                        <th className="px-4 py-3 font-medium">updated_at</th>
                                        <th className="px-4 py-3 font-medium"> </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {buildings.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="px-4 py-6 text-center text-gray-500">
                                                No buildings found.
                                            </td>
                                        </tr>
                                    ) : (
                                        buildings.map((building) => (
                                            <tr key={building.id} className="text-gray-900">
                                                <td className="px-4 py-3 font-mono text-xs">{dash(building.id)}</td>
                                                <td className="px-4 py-3">{dash(building.name)}</td>
                                                <td className="px-4 py-3">{dash(building.building_type)}</td>
                                                <td className="px-4 py-3">{formatArea(building.area_m2)}</td>
                                                <td className="px-4 py-3">{dash(building.levels)}</td>
                                                <td className="px-4 py-3">{dash(building.confidence_score)}</td>
                                                <td className="px-4 py-3">{building.is_verified ? "true" : "false"}</td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    {formatDate(building.updated_at)}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <Link
                                                        href={`/buildings/${building.public_id}/edit`}
                                                        className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                                                    >
                                                        Edit
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : null}
            </div>
        </main>
    );
}
