"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MutableRefObject,
} from "react";
import type { FeatureCollection, Geometry } from "geojson";
import type { Map as MaplibreMap } from "maplibre-gl";

import { getGeometryBounds } from "@/src/components/core-review/geometry";
import { fitMapToReviewCandidate } from "@/src/components/map/dataReviewBasemap";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import {
    BUILDINGS_LIST_LIMIT,
    getBuilding,
    getBuildings,
    getLinkedBuildingsForPlace,
    linkBuildingToPlace,
    patchPlaceBuildingLink,
    unlinkBuildingFromPlace,
    type Building,
    type BuildingGeometry,
    type LinkedBuildingSummaryApi,
    type PlaceBuildingRelationType,
} from "@/src/lib/api";
import {
    clearPlaceLinkOverlays,
    ensurePlaceLinkMapLayers,
    setPlaceLinkSelected,
    type PlaceLinkSelectedProperties,
} from "@/src/lib/map/placeLinkedBuildingOverlays";

type PlaceLinkedBuildingsPanelProps = {
    placePublicId: string;
    placeLat: number;
    placeLng: number;
    /** When provided, building picks and highlights use the main place map instead of a panel map. */
    hostMapRef?: MutableRefObject<MaplibreMap | null>;
};

const RELATION_OPTIONS: PlaceBuildingRelationType[] = ["inside", "entrance", "nearby", "compound"];

/** Rough radius when search box is empty (sorted nearest first). */
const NEARBY_KM = 12;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const x =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatBuildingAdminCanonical(ref: Building["admin_area"]): string {
    const name = ref?.canonical_name?.trim();
    return name || "—";
}

function buildingDisplayLabel(building: {
    name?: string | null;
    building_type?: Building["building_type"];
    building_type_name?: string | null;
    building_type_code?: string | null;
    class_code?: string | null;
    public_id?: string;
}): string {
    return (
        building.name?.trim() ||
        `${building.building_type?.name ?? building.building_type_name ?? building.building_type_code ?? building.class_code ?? "Building"}`
    );
}

function buildingCentroid(
    geom: Building["geometry"] | null | undefined,
): { lng: number; lat: number } | null {
    if (!geom) {
        return null;
    }

    const ring =
        geom.type === "Polygon"
            ? geom.coordinates[0]
            : geom.coordinates[0]?.[0];

    if (!ring?.length) {
        return null;
    }

    let sumLng = 0;
    let sumLat = 0;
    let n = 0;

    for (const pair of ring) {
        const lng = pair[0];
        const lat = pair[1];
        if (typeof lng === "number" && typeof lat === "number") {
            sumLng += lng;
            sumLat += lat;
            n += 1;
        }
    }

    return n ? { lng: sumLng / n, lat: sumLat / n } : null;
}

