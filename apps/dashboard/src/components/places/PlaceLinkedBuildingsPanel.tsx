"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import { createPlaceBaseMap } from "@/src/components/map/createPlaceBaseMap";
import { MAP_PREVIEW_VIEWPORT_BUILDING_PANEL } from "@/src/components/map/mapPreviewUi";
import {
    BUILDINGS_LIST_LIMIT,
    getBuilding,
    getBuildings,
    getLinkedBuildingsForPlace,
    linkBuildingToPlace,
    patchPlaceBuildingLink,
    unlinkBuildingFromPlace,
    type Building,
    type LinkedBuildingSummaryApi,
    type PlaceBuildingRelationType,
} from "@/src/lib/api";

type PlaceLinkedBuildingsPanelProps = {
    placePublicId: string;
    placeLat: number;
    placeLng: number;
};

const RELATION_OPTIONS: PlaceBuildingRelationType[] = ["inside", "entrance", "nearby", "compound"];

const HL_SOURCE = "place-linked-building-highlight";
const HL_FILL = "place-linked-building-highlight-fill";
const HL_LINE = "place-linked-building-highlight-line";

const MAP_ZOOM = 16;

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

    if (!name) {
        return "-";
    }

    return name;
}

function buildingCentroid(
    geom: Building["geometry"] | null | undefined
): { lng: number; lat: number } | null {
    if (!geom) {
        return null;
    }

    if (geom.type === "Polygon") {
        const ring = geom.coordinates[0];
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

    const poly = geom.coordinates[0]?.[0];

    if (!poly?.length) {
        return null;
    }

    let sumLng = 0;
    let sumLat = 0;
    let n = 0;

    for (const pair of poly) {
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

function readPublicIdFromMvtProps(props: unknown): string | null {
    if (!props || typeof props !== "object") {
        return null;
    }

    const o = props as Record<string, unknown>;
    const raw = o.public_id ?? o.PUBLIC_ID ?? o.Public_id;

    if (typeof raw === "string" && raw.length > 0) {
        return raw;
    }

    if (typeof raw === "number") {
        return String(raw);
    }

    return null;
}

function ensureHighlightLayers(map: maplibregl.Map) {
    if (!map.getSource(HL_SOURCE)) {
        map.addSource(HL_SOURCE, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });
    }

    if (!map.getLayer(HL_FILL)) {
        map.addLayer({
            id: HL_FILL,
            type: "fill",
            source: HL_SOURCE,
            paint: {
                "fill-color": "#f59e0b",
                "fill-opacity": 0.35,
            },
        });
    }

    if (!map.getLayer(HL_LINE)) {
        map.addLayer({
            id: HL_LINE,
            type: "line",
            source: HL_SOURCE,
            paint: {
                "line-color": "#b45309",
                "line-width": 2,
            },
        });
    }
}

export default function PlaceLinkedBuildingsPanel({
    placePublicId,
    placeLat,
    placeLng,
}: PlaceLinkedBuildingsPanelProps) {
    const [linked, setLinked] = useState<LinkedBuildingSummaryApi[]>([]);
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

    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const poiMarkerRef = useRef<maplibregl.Marker | null>(null);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const linkedIds = linked.map((l) => l.building.public_id);

    const setHighlightGeometry = useCallback((building: Building | null) => {
        const map = mapRef.current;

        if (!map?.isStyleLoaded()) {
            return;
        }

        const src = map.getSource(HL_SOURCE) as maplibregl.GeoJSONSource | undefined;

        if (!src) {
            return;
        }

        if (!building?.geometry) {
            src.setData({ type: "FeatureCollection", features: [] });
            return;
        }

        src.setData({
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    properties: {},
                    geometry: building.geometry as GeoJSON.Geometry,
                },
            ],
        });
    }, []);

    /** Map setup + MVT pick */
    useEffect(() => {
        const container = mapContainerRef.current;

        if (!container || mapRef.current) {
            return;
        }

        const pickHandlers: {
            onBuildingLayerClick?: (event: maplibregl.MapLayerMouseEvent) => void;
            onMouseEnterBuildings?: () => void;
            onMouseLeaveBuildings?: () => void;
        } = {};

        const map = createPlaceBaseMap(container, {
            zoom: MAP_ZOOM,
            onLoad: (m) => {
                ensureHighlightLayers(m);
                m.jumpTo({
                    center: [placeLng, placeLat],
                    zoom: MAP_ZOOM,
                });

                if (!poiMarkerRef.current) {
                    poiMarkerRef.current = new maplibregl.Marker({ color: "#7c3aed" });
                }

                poiMarkerRef.current.setLngLat([placeLng, placeLat]).addTo(m);

                window.setTimeout(() => {
                    m.resize();
                }, 150);

                pickHandlers.onBuildingLayerClick = (event: maplibregl.MapLayerMouseEvent) => {
                    const feature = event.features?.[0];
                    const pid = readPublicIdFromMvtProps(feature?.properties);

                    if (!pid) {
                        return;
                    }

                    setPickedPublicId(pid);
                    setActionError("");
                };

                pickHandlers.onMouseEnterBuildings = () => {
                    m.getCanvas().style.cursor = "pointer";
                };

                pickHandlers.onMouseLeaveBuildings = () => {
                    m.getCanvas().style.cursor = "";
                };

                let pickHandlersAttached = false;

                const attachWhenReady = () => {
                    if (
                        pickHandlersAttached ||
                        !m.getLayer("buildings") ||
                        !pickHandlers.onBuildingLayerClick ||
                        !pickHandlers.onMouseEnterBuildings ||
                        !pickHandlers.onMouseLeaveBuildings
                    ) {
                        return;
                    }

                    pickHandlersAttached = true;
                    m.on("click", "buildings", pickHandlers.onBuildingLayerClick);
                    m.on("mouseenter", "buildings", pickHandlers.onMouseEnterBuildings);
                    m.on("mouseleave", "buildings", pickHandlers.onMouseLeaveBuildings);
                };

                m.once("idle", attachWhenReady);
            },
        });

        mapRef.current = map;

        return () => {
            if (pickHandlers.onBuildingLayerClick) {
                map.off("click", "buildings", pickHandlers.onBuildingLayerClick);
            }

            if (pickHandlers.onMouseEnterBuildings) {
                map.off("mouseenter", "buildings", pickHandlers.onMouseEnterBuildings);
            }

            if (pickHandlers.onMouseLeaveBuildings) {
                map.off("mouseleave", "buildings", pickHandlers.onMouseLeaveBuildings);
            }

            poiMarkerRef.current?.remove();
            poiMarkerRef.current = null;
            map.remove();
            mapRef.current = null;
        };
    }, [placePublicId, setHighlightGeometry]);

    /** POI marker + recenter */
    useEffect(() => {
        const map = mapRef.current;

        if (!map?.isStyleLoaded()) {
            return;
        }

        map.jumpTo({ center: [placeLng, placeLat], zoom: MAP_ZOOM });

        if (!poiMarkerRef.current) {
            poiMarkerRef.current = new maplibregl.Marker({ color: "#7c3aed" });
        }

        poiMarkerRef.current.setLngLat([placeLng, placeLat]).addTo(map);
    }, [placeLat, placeLng]);

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
                                    row
                                ): row is {
                                    building: Building;
                                    km: number;
                                } => Boolean(row && row.km <= NEARBY_KM)
                            )
                            .sort((a, b) => a.km - b.km)
                            .slice(0, 25)
                            .map((row) => row.building);

                        setSearchResults(near);
                        return;
                    }

                    const hits = await getBuildings({
                        q,
                        limit: 50,
                    });
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

    /** Load full geometry when picking from search list */
    useEffect(() => {
        if (!pickedPublicId) {
            setPickedBuilding(null);
            setHighlightGeometry(null);
            return;
        }

        let cancelled = false;

        void getBuilding(pickedPublicId).then((b) => {
            if (!cancelled) {
                setPickedBuilding(b);
                setHighlightGeometry(b);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [pickedPublicId, setHighlightGeometry]);

    async function handleAttach() {
        if (!pickedPublicId) {
            setActionError("Choose a building from search or tap one on the map.");
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
            setHighlightGeometry(null);
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
                setHighlightGeometry(null);
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
        relation: PlaceBuildingRelationType
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

    return (
        <div className="space-y-4 border-t border-gray-200 pt-8">
            <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Linked buildings
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                    Optional: link footprints to this place. Tap a beige building on the map, or search and
                    pick from the list, then Attach. POIs never require a building.
                </p>
            </div>

            {loadError ? (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {loadError}{" "}
                    <button
                        type="button"
                        className="ml-2 underline"
                        onClick={() => void loadLinked()}
                    >
                        Retry
                    </button>
                </div>
            ) : null}

            {linked.length === 0 ? (
                <p className="text-sm text-gray-500">No buildings linked yet.</p>
            ) : (
                <ul className="divide-y divide-gray-200 rounded border border-gray-200">
                    {linked.map((row) => (
                        <li
                            key={row.building.public_id}
                            className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div>
                                <div className="font-medium text-gray-900">
                                    {row.building.name?.trim()
                                        ? row.building.name
                                        : `${row.building.building_type?.name ?? row.building.building_type_name ?? row.building.building_type_code ?? row.building.class_code ?? "building"}`}
                                    {row.is_primary ? (
                                        <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                                            Primary
                                        </span>
                                    ) : null}
                                </div>
                                <div className="mt-1 text-xs text-gray-600">
                                    <span className="text-gray-500">Admin area: </span>
                                    {formatBuildingAdminCanonical(row.building.admin_area)}
                                </div>
                                <div className="mt-1 text-xs text-gray-600">
                                    {row.building.public_id}{" "}
                                    {typeof row.building.area_m2 === "number"
                                        ? `· ${Math.round(row.building.area_m2)} m²`
                                        : null}
                                </div>
                                <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                                    <span>Relation:</span>
                                    <select
                                        value={row.relation_type as PlaceBuildingRelationType}
                                        disabled={busy}
                                        onChange={(event) =>
                                            void handleRelationChange(
                                                row.building.public_id,
                                                event.target.value as PlaceBuildingRelationType
                                            )
                                        }
                                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                                    >
                                        {RELATION_OPTIONS.map((option) => (
                                            <option key={option} value={option}>
                                                {option}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {!row.is_primary ? (
                                    <button
                                        type="button"
                                        disabled={busy}
                                        className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                                        onClick={() => void handleSetPrimary(row.building.public_id)}
                                    >
                                        Set primary
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    disabled={busy}
                                    className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    onClick={() => void handleDetach(row.building.public_id)}
                                >
                                    Detach
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <div className="rounded border border-gray-200 bg-gray-50 p-4">
                <h4 className="text-sm font-medium text-gray-900">Attach a building</h4>

                <div className="mt-3 grid gap-3 lg:grid-cols-2 lg:gap-6">
                    <div>
                        <label className="block text-sm text-gray-700">
                            Search (or leave empty for nearby footprints)
                            <input
                                type="search"
                                value={searchQ}
                                onChange={(event) => setSearchQ(event.target.value)}
                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Name or building type…"
                                autoComplete="off"
                            />
                        </label>
                        <div className="mt-2 max-h-48 overflow-auto rounded border border-gray-200 bg-white text-sm">
                            {searchBusy ? (
                                <div className="p-3 text-gray-600">Searching…</div>
                            ) : (
                                searchResults.map((building) => {
                                    const linkedHere = linkedIds.includes(building.public_id);
                                    const label =
                                        building.name?.trim() ||
                                        `${building.building_type?.name ?? building.building_type_name ?? building.building_type_code ?? building.class_code}` ||
                                        building.public_id;

                                    return (
                                        <button
                                            key={building.public_id}
                                            type="button"
                                            disabled={linkedHere}
                                            className={`block w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0 ${
                                                pickedPublicId === building.public_id
                                                    ? "bg-amber-50"
                                                    : "hover:bg-gray-50"
                                            } disabled:cursor-not-allowed disabled:opacity-50`}
                                            onClick={() => setPickedPublicId(building.public_id)}
                                        >
                                            <span className="block">{label}</span>
                                            <span className="mt-0.5 block text-xs text-gray-600">
                                                <span className="text-gray-500">Admin area: </span>
                                                {formatBuildingAdminCanonical(building.admin_area)}
                                            </span>
                                            <span className="mt-0.5 block text-xs text-gray-500 font-mono">
                                                {linkedHere ? "(linked)" : building.public_id.slice(0, 8)}
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-700">
                            Relation type
                            <select
                                value={attachRelation}
                                onChange={(event) =>
                                    setAttachRelation(event.target.value as PlaceBuildingRelationType)
                                }
                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                            >
                                {RELATION_OPTIONS.map((option) => (
                                    <option key={option} value={option}>
                                        {option}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={attachAsPrimary}
                                onChange={(event) => setAttachAsPrimary(event.target.checked)}
                            />
                            Attach as primary building for this POI
                        </label>

                        {pickedBuilding ? (
                            <p className="mt-3 text-xs text-gray-600">
                                Selected:{" "}
                                <strong>
                                    {pickedBuilding.name?.trim() ||
                                        `${pickedBuilding.building_type?.name ?? pickedBuilding.building_type_name ?? pickedBuilding.building_type_code ?? pickedBuilding.class_code}`}
                                </strong>
                                <span className="mt-1 block">
                                    Admin area: {formatBuildingAdminCanonical(pickedBuilding.admin_area)}
                                </span>
                            </p>
                        ) : pickedPublicId ? (
                            <p className="mt-3 text-xs text-gray-600">Loading building… ({pickedPublicId})</p>
                        ) : (
                            <p className="mt-3 text-xs text-gray-500">
                                Tap a building footprint on the map (purple dot = POI).
                            </p>
                        )}
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        disabled={busy}
                        className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                        onClick={() => void handleAttach()}
                    >
                        Attach selected
                    </button>
                </div>
            </div>

            <div ref={mapContainerRef} className={MAP_PREVIEW_VIEWPORT_BUILDING_PANEL} />

            {actionError ? (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {actionError}
                </div>
            ) : null}
        </div>
    );
}
