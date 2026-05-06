"use client";

import Link from "next/link";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";

import BuildingPreviewMap from "@/src/components/map/BuildingPreviewMap";
import MapPreviewCard from "@/src/components/map/MapPreviewCard";
import {
    clearBuildingSelectionGeoJsonSources,
    debugLogDashboardBuildingFootprintLayers,
    MAP_BUILDINGS_VECTOR_SOURCE_ID,
    scheduleBuildingTileRefresh,
} from "@/src/components/map/placeMapConfig";
import { useBuildingTileVersion } from "@/src/components/map/BuildingTileVersionContext";

const IS_BUILDINGS_PAGE_DEV = process.env.NODE_ENV !== "production";
import {
    BUILDINGS_LIST_LIMIT,
    deleteBuilding,
    getBuilding,
    getBuildings,
    isAbortError,
    type Building,
} from "@/src/lib/api";

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

function hasUsableGeometry(b: Building): boolean {
    const g = b.geometry;
    if (!g) {
        return false;
    }

    if (g.type === "Polygon") {
        const ring = g.coordinates?.[0];
        return Array.isArray(ring) && ring.length > 0;
    }

    const firstPoly = g.coordinates?.[0];
    const firstRing = firstPoly?.[0];
    return Array.isArray(firstRing) && firstRing.length > 0;
}

function safeTechnicalClientMessage(raw: string, readableFallback: string): string {
    if (
        raw.length > 400 ||
        /\b(pg_|postgresql|prisma|P1012|syntax error at|violates|duplicate key value|permission denied for relation)\b/i.test(
            raw
        )
    ) {
        return readableFallback;
    }

    return raw;
}

