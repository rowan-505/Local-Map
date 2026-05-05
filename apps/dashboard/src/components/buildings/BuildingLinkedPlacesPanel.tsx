"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
    getLinkedPlacesForBuilding,
    unlinkBuildingFromPlace,
    type LinkedPlaceSummaryApi,
} from "@/src/lib/api";

type BuildingLinkedPlacesPanelProps = {
    buildingPublicId: string;
};

function dash(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return "-";
    }

    if (typeof value === "string" && value.trim() === "") {
        return "-";
    }

    if (typeof value === "boolean") {
        return value ? "yes" : "no";
    }

    return String(value);
}

function placeDisplayName(place: LinkedPlaceSummaryApi["place"]): string {
    const d = place.display_name?.trim();
    if (d) {
        return d;
    }

    const p = place.primary_name?.trim();

    return p ?? "-";
}

export default function BuildingLinkedPlacesPanel({ buildingPublicId }: BuildingLinkedPlacesPanelProps) {
    const [items, setItems] = useState<LinkedPlaceSummaryApi[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [unlinkBusyId, setUnlinkBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError("");

        try {
            const res = await getLinkedPlacesForBuilding(buildingPublicId);
            setItems(res.items);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load linked POIs");
            setItems([]);
        } finally {
            setIsLoading(false);
        }
    }, [buildingPublicId]);

    useEffect(() => {
        void load();
    }, [load]);

    const onUnlink = useCallback(
        async (placePublicId: string) => {
            setUnlinkBusyId(placePublicId);
            try {
                await unlinkBuildingFromPlace(placePublicId, buildingPublicId);
                setError("");
                setItems((prev) => prev.filter((row) => row.place.public_id !== placePublicId));
            } catch (err) {
                setError(err instanceof Error ? err.message : "Unlink failed");
            } finally {
                setUnlinkBusyId(null);
            }
        },
        [buildingPublicId]
    );

    return (
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
                <h2 className="text-lg font-semibold text-gray-900">Linked POIs</h2>
                <p className="mt-1 text-sm text-gray-600">
                    These places are linked to this building via the junction table. Unlink only removes that
                    association—it does not delete the POI.
                </p>
            </div>

            {error ? (
                <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
            ) : null}

            <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-700">
                        <tr>
                            <th className="px-4 py-3 font-medium">name</th>
                            <th className="px-4 py-3 font-medium">category</th>
                            <th className="px-4 py-3 font-medium">relation_type</th>
                            <th className="px-4 py-3 font-medium">is_primary</th>
                            <th className="px-4 py-3 font-medium"> </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {isLoading ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                                    Loading linked POIs…
                                </td>
                            </tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                                    No linked POIs.
                                </td>
                            </tr>
                        ) : (
                            items.map((row) => {
                                const pid = row.place.public_id;
                                const busy = unlinkBusyId === pid;

                                return (
                                    <tr key={pid} className="text-gray-900">
                                        <td className="px-4 py-3">{placeDisplayName(row.place)}</td>
                                        <td className="px-4 py-3">{dash(row.place.category_name)}</td>
                                        <td className="px-4 py-3 font-mono text-xs">{dash(row.relation_type)}</td>
                                        <td className="px-4 py-3">{row.is_primary ? "yes" : "no"}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Link
                                                    href={`/places?editPlace=${encodeURIComponent(pid)}`}
                                                    className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                                                >
                                                    Edit POI
                                                </Link>
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => void onUnlink(pid)}
                                                    className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                                                >
                                                    {busy ? "Unlinking…" : "Unlink"}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
