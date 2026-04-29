"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import PlacePreviewMap from "@/src/components/map/PlacePreviewMap";
import PlaceEditModal from "@/src/components/places/PlaceEditModal";
import { deletePlace, getPlaces, type Place } from "@/src/lib/api";

function formatDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

export default function PlacesPage() {
    const [places, setPlaces] = useState<Place[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);

    const loadPlaces = useCallback(async (selectedPublicId?: string) => {
        setIsLoading(true);
        setError("");

        try {
            const data = await getPlaces({ limit: 50 });
            setPlaces(data);

            const nextSelectedPlace =
                data.find((place) => place.public_id === selectedPublicId) ?? data[0] ?? null;

            setSelectedPlace(nextSelectedPlace);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load places");
            setSelectedPlace(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadPlaces();
    }, [loadPlaces]);

    useEffect(() => {
        const message = window.sessionStorage.getItem("placeCreateSuccess");

        if (!message) {
            return;
        }

        setSuccessMessage(message);
        window.sessionStorage.removeItem("placeCreateSuccess");
    }, []);

    return (
        <main className="min-h-screen bg-gray-100 p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h1 className="text-2xl font-bold text-gray-900">Places</h1>
                    <Link
                        href="/places/new"
                        className="rounded bg-gray-900 px-4 py-2 text-sm text-white"
                    >
                        Add Place
                    </Link>
                </div>

                {successMessage ? (
                    <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                        {successMessage}
                    </div>
                ) : null}

                {isLoading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
                        Loading places...
                    </div>
                ) : null}

                {!isLoading && error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
                        {error}
                    </div>
                ) : null}

                {!isLoading && !error ? (
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] lg:items-start">
                        <div className="rounded-lg border border-gray-200 bg-white shadow-sm lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
                            <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                                <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
                                    <tr>
                                        <th className="px-4 py-3 font-medium">Name</th>
                                        <th className="px-4 py-3 font-medium">Category</th>
                                        <th className="px-4 py-3 font-medium">Admin Area</th>
                                        <th className="px-4 py-3 font-medium">Lat</th>
                                        <th className="px-4 py-3 font-medium">Lng</th>
                                        <th className="px-4 py-3 font-medium">Verified</th>
                                        <th className="px-4 py-3 font-medium">Public</th>
                                        <th className="px-4 py-3 font-medium">Updated</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {places.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                                                No places found.
                                            </td>
                                        </tr>
                                    ) : (
                                        places.map((place) => {
                                            const isSelected =
                                                selectedPlace?.public_id === place.public_id;

                                            return (
                                                <tr
                                                    key={place.public_id}
                                                    onClick={() => setSelectedPlace(place)}
                                                    className={`cursor-pointer text-gray-900 ${
                                                        isSelected ? "bg-blue-50" : "hover:bg-gray-50"
                                                    }`}
                                                >
                                                    <td className="px-4 py-3">
                                                        {place.primary_name || place.display_name}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {place.category_name ?? "-"}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {place.admin_area_name ?? "-"}
                                                    </td>
                                                    <td className="px-4 py-3">{place.lat}</td>
                                                    <td className="px-4 py-3">{place.lng}</td>
                                                    <td className="px-4 py-3">
                                                        {place.is_verified ? "Yes" : "No"}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {place.is_public ? "Yes" : "No"}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {formatDate(place.updated_at)}
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
                                <h2 className="text-lg font-semibold text-gray-900">Place Details</h2>
                                {selectedPlace ? (
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsEditModalOpen(true)}
                                            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isDeleting}
                                            onClick={async () => {
                                                if (!selectedPlace) {
                                                    return;
                                                }

                                                const confirmed = window.confirm(
                                                    `Delete "${selectedPlace.primary_name || selectedPlace.display_name}"?`
                                                );

                                                if (!confirmed) {
                                                    return;
                                                }

                                                setIsDeleting(true);
                                                setError("");
                                                setSuccessMessage("");

                                                try {
                                                    await deletePlace(selectedPlace.public_id);
                                                    await loadPlaces();
                                                    setSuccessMessage("Place deleted successfully.");
                                                } catch (err) {
                                                    setError(
                                                        err instanceof Error
                                                            ? err.message
                                                            : "Failed to delete place"
                                                    );
                                                } finally {
                                                    setIsDeleting(false);
                                                }
                                            }}
                                            className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-60"
                                        >
                                            {isDeleting ? "Deleting..." : "Delete"}
                                        </button>
                                    </div>
                                ) : null}
                            </div>

                            <div className="mb-4">
                                <PlacePreviewMap selectedPlace={selectedPlace} />
                            </div>

                            {selectedPlace ? (
                                <div className="space-y-3 text-sm text-gray-700">
                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Name
                                        </div>
                                        <div className="mt-1 text-base font-medium text-gray-900">
                                            {selectedPlace.primary_name || selectedPlace.display_name}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Category
                                        </div>
                                        <div className="mt-1">{selectedPlace.category_name ?? "-"}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Admin Area
                                        </div>
                                        <div className="mt-1">{selectedPlace.admin_area_name ?? "-"}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Lat / Lng
                                        </div>
                                        <div className="mt-1">
                                            {selectedPlace.lat}, {selectedPlace.lng}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Status
                                        </div>
                                        <div className="mt-1">
                                            Verified: {selectedPlace.is_verified ? "Yes" : "No"}
                                        </div>
                                        <div>
                                            Public: {selectedPlace.is_public ? "Yes" : "No"}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">Select a place to view details.</p>
                            )}
                        </aside>
                    </div>
                ) : null}
            </div>

            <PlaceEditModal
                open={isEditModalOpen}
                placeId={selectedPlace?.public_id ?? null}
                onClose={() => setIsEditModalOpen(false)}
                onSaved={async (placeId) => {
                    await loadPlaces(placeId);
                }}
            />
        </main>
    );
}