function formatDistanceKm(km: number): string {
    if (km < 1) {
        return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(1)} km`;
}

function isBoundsOutsideViewport(
    map: MaplibreMap,
    bounds: [[number, number], [number, number]],
): boolean {
    const [[west, south], [east, north]] = bounds;
    const viewport = map.getBounds();
    return !viewport.contains([west, south]) || !viewport.contains([east, north]);
}

function emptySelectedFeatureCollection(): FeatureCollection<Geometry, PlaceLinkSelectedProperties> {
    return { type: "FeatureCollection", features: [] };
}

function resolveSelectedGeometry(
    pickedPublicId: string | null,
    pickedBuilding: Building | null,
    searchResults: Building[],
    linkedGeometries: Record<string, BuildingGeometry>,
): BuildingGeometry | null {
    if (!pickedPublicId) {
        return null;
    }

    return (
        pickedBuilding?.geometry ??
        searchResults.find((building) => building.public_id === pickedPublicId)?.geometry ??
        linkedGeometries[pickedPublicId] ??
        null
    );
}

function selectedBuildingToFeatureCollection(building: {
    public_id: string;
    geometry: BuildingGeometry;
}): FeatureCollection<Geometry, PlaceLinkSelectedProperties> {
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: { public_id: building.public_id },
                geometry: building.geometry as Geometry,
            },
        ],
    };
}

function runWhenPlaceLinkMapReady(map: MaplibreMap, run: () => void): void {
    const execute = () => {
        if (!map.isStyleLoaded()) {
            return;
        }
        if (!ensurePlaceLinkMapLayers(map)) {
            return;
        }
        run();
    };

    if (map.isStyleLoaded()) {
        execute();
        return;
    }

    map.once("load", execute);
}

export default function PlaceLinkedBuildingsPanel({
    placePublicId,
    placeLat,
    placeLng,
    hostMapRef,
}: PlaceLinkedBuildingsPanelProps) {
    const [linked, setLinked] = useState<LinkedBuildingSummaryApi[]>([]);
    const [linkedGeometries, setLinkedGeometries] = useState<Record<string, BuildingGeometry>>({});
    const [loadError, setLoadError] = useState("");
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState("");

    const [searchQ, setSearchQ] = useState("");
    const [searchBusy, setSearchBusy] = useState(false);
    const [searchResults, setSearchResults] = useState<Building[]>([]);

    const [pickedPublicId, setPickedPublicId] = useState<string | null>(null);
    const [pickedBuilding, setPickedBuilding] = useState<Building | null>(null);
    const [attachRelation, setAttachRelation] = useState<PlaceBuildingRelationType>("inside");
    const [attachAsPrimary, setAttachAsPrimary] = useState(false);

    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const placeCoordsRef = useRef({ lat: placeLat, lng: placeLng });
    const linkedGeometriesRef = useRef<Record<string, BuildingGeometry>>({});
    const candidateRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const clientMounted = useClientMounted();

    useEffect(() => {
        placeCoordsRef.current = { lat: placeLat, lng: placeLng };
    }, [placeLat, placeLng]);

    const loadLinked = useCallback(async () => {
        setLoadError("");

        try {
            const { items } = await getLinkedBuildingsForPlace(placePublicId);
            setLinked(items);
        } catch (error) {
            setLinked([]);
            setLoadError(error instanceof Error ? error.message : "Failed to load linked buildings");
        }
    }, [placePublicId]);

    useEffect(() => {
        void loadLinked();
    }, [loadLinked]);

    const linkedIds = useMemo(() => linked.map((l) => l.building.public_id), [linked]);

    const candidateDistances = useMemo(() => {
        const map = new Map<string, number>();
        for (const building of searchResults) {
            const centroid = buildingCentroid(building.geometry);
            if (!centroid) {
                continue;
            }
            map.set(
                building.public_id,
                haversineKm(placeLat, placeLng, centroid.lat, centroid.lng),
            );
        }
        return map;
    }, [placeLat, placeLng, searchResults]);

    useEffect(() => {
        linkedGeometriesRef.current = linkedGeometries;
    }, [linkedGeometries]);

    useEffect(() => {
        if (linked.length === 0) {
            setLinkedGeometries({});
            return;
        }

        let cancelled = false;
        const linkedPublicIds = linked.map((row) => row.building.public_id);

        void (async () => {
            const missing = linkedPublicIds.filter(
                (publicId) => !linkedGeometriesRef.current[publicId],
            );
            if (missing.length === 0) {
                setLinkedGeometries((prev) => {
                    const next: Record<string, BuildingGeometry> = {};
                    for (const publicId of linkedPublicIds) {
                        if (prev[publicId]) {
                            next[publicId] = prev[publicId];
                        }
                    }
                    return next;
                });
                return;
            }

            const fetched = await Promise.all(
                missing.map(async (publicId) => {
                    try {
                        const building = await getBuilding(publicId);
                        return building.geometry
                            ? ({ publicId, geometry: building.geometry } as const)
                            : null;
                    } catch {
                        return null;
                    }
                }),
            );

            if (cancelled) {
                return;
            }

            setLinkedGeometries((prev) => {
                const next: Record<string, BuildingGeometry> = {};
                for (const publicId of linkedPublicIds) {
                    if (prev[publicId]) {
                        next[publicId] = prev[publicId];
                    }
                }
                for (const row of fetched) {
                    if (row) {
                        next[row.publicId] = row.geometry;
                    }
                }
                return next;
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [linked]);

    const syncMapOverlays = useCallback(() => {
        const map = hostMapRef?.current ?? null;
        if (!map) {
            return;
        }

        runWhenPlaceLinkMapReady(map, () => {
            const selectedGeometry = resolveSelectedGeometry(
                pickedPublicId,
                pickedBuilding,
                searchResults,
                linkedGeometries,
            );

            if (pickedPublicId && selectedGeometry) {
                setPlaceLinkSelected(
                    map,
                    selectedBuildingToFeatureCollection({
                        public_id: pickedPublicId,
                        geometry: selectedGeometry,
                    }),
                );
            } else {
                setPlaceLinkSelected(map, emptySelectedFeatureCollection());
            }
        });
    }, [
        hostMapRef,
        linkedGeometries,
        pickedBuilding,
        pickedPublicId,
        searchResults,
    ]);

    useEffect(() => {
        if (!hostMapRef) {
            return;
        }
        syncMapOverlays();
    }, [hostMapRef, syncMapOverlays]);

    useEffect(() => {
        if (!hostMapRef) {
            return;
        }

        const map = hostMapRef.current;

        return () => {
            clearPlaceLinkOverlays(map);
        };
    }, [hostMapRef, placePublicId]);

    /** Debounced search */
    useEffect(() => {
        if (searchTimerRef.current) {
            clearTimeout(searchTimerRef.current);
        }

        const q = searchQ.trim();

        searchTimerRef.current = setTimeout(() => {
            void (async () => {
                setSearchBusy(true);

                try {
                    if (!q) {
                        const all = await getBuildings({ limit: BUILDINGS_LIST_LIMIT });
                        const near = all
                            .map((b) => {
                                const c = buildingCentroid(b.geometry);
                                if (!c) {
                                    return null;
                                }
                                return {
                                    building: b,
                                    km: haversineKm(placeLat, placeLng, c.lat, c.lng),
                                };
                            })
                            .filter(
                                (
                                    row,
                                ): row is {
                                    building: Building;
                                    km: number;
                                } => Boolean(row && row.km <= NEARBY_KM),
                            )
                            .sort((a, b) => a.km - b.km)
                            .slice(0, 25)
                            .map((row) => row.building);

                        setSearchResults(near);
                        return;
                    }

                    const hits = await getBuildings({ q, limit: 50 });
                    setSearchResults(hits);
                } catch {
                    setSearchResults([]);
                } finally {
                    setSearchBusy(false);
                }
            })();
        }, 280);

        return () => {
            if (searchTimerRef.current) {
                clearTimeout(searchTimerRef.current);
            }
        };
    }, [searchQ, placeLat, placeLng]);

    /** Load full geometry when picking from search list or map */
    useEffect(() => {
        if (!pickedPublicId) {
            setPickedBuilding(null);
            return;
        }

        let cancelled = false;

        void getBuilding(pickedPublicId).then((b) => {
            if (!cancelled) {
                setPickedBuilding(b);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [pickedPublicId]);

    useEffect(() => {
        if (!pickedPublicId) {
            return;
        }

        const row = candidateRowRefs.current.get(pickedPublicId);
        row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [pickedPublicId]);

    const handleCandidateRowClick = useCallback(
        (building: Building) => {
            setPickedPublicId(building.public_id);
            setActionError("");

            const map = hostMapRef?.current ?? null;
            if (!map || !building.geometry) {
                return;
            }

            const bounds = getGeometryBounds(building.geometry);
            if (bounds && isBoundsOutsideViewport(map, bounds)) {
                fitMapToReviewCandidate(map, building.geometry, "polygon", { duration: 550 });
            }
        },
        [hostMapRef],
    );

    const handleFitSelectedBuilding = useCallback(() => {
        const map = hostMapRef?.current ?? null;
        if (!map || !pickedBuilding?.geometry) {
            return;
        }
        fitMapToReviewCandidate(map, pickedBuilding.geometry, "polygon", { duration: 550 });
    }, [hostMapRef, pickedBuilding]);

    async function handleAttach() {
        if (!pickedPublicId) {
            setActionError(
                hostMapRef
                    ? "Choose a building from the main map or search below."
                    : "Choose a building from the search list below.",
            );
            return;
        }

        if (linkedIds.includes(pickedPublicId)) {
            setActionError("This building is already linked.");
            return;
        }

        setBusy(true);
        setActionError("");

        try {
            await linkBuildingToPlace(placePublicId, {
                building_id: pickedPublicId,
                relation_type: attachRelation,
                is_primary: attachAsPrimary,
            });
            await loadLinked();
            setPickedPublicId(null);
            setPickedBuilding(null);
            setAttachAsPrimary(false);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to attach");
        } finally {
            setBusy(false);
        }
    }

    async function handleDetach(buildingPublicId: string) {
        setBusy(true);
        setActionError("");

        try {
            await unlinkBuildingFromPlace(placePublicId, buildingPublicId);
            await loadLinked();

            if (pickedPublicId === buildingPublicId) {
                setPickedPublicId(null);
            }
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to detach");
        } finally {
            setBusy(false);
        }
    }

    async function handleSetPrimary(buildingPublicId: string) {
        setBusy(true);
        setActionError("");

        try {
            await patchPlaceBuildingLink(placePublicId, buildingPublicId, { is_primary: true });
            await loadLinked();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to set primary");
        } finally {
            setBusy(false);
        }
    }

    async function handleRelationChange(
        buildingPublicId: string,
        relation: PlaceBuildingRelationType,
    ) {
        setBusy(true);
        setActionError("");

        try {
            await patchPlaceBuildingLink(placePublicId, buildingPublicId, { relation_type: relation });
            await loadLinked();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to update relation");
        } finally {
            setBusy(false);
        }
    }

    if (!clientMounted) {
        return null;
    }

    return (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-base font-semibold text-slate-900">Linked buildings</h3>
                <p className="mt-0.5 text-sm text-slate-600">
                    Optional footprint links for this place. POIs never require a building.
                </p>
            </div>

            <div className="space-y-5 p-4">
                {loadError ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                        {loadError}{" "}
                        <button type="button" className="ml-1 font-medium underline" onClick={() => void loadLinked()}>
                            Retry
                        </button>
                    </div>
                ) : null}

                {actionError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        {actionError}
                    </div>
                ) : null}

                <section className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-900">Currently linked</h4>
                    {linked.length === 0 ? (
                        <p className="rounded-md border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-center text-sm text-slate-600">
                            No buildings linked yet.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {linked.map((row) => (
                                <li
                                    key={row.building.public_id}
                                    className="rounded-md border border-slate-200 bg-slate-50/60 p-3"
                                >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0 flex-1 space-y-0.5">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="text-sm font-medium text-slate-900">
                                                    {buildingDisplayLabel(row.building)}
                                                </span>
                                                {row.is_primary ? (
                                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
                                                        Primary
                                                    </span>
                                                ) : null}
                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-700">
                                                    {row.relation_type}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-600">
                                                {formatBuildingAdminCanonical(row.building.admin_area)}
                                            </p>
                                            <p className="font-mono text-[11px] text-slate-500">
                                                {row.building.public_id.slice(0, 8)}
                                                {typeof row.building.area_m2 === "number"
                                                    ? ` · ${Math.round(row.building.area_m2)} m²`
                                                    : null}
                                            </p>
                                        </div>

                                        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                                            <label className="flex items-center gap-1.5 text-xs text-slate-700">
                                                <span className="font-medium text-slate-500">Relation</span>
                                                <select
                                                    value={row.relation_type as PlaceBuildingRelationType}
                                                    disabled={busy}
                                                    onChange={(event) =>
                                                        void handleRelationChange(
                                                            row.building.public_id,
                                                            event.target.value as PlaceBuildingRelationType,
                                                        )
                                                    }
                                                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                                                >
                                                    {RELATION_OPTIONS.map((option) => (
                                                        <option key={option} value={option}>
                                                            {option}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>

                                            {!row.is_primary ? (
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                                                    onClick={() => void handleSetPrimary(row.building.public_id)}
                                                >
                                                    Set primary
                                                </button>
                                            ) : null}
                                            <button
                                                type="button"
                                                disabled={busy}
                                                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                                onClick={() => void handleDetach(row.building.public_id)}
                                            >
                                                Detach
                                            </button>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="space-y-3 border-t border-slate-100 pt-4">
                    <div>
                        <h4 className="text-sm font-semibold text-slate-900">Attach a building</h4>
                        <p className="mt-0.5 text-sm text-slate-600">
                            {hostMapRef
                                ? "Select a building from the main map or search below."
                                : "Search for a building below to attach."}
                        </p>
                    </div>

                    <label className="block text-sm text-slate-700">
                        <span className="text-xs font-medium text-slate-600">Search buildings</span>
                        <input
                            type="search"
                            value={searchQ}
                            onChange={(event) => setSearchQ(event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm"
                            placeholder="Name or building type — leave empty for nearby"
                            autoComplete="off"
                        />
                    </label>

                    <div className="max-h-52 overflow-auto rounded-md border border-slate-200 bg-white">
                        {searchBusy ? (
                            <div className="px-3 py-2 text-sm text-slate-600">Searching…</div>
                        ) : searchResults.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-slate-500">No buildings found.</div>
                        ) : (
                            searchResults.map((building) => {
                                const linkedHere = linkedIds.includes(building.public_id);
                                const isSelected = pickedPublicId === building.public_id;
                                const distanceKm = candidateDistances.get(building.public_id);

                                return (
                                    <button
                                        key={building.public_id}
                                        ref={(element) => {
                                            if (element) {
                                                candidateRowRefs.current.set(building.public_id, element);
                                            } else {
                                                candidateRowRefs.current.delete(building.public_id);
                                            }
                                        }}
                                        type="button"
                                        disabled={linkedHere}
                                        className={`block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 ${
                                            isSelected
                                                ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300"
                                                : "hover:bg-slate-50"
                                        } disabled:cursor-not-allowed disabled:opacity-50`}
                                        onClick={() => handleCandidateRowClick(building)}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <span className="text-sm font-medium text-slate-900">
                                                {buildingDisplayLabel(building)}
                                            </span>
                                            {isSelected ? (
                                                <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-900">
                                                    Selected
                                                </span>
                                            ) : null}
                                        </div>
                                        <span className="mt-0.5 block text-xs text-slate-600">
                                            {formatBuildingAdminCanonical(building.admin_area)}
                                            {typeof distanceKm === "number"
                                                ? ` · ${formatDistanceKm(distanceKm)}`
                                                : null}
                                            {typeof building.area_m2 === "number"
                                                ? ` · ${Math.round(building.area_m2)} m²`
                                                : null}
                                        </span>
                                        <span className="mt-0.5 block font-mono text-[11px] text-slate-500">
                                            {linkedHere
                                                ? "(already linked)"
                                                : building.public_id.slice(0, 8)}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm text-slate-700">
                            <span className="text-xs font-medium text-slate-600">Relation type</span>
                            <select
                                value={attachRelation}
                                onChange={(event) =>
                                    setAttachRelation(event.target.value as PlaceBuildingRelationType)
                                }
                                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                            >
                                {RELATION_OPTIONS.map((option) => (
                                    <option key={option} value={option}>
                                        {option}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex items-end gap-2 pb-1 text-sm text-slate-700">
                            <input
                                type="checkbox"
                                checked={attachAsPrimary}
                                onChange={(event) => setAttachAsPrimary(event.target.checked)}
                                className="rounded border-slate-300"
                            />
                            Attach as primary building
                        </label>
                    </div>

                    {pickedBuilding ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                            <span>
                                Selected:{" "}
                                <span className="font-medium text-slate-900">
                                    {buildingDisplayLabel(pickedBuilding)}
                                </span>
                                {linkedIds.includes(pickedBuilding.public_id) ? (
                                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
                                        Linked
                                    </span>
                                ) : null}
                            </span>
                            {hostMapRef && pickedBuilding.geometry ? (
                                <button
                                    type="button"
                                    onClick={handleFitSelectedBuilding}
                                    className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900 hover:bg-sky-100"
                                >
                                    Fit selected building
                                </button>
                            ) : null}
                        </div>
                    ) : pickedPublicId ? (
                        <p className="text-sm text-slate-600">Loading building…</p>
                    ) : null}

                    <button
                        type="button"
                        disabled={busy || !pickedPublicId}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void handleAttach()}
                    >
                        Attach selected
                    </button>
                </section>
            </div>
        </div>
    );
}
