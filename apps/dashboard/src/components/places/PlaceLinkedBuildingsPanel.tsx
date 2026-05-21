"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { type GeoJSONSource, type Map as MaplibreMap, type MapLayerMouseEvent } from "maplibre-gl";

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
    type LinkedBuildingSummaryApi,
    type PlaceBuildingRelationType,
} from "@/src/lib/api";

type PlaceLinkedBuildingsPanelProps = {
    placePublicId: string;
    placeLat: number;
    placeLng: number;
    /** When provided, building picks and highlights use the main place map instead of a panel map. */
    hostMapRef?: MutableRefObject<MaplibreMap | null>;
};

const RELATION_OPTIONS: PlaceBuildingRelationType[] = ["inside", "entrance", "nearby", "compound"];

const HL_SOURCE = "place-linked-building-highlight";
const HL_FILL = "place-linked-building-highlight-fill";
const HL_LINE = "place-linked-building-highlight-line";

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

function ensureHighlightLayers(map: MaplibreMap) {
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

function clearHighlightLayers(map: MaplibreMap | null) {
    if (!map?.isStyleLoaded()) {
        return;
    }

    const src = map.getSource(HL_SOURCE) as GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
}

export default function PlaceLinkedBuildingsPanel({
    placePublicId,
    placeLat,
    placeLng,
    hostMapRef,
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

    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const placeCoordsRef = useRef({ lat: placeLat, lng: placeLng });
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

    const linkedIds = linked.map((l) => l.building.public_id);

    const setHighlightGeometry = useCallback(
        (building: Building | null) => {
            const map = hostMapRef?.current ?? null;

            if (!map?.isStyleLoaded()) {
                return;
            }

            ensureHighlightLayers(map);
            const src = map.getSource(HL_SOURCE) as GeoJSONSource | undefined;

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
        },
        [hostMapRef],
    );

    /** Attach MVT building picks to the host place map when available. */
    useEffect(() => {
        if (!hostMapRef) {
            return;
        }

        let attachedMap: MaplibreMap | null = null;
        let pickHandlersAttached = false;

        const onBuildingLayerClick = (event: MapLayerMouseEvent) => {
            const feature = event.features?.[0];
            const pid = readPublicIdFromMvtProps(feature?.properties);

            if (!pid) {
                return;
            }

            setPickedPublicId(pid);
            setActionError("");
        };

        const onMouseEnterBuildings = () => {
            attachedMap?.getCanvas().style.setProperty("cursor", "pointer");
        };

        const onMouseLeaveBuildings = () => {
            attachedMap?.getCanvas().style.setProperty("cursor", "");
        };

        const attachPickHandlers = (map: MaplibreMap) => {
            if (pickHandlersAttached || !map.getLayer("basemap-buildings")) {
                return;
            }

            pickHandlersAttached = true;
            attachedMap = map;
            map.on("click", "basemap-buildings", onBuildingLayerClick);
            map.on("mouseenter", "basemap-buildings", onMouseEnterBuildings);
            map.on("mouseleave", "basemap-buildings", onMouseLeaveBuildings);
        };

        const tryAttach = () => {
            const map = hostMapRef.current;
            if (!map) {
                return;
            }

            if (map.isStyleLoaded() && map.getLayer("basemap-buildings")) {
                attachPickHandlers(map);
                return;
            }

            map.once("idle", () => attachPickHandlers(map));
        };

        tryAttach();
        const interval = window.setInterval(tryAttach, 400);
        const mapForCleanup = hostMapRef.current;

        return () => {
            window.clearInterval(interval);

            if (attachedMap) {
                attachedMap.off("click", "basemap-buildings", onBuildingLayerClick);
                attachedMap.off("mouseenter", "basemap-buildings", onMouseEnterBuildings);
                attachedMap.off("mouseleave", "basemap-buildings", onMouseLeaveBuildings);
            }

            clearHighlightLayers(mapForCleanup);
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
            <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">Linked buildings</h3>
                <p className="mt-1 text-sm text-slate-600">
                    Optional footprint links for this place. POIs never require a building.
                </p>
            </div>

            <div className="space-y-6 p-5">
                {loadError ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        {loadError}{" "}
                        <button type="button" className="ml-1 font-medium underline" onClick={() => void loadLinked()}>
                            Retry
                        </button>
                    </div>
                ) : null}

                {actionError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        {actionError}
                    </div>
                ) : null}

                <section className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-900">Currently linked</h4>
                    {linked.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-600">
                            No buildings linked yet.
                        </p>
                    ) : (
                        <ul className="space-y-3">
                            {linked.map((row) => (
                                <li
                                    key={row.building.public_id}
                                    className="rounded-lg border border-slate-200 bg-slate-50/60 p-4"
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium text-slate-900">
                                                    {buildingDisplayLabel(row.building)}
                                                </span>
                                                {row.is_primary ? (
                                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                                                        Primary
                                                    </span>
                                                ) : null}
                                            </div>
                                            <p className="text-xs text-slate-600">
                                                Admin area: {formatBuildingAdminCanonical(row.building.admin_area)}
                                            </p>
                                            <p className="font-mono text-xs text-slate-500">
                                                {row.building.public_id}
                                                {typeof row.building.area_m2 === "number"
                                                    ? ` · ${Math.round(row.building.area_m2)} m²`
                                                    : null}
                                            </p>
                                        </div>

                                        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                                            <label className="flex items-center gap-2 text-sm text-slate-700">
                                                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                                    Relation
                                                </span>
                                                <select
                                                    value={row.relation_type as PlaceBuildingRelationType}
                                                    disabled={busy}
                                                    onChange={(event) =>
                                                        void handleRelationChange(
                                                            row.building.public_id,
                                                            event.target.value as PlaceBuildingRelationType,
                                                        )
                                                    }
                                                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                                                >
                                                    {RELATION_OPTIONS.map((option) => (
                                                        <option key={option} value={option}>
                                                            {option}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>

                                            <div className="flex flex-wrap gap-2">
                                                {!row.is_primary ? (
                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                                                        onClick={() => void handleSetPrimary(row.building.public_id)}
                                                    >
                                                        Set primary
                                                    </button>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                                    onClick={() => void handleDetach(row.building.public_id)}
                                                >
                                                    Detach
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                    <div>
                        <h4 className="text-sm font-semibold text-slate-900">Attach a building</h4>
                        <p className="mt-1 text-sm text-slate-600">
                            {hostMapRef
                                ? "Select a building from the main map or search below."
                                : "Search for a building below to attach."}
                            {/* TODO: Unify building pick overlays on PlaceEditModal main map when that form is refactored. */}
                        </p>
                    </div>

                    <label className="block text-sm text-slate-700">
                        <span className="font-medium">Search buildings</span>
                        <input
                            type="search"
                            value={searchQ}
                            onChange={(event) => setSearchQ(event.target.value)}
                            className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                            placeholder="Name or building type — leave empty for nearby"
                            autoComplete="off"
                        />
                    </label>

                    <div className="max-h-52 overflow-auto rounded-md border border-slate-200 bg-white">
                        {searchBusy ? (
                            <div className="px-4 py-3 text-sm text-slate-600">Searching…</div>
                        ) : searchResults.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-slate-500">No buildings found.</div>
                        ) : (
                            searchResults.map((building) => {
                                const linkedHere = linkedIds.includes(building.public_id);
                                const isSelected = pickedPublicId === building.public_id;

                                return (
                                    <button
                                        key={building.public_id}
                                        type="button"
                                        disabled={linkedHere}
                                        className={`block w-full border-b border-slate-100 px-4 py-3 text-left last:border-b-0 ${
                                            isSelected ? "bg-amber-50" : "hover:bg-slate-50"
                                        } disabled:cursor-not-allowed disabled:opacity-50`}
                                        onClick={() => setPickedPublicId(building.public_id)}
                                    >
                                        <span className="block text-sm font-medium text-slate-900">
                                            {buildingDisplayLabel(building)}
                                        </span>
                                        <span className="mt-0.5 block text-xs text-slate-600">
                                            {formatBuildingAdminCanonical(building.admin_area)}
                                        </span>
                                        <span className="mt-0.5 block font-mono text-xs text-slate-500">
                                            {linkedHere ? "(already linked)" : building.public_id.slice(0, 8)}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm text-slate-700">
                            <span className="font-medium">Relation type</span>
                            <select
                                value={attachRelation}
                                onChange={(event) =>
                                    setAttachRelation(event.target.value as PlaceBuildingRelationType)
                                }
                                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                            >
                                {RELATION_OPTIONS.map((option) => (
                                    <option key={option} value={option}>
                                        {option}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
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
                        <p className="text-sm text-slate-700">
                            Selected:{" "}
                            <span className="font-medium text-slate-900">
                                {buildingDisplayLabel(pickedBuilding)}
                            </span>
                        </p>
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
