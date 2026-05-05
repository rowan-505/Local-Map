import type { FeatureCollection, Point } from "geojson";
import type { ExpressionSpecification, Map } from "maplibre-gl";
import { GeoJSONSource } from "maplibre-gl";
import { getMapTextFieldExpression } from "@/src/lib/mapLocalizedName";

import type { Place } from "@/src/lib/api";
import { placePreviewDisplayName } from "@/src/lib/placePreviewDisplayName";

const PREVIEW_LABEL_TEXT = getMapTextFieldExpression("my") as ExpressionSpecification;

function nonEmpty(value: string | null | undefined): string | undefined {
    if (typeof value !== "string") return undefined;
    const t = value.trim();
    return t.length ? t : undefined;
}

export const DASHBOARD_PREVIEW_PLACES_SOURCE = "dashboard-preview-places";
export const DASHBOARD_PREVIEW_PLACES_DOTS_LAYER = "dashboard-preview-places-dots";
export const DASHBOARD_PREVIEW_PLACES_LABELS_LAYER = "dashboard-preview-places-labels";

export function haversineKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
): number {
    const earthKm = 6371;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h =
        sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    return 2 * earthKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PreviewPlacesGeoOptions = {
    excludePublicId?: string | null;
    /** When set with nearbyKm, only places within this distance of center are included */
    center?: { lat: number; lng: number } | null;
    nearbyKm?: number | null;
};

export function placesToPreviewGeoJSON(
    places: Place[],
    options: PreviewPlacesGeoOptions
): FeatureCollection<Point> {
    let list = places.filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );

    if (options.excludePublicId) {
        list = list.filter((p) => p.public_id !== options.excludePublicId);
    }

    const { center, nearbyKm } = options;
    if (center && nearbyKm != null && nearbyKm > 0) {
        list = list.filter((p) => haversineKm(center, p) <= nearbyKm);
    }

    return {
        type: "FeatureCollection",
        features: list.map((p) => {
            const mm = nonEmpty(p.name_mm ?? p.myanmar_name ?? p.nameMm ?? p.name_local ?? undefined);
            const en = nonEmpty(p.name_en ?? p.english_name ?? p.nameEn ?? p.secondary_name ?? undefined);
            const display = nonEmpty(p.display_name);

            const props: Record<string, string> = {
                name: placePreviewDisplayName(p),
                public_id: p.public_id,
            };
            if (mm) props.name_mm = mm;
            if (en) props.name_en = en;
            if (display) props.display_name = display;

            return {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [p.lng, p.lat],
                },
                properties: props,
            };
        }),
    };
}

export function ensureDashboardPreviewPlacesLayers(map: Map): void {
    if (map.getSource(DASHBOARD_PREVIEW_PLACES_SOURCE)) {
        return;
    }

    const empty: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };

    map.addSource(DASHBOARD_PREVIEW_PLACES_SOURCE, {
        type: "geojson",
        data: empty,
    });

    map.addLayer({
        id: DASHBOARD_PREVIEW_PLACES_DOTS_LAYER,
        type: "circle",
        source: DASHBOARD_PREVIEW_PLACES_SOURCE,
        minzoom: 9,
        paint: {
            "circle-radius": 3.5,
            "circle-color": "#64748b",
            "circle-opacity": 0.92,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
        },
    });

    map.addLayer({
        id: DASHBOARD_PREVIEW_PLACES_LABELS_LAYER,
        type: "symbol",
        source: DASHBOARD_PREVIEW_PLACES_SOURCE,
        minzoom: 11,
        layout: {
            "text-field": PREVIEW_LABEL_TEXT,
            "text-size": 12,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
            "text-optional": true,
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-font": ["Noto Sans Regular"],
        },
        paint: {
            "text-color": "#334155",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.2,
        },
    });
}

export function setDashboardPreviewPlacesGeoJSON(map: Map, data: FeatureCollection): void {
    const source = map.getSource(DASHBOARD_PREVIEW_PLACES_SOURCE);
    if (source && source instanceof GeoJSONSource) {
        source.setData(data);
    }
}
