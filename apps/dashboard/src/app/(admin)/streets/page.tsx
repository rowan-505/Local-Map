"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import DataTableToolbar, {
    type DataTableArrange,
    type DataTableSortOption,
} from "@/src/components/dashboard/DataTableToolbar";
import HighlightMatch from "@/src/components/dashboard/HighlightMatch";
import MapPreviewCard from "@/src/components/map/MapPreviewCard";
import StreetPreviewMap from "@/src/components/map/StreetPreviewMap";
import { listApiSortOrder } from "@/src/lib/listToolbarSortOrder";
import {
    deleteStreet,
    getStreet,
    getStreets,
    isAbortError,
    type Street,
    type StreetDetail,
} from "@/src/lib/api";
import { DASHBOARD_STREET_MVT_SESSION_BUST_KEY } from "@/src/components/map/placeMapConfig";
import { useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";

const STREETS_SORT_OPTIONS: DataTableSortOption[] = [
    { value: "name", label: "Name", type: "text" },
    { value: "admin_area", label: "Admin Area", type: "text" },
    { value: "created", label: "Created Date", type: "date" },
    { value: "updated_at", label: "Updated Date", type: "date" },
];

function formatDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

function dash(value: string | null | undefined): string {
    const trimmed = value?.trim();
    return trimmed ? trimmed : "-";
}

function yesNo(value: boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return "-";
    }

    return value ? "Yes" : "No";
}

function roadClassLabel(street: Pick<Street, "road_class" | "road_class_name">): string {
    if (street.road_class_name && street.road_class && street.road_class_name !== street.road_class) {
        return `${street.road_class_name} (${street.road_class})`;
    }

    return dash(street.road_class_name ?? street.road_class);
}

