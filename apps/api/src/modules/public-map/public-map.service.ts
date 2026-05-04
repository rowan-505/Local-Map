import {
    PublicMapRepository,
    type PublicMapGeoLabelRow,
    type PublicPlaceRow,
    type PublicSearchRow,
} from "./public-map.repo.js";

type PublicMapLang = "my" | "en" | "both";

type DisplayNameSource = {
    name_mm: string | null;
    name_en: string | null;
    display_name?: string | null;
    primary_name?: string | null;
    canonical_name?: string | null;
};

/** GeoJSON-ish payload consumed by apps/web MapLibre sources (validated at runtime there). */
export type PublicMapGeoJsonFeatureCollection = {
    readonly type: "FeatureCollection";
    readonly features: ReadonlyArray<{
        readonly type: "Feature";
        readonly id?: string;
        readonly geometry: unknown;
        readonly properties: {
            readonly id: string;
            readonly name: string;
            readonly label_dense?: boolean;
        };
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
        lang: PublicMapLang;
        limit: number;
    }) {
        const places = await this.publicMapRepo.listPlaces(input);
        return places.map((place) => serializePlace(place, input.lang));
    }

    async getPlaceByPublicId(publicId: string, lang: PublicMapLang = "my") {
        const place = await this.publicMapRepo.getPlaceByPublicId(publicId);

        if (!place) {
            throw new PublicPlaceNotFoundError();
        }

        return serializePlace(place, lang);
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

    async search(input: { q: string; lang: PublicMapLang; limit: number }) {
        const results = await this.publicMapRepo.search(input);
        return results.map((result) => serializeSearchResult(result, input.lang));
    }

    async geoJsonStreets(lang: PublicMapLang): Promise<PublicMapGeoJsonFeatureCollection> {
        const rows = await this.publicMapRepo.listStreetGeoLabels();
        return toFeatureCollection(rows, lang);
    }

    async geoJsonAdminAreas(lang: PublicMapLang): Promise<PublicMapGeoJsonFeatureCollection> {
        const rows = await this.publicMapRepo.listAdminAreaGeoLabels();
        return toFeatureCollection(rows, lang);
    }

    async geoJsonBusStops(lang: PublicMapLang): Promise<PublicMapGeoJsonFeatureCollection> {
        const rows = await this.publicMapRepo.listBusStopGeoLabels();
        return toFeatureCollection(rows, lang);
    }

    async geoJsonBusRoutes(lang: PublicMapLang): Promise<PublicMapGeoJsonFeatureCollection> {
        const rows = await this.publicMapRepo.listBusRouteGeoLabels();
        return toFeatureCollection(rows, lang);
    }
}

function toFeatureCollection(rows: readonly PublicMapGeoLabelRow[], lang: PublicMapLang): PublicMapGeoJsonFeatureCollection {
    return {
        type: "FeatureCollection",
        features: rows.map((row) => geoLabelFeature(row, lang)),
    };
}

function geoLabelFeature(row: PublicMapGeoLabelRow, lang: PublicMapLang) {
    const name = getDisplayNameForLang(
        {
            name_mm: row.name_mm,
            name_en: row.name_en,
            display_name: row.display_name ?? null,
            primary_name: row.primary_name ?? null,
            canonical_name: row.canonical_name,
        },
        lang,
    );

    return {
        type: "Feature" as const,
        id: row.id,
        geometry: row.geom,
        properties: {
            id: row.id,
            name,
            ...(typeof row.label_dense === "boolean" ? { label_dense: row.label_dense } : {}),
        },
    };
}

function serializePlace(place: PublicPlaceRow, lang: PublicMapLang) {
    return {
        id: place.id.toString(),
        publicId: place.public_id,
        name: getDisplayNameForLang(place, lang),
        categoryId: place.category_id.toString(),
        categoryCode: place.category_code,
        categoryName: place.category_name,
        lat: place.lat,
        lng: place.lng,
        importanceScore: place.importance_score,
        isVerified: place.is_verified,
    };
}

function getDisplayNameForLang(source: DisplayNameSource, lang: PublicMapLang) {
    const nameMm = normalizeName(source.name_mm);
    const nameEn = normalizeName(source.name_en);
    const displayName = normalizeName(source.display_name ?? null);
    const primaryName = normalizeName(source.primary_name ?? null);
    const canonicalName = normalizeName(source.canonical_name ?? null);
    const fallbackName = displayName ?? primaryName ?? canonicalName ?? "Unnamed";

    if (lang === "my") {
        return nameMm ?? nameEn ?? fallbackName;
    }

    if (lang === "en") {
        return nameEn ?? nameMm ?? fallbackName;
    }

    if (lang === "both") {
        if (nameMm && nameEn && nameMm !== nameEn) {
            return `${nameMm} · ${nameEn}`;
        }

        return nameMm ?? nameEn ?? fallbackName;
    }

    return fallbackName;
}

function normalizeName(value: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function serializeSearchResult(result: PublicSearchRow, lang: PublicMapLang) {
    const isPlace = result.result_type === "place";

    return {
        id: result.id,
        type: result.result_type,
        name: getDisplayNameForLang(result, lang),
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