export default function BuildingsPage() {
    const { bumpBuildingTileVersion } = useBuildingTileVersion();
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
    const [previewBuilding, setPreviewBuilding] = useState<Building | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);
    const buildingsPreviewMapRef = useRef<MaplibreMap | null>(null);

    const loadBuildings = useCallback(
        async (opts?: {
            signal?: AbortSignal;
            removedPublicId?: string;
            removedIndex?: number;
            quiet?: boolean;
        }): Promise<Building[] | null> => {
            if (!opts?.quiet) {
                setIsLoading(true);
            }

            setError("");

            try {
                const data = await getBuildings(
                    { limit: BUILDINGS_LIST_LIMIT },
                    opts?.signal ? { signal: opts.signal } : undefined
                );
                setBuildings(data);

                setSelectedBuilding((prev) => {
                    if (data.length === 0) {
                        return null;
                    }

                    if (opts?.removedPublicId != null) {
                        const nextIndex = Math.min(Math.max(opts.removedIndex ?? 0, 0), data.length - 1);
                        return data[nextIndex] ?? null;
                    }

                    if (prev) {
                        const stillThere = data.find((b) => b.public_id === prev.public_id);
                        if (stillThere) {
                            return stillThere;
                        }
                    }

                    return data[0];
                });

                return data;
            } catch (err) {
                if (isAbortError(err)) {
                    return null;
                }

                setError(
                    safeTechnicalClientMessage(
                        err instanceof Error ? err.message : "Failed to load buildings",
                        "Something went wrong while loading buildings."
                    )
                );
                setBuildings([]);
                setSelectedBuilding(null);

                return null;
            } finally {
                if (!opts?.quiet) {
                    setIsLoading(false);
                }
            }
        },
        []
    );

    useEffect(() => {
        const abort = new AbortController();
        void loadBuildings({ signal: abort.signal });
        return () => abort.abort();
    }, [loadBuildings]);

    useEffect(() => {
        if (!selectedBuilding) {
            setPreviewBuilding(null);
            setPreviewError("");
            setPreviewLoading(false);
            return;
        }

        if (hasUsableGeometry(selectedBuilding)) {
            setPreviewBuilding(selectedBuilding);
            setPreviewError("");
            setPreviewLoading(false);
            return;
        }

        const abort = new AbortController();

        setPreviewLoading(true);
        setPreviewError("");
        setPreviewBuilding(null);

        void getBuilding(selectedBuilding.public_id, { signal: abort.signal })
            .then((full) => {
                if (abort.signal.aborted) {
                    return;
                }
                setPreviewBuilding(full);
                if (!hasUsableGeometry(full)) {
                    setPreviewError("Building detail has no footprint geometry.");
                }
            })
            .catch((err) => {
                if (isAbortError(err)) {
                    return;
                }
                setPreviewBuilding(null);
                setPreviewError(
                    safeTechnicalClientMessage(
                        err instanceof Error ? err.message : "Failed to load building",
                        "Unable to load building details."
                    )
                );
            })
            .finally(() => {
                if (!abort.signal.aborted) {
                    setPreviewLoading(false);
                }
            });

        return () => abort.abort();
    }, [selectedBuilding]);

    const detail = previewBuilding ?? selectedBuilding;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h1 className="text-2xl font-bold text-gray-900">Buildings</h1>
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
                                            <th className="px-4 py-3 font-medium">Building type</th>
                                            <th className="px-4 py-3 font-medium">Area (m²)</th>
                                            <th className="px-4 py-3 font-medium">Levels</th>
                                            <th className="px-4 py-3 font-medium">Confidence</th>
                                            <th className="px-4 py-3 font-medium">Verified</th>
                                            <th className="px-4 py-3 font-medium">Updated</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {buildings.length === 0 ? (
                                            <tr>
                                                <td
                                                    colSpan={7}
                                                    className="px-4 py-6 text-center text-gray-500"
                                                >
                                                    No buildings found.
                                                </td>
                                            </tr>
                                        ) : (
                                            buildings.map((building) => {
                                                const isSelected =
                                                    selectedBuilding?.public_id === building.public_id;

                                                return (
                                                    <tr
                                                        key={building.public_id}
                                                        onClick={() => setSelectedBuilding(building)}
                                                        className={`cursor-pointer text-gray-900 ${
                                                            isSelected
                                                                ? "bg-blue-50"
                                                                : "hover:bg-gray-50"
                                                        }`}
                                                    >
                                                        <td
                                                            className="min-w-0 max-w-[min(100%,18rem)] wrap-break-word px-4 py-3 align-top"
                                                        >
                                                            {dash(building.name)}
                                                        </td>
                                                        <td className="px-4 py-3 align-top">
                                                            {dash(building.building_type)}
                                                        </td>
                                                        <td className="px-4 py-3 align-top whitespace-nowrap">
                                                            {formatArea(building.area_m2)}
                                                        </td>
                                                        <td className="px-4 py-3 align-top whitespace-nowrap">
                                                            {dash(building.levels)}
                                                        </td>
                                                        <td className="px-4 py-3 align-top whitespace-nowrap">
                                                            {dash(building.confidence_score)}
                                                        </td>
                                                        <td className="px-4 py-3 align-top whitespace-nowrap">
                                                            {building.is_verified ? "Yes" : "No"}
                                                        </td>
                                                        <td className="whitespace-nowrap px-4 py-3 align-top">
                                                            {formatDate(building.updated_at)}
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
                                <h2 className="text-lg font-semibold text-gray-900">Building Details</h2>
                                {detail ? (
                                    <div className="flex items-center gap-2">
                                        <Link
                                            href={`/buildings/${detail.public_id}/edit`}
                                            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700"
                                        >
                                            Edit
                                        </Link>
                                        <button
                                            type="button"
                                            disabled={isDeleting}
                                            onClick={async () => {
                                                if (!detail) {
                                                    return;
                                                }

                                                const confirmed = window.confirm(
                                                    "Delete this building?"
                                                );

                                                if (!confirmed) {
                                                    return;
                                                }

                                                setIsDeleting(true);
                                                setError("");

                                                const deletedId = detail.public_id;
                                                const deletedIndex = buildings.findIndex(
                                                    (b) => b.public_id === deletedId
                                                );

                                                try {
                                                    await deleteBuilding(deletedId);

                                                    const mapInstance = buildingsPreviewMapRef.current;

                                                    const geoSourcesCleared =
                                                        clearBuildingSelectionGeoJsonSources(
                                                            mapInstance
                                                        );

                                                    if (
                                                        IS_BUILDINGS_PAGE_DEV &&
                                                        typeof console.info === "function"
                                                    ) {
                                                        console.info("selected building GeoJSON cleared", {
                                                            sourcesCleared: geoSourcesCleared,
                                                        });
                                                    }

                                                    const tileVersion = bumpBuildingTileVersion();

                                                    const tilesRefreshed =
                                                        scheduleBuildingTileRefresh(
                                                            mapInstance,
                                                            tileVersion
                                                        );

                                                    if (
                                                        typeof window !== "undefined" &&
                                                        IS_BUILDINGS_PAGE_DEV
                                                    ) {
                                                        const w = window as Window & {
                                                            __buildingPreviewMap?: MaplibreMap;
                                                        };
                                                        const devMap = w.__buildingPreviewMap;

                                                        if (devMap && devMap !== mapInstance) {
                                                            clearBuildingSelectionGeoJsonSources(
                                                                devMap
                                                            );
                                                            scheduleBuildingTileRefresh(
                                                                devMap,
                                                                tileVersion
                                                            );
                                                        }
                                                    }

                                                    const filtered = buildings.filter(
                                                        (b) => b.public_id !== deletedId
                                                    );
                                                    const wasSelected =
                                                        selectedBuilding?.public_id === deletedId;

                                                    const nextSelected = wasSelected
                                                        ? filtered.length > 0
                                                            ? filtered[
                                                                  Math.min(
                                                                      Math.max(
                                                                          deletedIndex,
                                                                          0
                                                                      ),
                                                                      filtered.length - 1
                                                                  )
                                                              ] ?? null
                                                            : null
                                                        : selectedBuilding;

                                                    setPreviewLoading(false);
                                                    setPreviewBuilding(null);
                                                    setPreviewError("");
                                                    setBuildings(filtered);
                                                    setSelectedBuilding(nextSelected);

                                                    if (
                                                        IS_BUILDINGS_PAGE_DEV &&
                                                        typeof console.info === "function"
                                                    ) {
                                                        console.info("deleted building removed from state", {
                                                            deletedPublicId: deletedId,
                                                        });
                                                        if (wasSelected) {
                                                            console.info(
                                                                "selected building cleared after delete",
                                                                {
                                                                    nextPublicId:
                                                                        nextSelected?.public_id ??
                                                                        null,
                                                                }
                                                            );
                                                        }
                                                    }

                                                    await loadBuildings({
                                                        quiet: true,
                                                    });

                                                    debugLogDashboardBuildingFootprintLayers(mapInstance);

                                                    if (typeof console.debug === "function") {
                                                        console.debug("[buildings-page] delete footprint debug", {
                                                            deletedPublicId: deletedId,
                                                            nextSelectedPublicId:
                                                                nextSelected?.public_id ?? null,
                                                            buildingVectorSourceId:
                                                                MAP_BUILDINGS_VECTOR_SOURCE_ID,
                                                            selectionGeoSourcesCleared:
                                                                geoSourcesCleared,
                                                            vectorTilesRefreshSucceeded:
                                                                tilesRefreshed,
                                                            tilesTilesBuildingsVerifySql: `SELECT * FROM tiles.tiles_buildings_v WHERE public_id = '${deletedId}'::uuid`,
                                                        });
                                                    }
                                                } catch (err) {
                                                    setError(
                                                        safeTechnicalClientMessage(
                                                            err instanceof Error
                                                                ? err.message
                                                                : "Failed to delete building",
                                                            "Unable to delete the building."
                                                        )
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

                            <MapPreviewCard
                                className="mb-4"
                                loading={Boolean(detail) && previewLoading}
                                loadingLabel="Loading footprint…"
                                error={previewError || null}
                            >
                                <BuildingPreviewMap
                                    mapSurfaceRef={buildingsPreviewMapRef}
                                    geometry={previewBuilding?.geometry}
                                    emptyHint={
                                        buildings.length === 0
                                            ? "No buildings in the list."
                                            : detail
                                              ? "No geometry available for this building."
                                              : "Select a building from the list."
                                    }
                                />
                            </MapPreviewCard>

                            {detail ? (
                                <div className="space-y-3 text-sm text-gray-700">
                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Name
                                        </div>
                                        <div className="mt-1 text-base font-medium text-gray-900">
                                            {dash(detail.name)}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            building_type
                                        </div>
                                        <div className="mt-1">{dash(detail.building_type)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            area_m2
                                        </div>
                                        <div className="mt-1">{formatArea(detail.area_m2)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            levels
                                        </div>
                                        <div className="mt-1">{dash(detail.levels)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            confidence_score
                                        </div>
                                        <div className="mt-1">{dash(detail.confidence_score)}</div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            is_verified
                                        </div>
                                        <div className="mt-1">
                                            {detail.is_verified ? "Yes" : "No"}
                                        </div>
                                    </div>
                                </div>
                            ) : buildings.length === 0 ? (
                                <p className="text-sm text-gray-500">No buildings in the list.</p>
                            ) : (
                                <p className="text-sm text-gray-500">
                                    Select a building to view details.
                                </p>
                            )}
                        </aside>
                    </div>
                ) : null}
            </div>
        </main>
    );
}