export default function StreetsPage() {
    const { bumpStreetTileVersion, bumpRoadLabelTileVersion } = useDashboardTileVersions();
    const [streets, setStreets] = useState<Street[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedStreet, setSelectedStreet] = useState<StreetDetail | null>(null);
    const [isDetailLoading, setIsDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState("");
    const [streetDeleteBusy, setStreetDeleteBusy] = useState(false);
    /** Timestamp passed to preview map MVT `?v=` after delete / returning from edit delete (sessionStorage). */
    const [streetMvtCacheVersion, setStreetMvtCacheVersion] = useState(0);

    const [listSearch, setListSearch] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("updated_at");
    const [arrange, setArrange] = useState<DataTableArrange>("newest");
    const [includeDeleted, setIncludeDeleted] = useState(false);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(DASHBOARD_STREET_MVT_SESSION_BUST_KEY);
            if (!raw) {
                return;
            }
            sessionStorage.removeItem(DASHBOARD_STREET_MVT_SESSION_BUST_KEY);
            const parsed = Number(raw);
            const version = Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
            setStreetMvtCacheVersion(version);
            bumpStreetTileVersion();
            bumpRoadLabelTileVersion();
        } catch {
            /* ignore private mode */
        }
    }, [bumpRoadLabelTileVersion, bumpStreetTileVersion]);

    const loadStreets = useCallback(
        async (selectedPublicId?: string, signal?: AbortSignal) => {
            setIsLoading(true);
            setError("");

            try {
                const data = await getStreets(
                    {
                        limit: 50,
                        ...(searchQuery !== "" ? { q: searchQuery } : {}),
                        sortBy,
                        sortOrder: listApiSortOrder(sortBy, arrange),
                        ...(includeDeleted ? { include_deleted: true } : {}),
                    },
                    signal ? { signal } : undefined
                );
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
                if (isAbortError(err)) {
                    return;
                }

                setError(err instanceof Error ? err.message : "Failed to load streets");
                setSelectedStreet(null);
            } finally {
                setIsLoading(false);
            }
        },
        [searchQuery, sortBy, arrange, includeDeleted]
    );

    function handleSearchSubmit() {
        setSearchQuery(listSearch.trim());
    }

    function handleSearchClear() {
        setListSearch("");
        setSearchQuery("");
    }

    useEffect(() => {
        const abort = new AbortController();
        void loadStreets(undefined, abort.signal);
        return () => abort.abort();
    }, [loadStreets]);

    useEffect(() => {
        const id = selectedStreet?.public_id;

        if (!id) {
            return;
        }

        if (selectedStreet?.deleted_at) {
            setIsDetailLoading(false);
            setDetailError("");
            return;
        }

        const streetFetchId = id;

        const abort = new AbortController();

        async function loadStreetDetail() {
            setIsDetailLoading(true);
            setDetailError("");

            try {
                const data = await getStreet(streetFetchId, { signal: abort.signal });

                if (!abort.signal.aborted) {
                    setSelectedStreet(data);
                }
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }

                setDetailError(
                    err instanceof Error ? err.message : "Failed to load street details"
                );
            } finally {
                if (!abort.signal.aborted) {
                    setIsDetailLoading(false);
                }
            }
        }

        void loadStreetDetail();

        return () => abort.abort();
    }, [selectedStreet?.public_id, selectedStreet?.deleted_at]);

    async function handleSoftDeleteStreet(street: Pick<Street, "public_id" | "canonical_name" | "deleted_at">) {
        const target = street.public_id;
        const label = street.canonical_name || target;

        if (!target || street.deleted_at) {
            return;
        }

        if (
            !window.confirm(
                label
                    ? `Soft-delete street “${label}”? It will be hidden from default lists.`
                    : "Soft-delete this street? It will be hidden from default lists.",
            )
        ) {
            return;
        }

        const reason = window.prompt("Optional note for the audit log (edit reason):")?.trim() ?? "";

        setStreetDeleteBusy(true);
        setDetailError("");

        try {
            await deleteStreet(target, reason.length > 0 ? { edit_reason: reason } : undefined);
            const version = bumpStreetTileVersion();
            bumpRoadLabelTileVersion();
            setStreetMvtCacheVersion(version);
            await loadStreets(target);
        } catch (error) {
            setDetailError(error instanceof Error ? error.message : "Failed to soft-delete street");
        } finally {
            setStreetDeleteBusy(false);
        }
    }

    async function handleSoftDeleteSelectedStreet() {
        if (!selectedStreet) {
            return;
        }

        await handleSoftDeleteStreet(selectedStreet);
    }

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
                    <>
                        <div className="mb-4">
                            <DataTableToolbar
                                searchValue={listSearch}
                                onSearchChange={setListSearch}
                                onSearchSubmit={handleSearchSubmit}
                                onSearchClear={handleSearchClear}
                                placeholder="Search streets in this table…"
                                sortBy={sortBy}
                                onSortByChange={setSortBy}
                                sortOptions={STREETS_SORT_OPTIONS}
                                arrange={arrange}
                                onArrangeChange={setArrange}
                                totalCount={streets.length}
                                filteredCount={streets.length}
                                onClearFilters={() => {
                                    handleSearchClear();
                                    setSortBy("updated_at");
                                    setArrange("newest");
                                    setIncludeDeleted(false);
                                }}
                            />
                            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={includeDeleted}
                                    onChange={(event) => {
                                        setIncludeDeleted(event.target.checked);
                                    }}
                                    className="rounded border-gray-300"
                                />
                                <span>Show soft-deleted streets</span>
                            </label>
                        </div>

                    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] lg:items-start">
                        <div className="min-h-0 rounded-lg border border-gray-200 bg-white shadow-sm lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-left text-sm">
                                    <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
                                        <tr>
                                            <th className="px-4 py-3 font-medium">Name</th>
                                            <th className="px-4 py-3 font-medium">Road class</th>
                                            <th className="px-4 py-3 font-medium">Surface</th>
                                            <th className="px-4 py-3 font-medium">One way</th>
                                            <th className="px-4 py-3 font-medium">Bridge</th>
                                            <th className="px-4 py-3 font-medium">Tunnel</th>
                                            <th className="px-4 py-3 font-medium">Admin area</th>
                                            <th className="px-4 py-3 font-medium">Updated at</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {streets.length === 0 ? (
                                            <tr>
                                                <td
                                                    colSpan={8}
                                                    className="px-4 py-6 text-center text-gray-500"
                                                >
                                                    {searchQuery
                                                        ? "No streets match your search."
                                                        : "No streets found."}
                                                </td>
                                            </tr>
                                        ) : (
                                            streets.map((street) => {
                                                const isSelected =
                                                    selectedStreet?.public_id === street.public_id;
                                                const updatedLabel = formatDate(street.updated_at);
                                                const isRowDeleted = Boolean(street.deleted_at);

                                                return (
                                                    <tr
                                                        key={street.public_id}
                                                        onClick={() => handleSelectStreet(street)}
                                                        className={`cursor-pointer text-gray-900 ${
                                                            isSelected ? "bg-blue-50" : "hover:bg-gray-50"
                                                        } ${isRowDeleted ? "opacity-75" : ""}`}
                                                    >
                                                        <td className="min-w-0 max-w-[min(100%,18rem)] wrap-break-word px-4 py-3 align-top">
                                                            <HighlightMatch
                                                                text={street.canonical_name || "-"}
                                                                query={searchQuery}
                                                            />
                                                        </td>
                                                        <td className="whitespace-nowrap px-4 py-3 align-top">
                                                            <HighlightMatch
                                                                text={roadClassLabel(street)}
                                                                query={searchQuery}
                                                            />
                                                        </td>
                                                        <td className="whitespace-nowrap px-4 py-3 align-top">
                                                            <HighlightMatch
                                                                text={dash(street.surface)}
                                                                query={searchQuery}
                                                            />
                                                        </td>
                                                        <td className="whitespace-nowrap px-4 py-3 align-top">
                                                            <HighlightMatch
                                                                text={yesNo(street.is_oneway)}
                                                                query={searchQuery}
                                                            />
                                                        </td>
                                                        <td className="whitespace-nowrap px-4 py-3 align-top">
                                                            <HighlightMatch
                                                                text={yesNo(street.bridge)}
                                                                query={searchQuery}
                                                            />
                                                        </td>
                                                        <td className="whitespace-nowrap px-4 py-3 align-top">
                                                            <HighlightMatch
                                                                text={yesNo(street.tunnel)}
                                                                query={searchQuery}
                                                            />
                                                        </td>
                                                        <td className="px-4 py-3 align-top">
                                                            <HighlightMatch
                                                                text={street.admin_area_name ?? "-"}
                                                                query={searchQuery}
                                                            />
                                                        </td>
                                                        <td className="whitespace-nowrap px-4 py-3 align-top">
                                                            <HighlightMatch
                                                                text={updatedLabel}
                                                                query={searchQuery}
                                                            />
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
                            <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
                                <h2 className="mr-auto text-lg font-semibold text-gray-900">Street Details</h2>
                                {selectedStreet && !selectedStreet.deleted_at ? (
                                    <>
                                        <Link
                                            href={`/streets/${selectedStreet.public_id}/edit`}
                                            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
                                        >
                                            Edit
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => void handleSoftDeleteSelectedStreet()}
                                            disabled={streetDeleteBusy || isDetailLoading}
                                            className="rounded border border-red-200 bg-white px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                                        >
                                            {streetDeleteBusy ? "Deleting…" : "Soft delete"}
                                        </button>
                                    </>
                                ) : selectedStreet?.deleted_at ? (
                                    <span className="text-xs font-medium text-amber-800">Soft-deleted</span>
                                ) : null}
                            </div>

                            <MapPreviewCard className="mb-4">
                                <StreetPreviewMap
                                    selectedStreet={selectedStreet}
                                    streetMvtCacheVersion={streetMvtCacheVersion}
                                />
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
                                            Road Class
                                        </div>
                                        <div className="mt-1">{roadClassLabel(selectedStreet)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Surface
                                        </div>
                                        <div className="mt-1">{dash(selectedStreet.surface)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            One-way
                                        </div>
                                        <div className="mt-1">{yesNo(selectedStreet.is_oneway)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Bridge
                                        </div>
                                        <div className="mt-1">{yesNo(selectedStreet.bridge)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Tunnel
                                        </div>
                                        <div className="mt-1">{yesNo(selectedStreet.tunnel)}</div>
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
                    </>
                ) : null}
            </div>

        </main>
    );
}
