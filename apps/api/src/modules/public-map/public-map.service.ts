import {
    PublicMapRepository,
    type PublicMapGeoLabelRow,
    type PublicPlaceRow,
    type PublicSearchRow,
} from "./public-map.repo.js";

/** GeoJSON for MapLibre — include `name_mm` / `name_en` so clients drive `text-field` by language mode. */
export type PublicMapGeoJsonFeatureCollection = {
    readonly type: "FeatureCollection";
    readonly features: ReadonlyArray<{
        readonly type: "Feature";
        readonly id?: string;
        readonly geometry: unknown;
        readonly properties: Record<string, string | boolean>;
    }>;
};

export class PublicPlaceNotFoundError extends Error {
    constructor(message = "Public place not found") {
        super(message);
        this.name = "PublicPlaceNotFoundError";
    }
}

export class PublicMapService {
    constructor(private readonly publicMapRepo: PublicMapRepository) {}

    async listPlaces(input: {
        q?: string;
        category?: string;
        categoryId?: bigint;
        limit: number;
    }) {
        const places = await this.publicMapRepo.listPlaces(input);
        return places.map((place) => serializePlace(place));
    }

    async getPlaceByPublicId(publicId: string) {
        const place = await this.publicMapRepo.getPlaceByPublicId(publicId);

        if (!place) {
            throw new PublicPlaceNotFoundError();
        }

        return serializePlace(place);
    }

    async listCategories() {
        const categories = await this.publicMapRepo.listCategories();

        return categories.map((category) => ({
            id: category.id.toString(),
            code: category.code,
            name: category.name,
            nameLocal: null,
            iconKey: null,
            sortOrder: category.sortOrder,
        }));
    }

    async search(input: { q: string; limit: number }) {
        const results = await this.publicMapRepo.search(input);
        return results.map((result) => serializeSearchResult(result));
    }

    async geoJsonStreets(): Promise<PublicMapGeoJsonFeatureCollection> {
        const rows = await this.publicMapRepo.listStreetGeoLabels();
        return toFeatureCollection(rows);
    }

    async geoJsonAdminAreas(): Promise<PublicMapGeoJsonFeatureCollection> {
        const rows = await this.publicMapRepo.listAdminAreaGeoLabels();
        return toFeatureCollection(rows);
    }

    async geoJsonBusStops(): Promise<PublicMapGeoJsonFeatureCollection> {
        const rows = await this.publicMapRepo.listBusStopGeoLabels();
        return toFeatureCollection(rows);
    }

    async geoJsonBusRoutes(): Promise<PublicMapGeoJsonFeatureCollection> {
        const rows = await this.publicMapRepo.listBusRouteGeoLabels();
        return toFeatureCollection(rows);
    }
}

function toFeatureCollection(rows: readonly PublicMapGeoLabelRow[]): PublicMapGeoJsonFeatureCollection {
    return {
        type: "FeatureCollection",
        features: rows.map((row) => geoLabelFeature(row)),
    };
}

function geoLabelFeature(row: PublicMapGeoLabelRow) {
    const props = geoLabelProperties(row);
    return {
        type: "Feature" as const,
        id: row.id,
        geometry: row.geom,
        properties: props,
    };
}

function geoLabelProperties(row: PublicMapGeoLabelRow): Record<string, string | boolean> {
    const mm = normalizeName(row.name_mm);
    const en = normalizeName(row.name_en);
    const display = normalizeName(row.display_name ?? null);
    const primary = normalizeName(row.primary_name ?? null);
    const canonical = normalizeName(row.canonical_name);

    const props: Record<string, string | boolean> = {
        id: row.id,
        name: mm ?? en ?? display ?? primary ?? canonical ?? "Unnamed",
    };

    if (typeof row.label_dense === "boolean") {
        props.label_dense = row.label_dense;
    }
    if (mm) props.name_mm = mm;
    if (en) props.name_en = en;
    if (display) props.display_name = display;

    return props;
}

function serializePlace(place: PublicPlaceRow) {
    const mm = normalizeName(place.name_mm);
    const en = normalizeName(place.name_en);
    const display = normalizeName(place.display_name);
    const primary = normalizeName(place.primary_name);

    return {
        id: place.id.toString(),
        publicId: place.public_id,
        myanmar_name: mm,
        english_name: en,
        name_mm: mm,
        name_en: en,
        display_name: display,
        primary_name: primary,
        categoryId: place.category_id.toString(),
        categoryCode: place.category_code,
        category_name: place.category_name,
        categoryName: place.category_name,
        lat: place.lat,
        lng: place.lng,
        importanceScore: place.importance_score,
        isVerified: place.is_verified,
    };
}

function normalizeName(value: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function serializeSearchResult(result: PublicSearchRow) {
    const isPlace = result.result_type === "place";
    const mm = normalizeName(result.name_mm);
    const en = normalizeName(result.name_en);

    return {
        id: result.id,
        type: result.result_type,
        myanmar_name: mm,
        english_name: en,
        name_mm: mm,
        name_en: en,
        display_name: normalizeName(result.display_name),
        primary_name: normalizeName(result.primary_name),
        canonical_name: normalizeName(result.canonical_name),
        subtitle: result.subtitle,
        categoryName: result.category_name,
        lat: result.lat,
        lng: result.lng,
        cameraTarget: {
            type: isPlace ? "point" : "bounds",
            center: [result.lng, result.lat],
            zoom: isPlace ? 16 : 15,
            ...(isPlace
                ? {}
                : {
                      bbox: [result.min_lng, result.min_lat, result.max_lng, result.max_lat],
                      padding: 80,
                  }),
        },
    };
}
