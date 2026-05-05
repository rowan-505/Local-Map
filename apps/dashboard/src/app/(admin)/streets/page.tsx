"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import MapPreviewCard from "@/src/components/map/MapPreviewCard";
import StreetPreviewMap from "@/src/components/map/StreetPreviewMap";
import StreetEditModal from "@/src/components/streets/StreetEditModal";
import { getStreet, getStreets, type StreetDetail, type Street } from "@/src/lib/api";

function formatDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

export default function StreetsPage() {
    const [streets, setStreets] = useState<Street[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedStreet, setSelectedStreet] = useState<StreetDetail | null>(null);
    const [isDetailLoading, setIsDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState("");
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const loadStreets = useCallback(async (selectedPublicId?: string) => {
        setIsLoading(true);
        setError("");

        try {
            const data = await getStreets({ limit: 50 });
            setStreets(data);

            setSelectedStreet((current) => {
                const targetPublicId = selectedPublicId ?? current?.public_id ?? null;
                const matchedStreet = targetPublicId
                    ? data.find((street) => street.public_id === targetPublicId) ?? null
                    : null;

                if (matchedStreet) {
                    return current?.public_id === matchedStreet.public_id
                        ? {
                              ...matchedStreet,
                              source_type_id: current.source_type_id,
                          }
                        : (matchedStreet as StreetDetail);
                }

                if (current) {
                    return current;
                }

                return (data[0] as StreetDetail | undefined) ?? null;
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load streets");
            setSelectedStreet(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadStreets();
    }, [loadStreets]);

    useEffect(() => {
        const selectedStreetId = selectedStreet?.public_id;

        if (!selectedStreetId) {
            return;
        }

        const streetId = selectedStreetId;
        let isMounted = true;

        async function loadStreetDetail() {
            setIsDetailLoading(true);
            setDetailError("");

            try {
                const data = await getStreet(streetId);

                if (isMounted) {
                    setSelectedStreet(data);
                }
            } catch (err) {
                if (isMounted) {
                    setDetailError(
                        err instanceof Error ? err.message : "Failed to load street details"
                    );
                }
            } finally {
                if (isMounted) {
                    setIsDetailLoading(false);
                }
            }
        }

        void loadStreetDetail();

        return () => {
            isMounted = false;
        };
    }, [selectedStreet?.public_id]);

    function handleSelectStreet(street: Street) {
        setSelectedStreet((current) => ({
            ...street,
            source_type_id:
                current?.public_id === street.public_id ? current.source_type_id : undefined,
        }));
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h1 className="text-2xl font-bold text-gray-900">Streets</h1>
                    <Link
                        href="/streets/new"
                        className="rounded bg-gray-900 px-4 py-2 text-sm text-white"
                    >
                        Add Street
                    </Link>
                </div>

                {isLoading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
                        Loading streets...
                    </div>
                ) : null}

                {!isLoading && error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
                        {error}
                    </div>
                ) : null}

                {!isLoading && !error ? (
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] lg:items-start">
                        <div className="min-h-0 rounded-lg border border-gray-200 bg-white shadow-sm lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-left text-sm">
                                <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
                                    <tr>
                                        <th className="px-4 py-3 font-medium">Name</th>
                                        <th className="px-4 py-3 font-medium">Myanmar Name</th>
                                        <th className="px-4 py-3 font-medium">English Name</th>
                                        <th className="px-4 py-3 font-medium">Admin Area</th>
                                        <th className="px-4 py-3 font-medium">Active</th>
                                        <th className="px-4 py-3 font-medium">Updated</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {streets.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                                                No streets found.
                                            </td>
                                        </tr>
                                    ) : (
                                        streets.map((street) => {
                                            const isSelected =
                                                selectedStreet?.public_id === street.public_id;

                                            return (
                                                <tr
                                                    key={street.public_id}
                                                    onClick={() => handleSelectStreet(street)}
                                                    className={`cursor-pointer text-gray-900 ${
                                                        isSelected ? "bg-blue-50" : "hover:bg-gray-50"
                                                    }`}
                                                >
                                                    <td className="min-w-0 max-w-[min(100%,18rem)] wrap-break-word px-4 py-3 align-top">
                                                        {street.canonical_name || "-"}
                                                    </td>
                                                    <td className="px-4 py-3 align-top">
                                                        {street.myanmarName || "-"}
                                                    </td>
                                                    <td className="px-4 py-3 align-top">
                                                        {street.englishName || "-"}
                                                    </td>
                                                    <td className="px-4 py-3 align-top">
                                                        {street.admin_area_name ?? "-"}
                                                    </td>
                                                    <td className="px-4 py-3 align-top whitespace-nowrap">
                                                        {street.is_active ? "Yes" : "No"}
                                                    </td>
                                                    <td className="whitespace-nowrap px-4 py-3 align-top">
                                                        {formatDate(street.updated_at)}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                                </table>
                            </div>
                        </div>

                        <aside className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <h2 className="text-lg font-semibold text-gray-900">Street Details</h2>
                                {selectedStreet ? (
                                    <button
                                        type="button"
                                        onClick={() => setIsEditModalOpen(true)}
                                        className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700"
                                    >
                                        Edit
                                    </button>
                                ) : null}
                            </div>

                            <MapPreviewCard className="mb-4">
                                <StreetPreviewMap selectedStreet={selectedStreet} />
                            </MapPreviewCard>

                            {isDetailLoading ? (
                                <p className="mb-3 text-sm text-gray-500">Loading street details...</p>
                            ) : null}

                            {detailError ? (
                                <p className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                    {detailError}
                                </p>
                            ) : null}

                            {selectedStreet ? (
                                <div className="space-y-3 text-sm text-gray-700">
                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Name
                                        </div>
                                        <div className="mt-1 text-base font-medium text-gray-900">
                                            {selectedStreet.canonical_name || "-"}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Myanmar Name
                                        </div>
                                        <div className="mt-1">{selectedStreet.myanmarName || "-"}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            English Name
                                        </div>
                                        <div className="mt-1">{selectedStreet.englishName || "-"}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Public ID
                                        </div>
                                        <div className="mt-1 break-all">{selectedStreet.public_id}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Admin Area
                                        </div>
                                        <div className="mt-1">{selectedStreet.admin_area_name ?? "-"}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Admin Area ID
                                        </div>
                                        <div className="mt-1">{selectedStreet.admin_area_id ?? "-"}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Source Type ID
                                        </div>
                                        <div className="mt-1">{selectedStreet.source_type_id ?? "-"}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Active
                                        </div>
                                        <div className="mt-1">
                                            {selectedStreet.is_active ? "Yes" : "No"}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Created
                                        </div>
                                        <div className="mt-1">{formatDate(selectedStreet.created_at)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Updated
                                        </div>
                                        <div className="mt-1">{formatDate(selectedStreet.updated_at)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Geometry
                                        </div>
                                        <div className="mt-1">
                                            {selectedStreet.geometry ? selectedStreet.geometry.type : "No geometry"}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">Select a street to view details.</p>
                            )}
                        </aside>
                    </div>
                ) : null}
            </div>

            <StreetEditModal
                open={isEditModalOpen}
                streetId={selectedStreet?.public_id ?? null}
                onClose={() => setIsEditModalOpen(false)}
                onSaved={async (streetId) => {
                    await loadStreets(streetId);
                }}
            />
        </main>
    );
}
