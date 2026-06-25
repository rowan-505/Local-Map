import { generatePlusCode } from "../../lib/geo/plus-code.js";
import type { ReverseSearchService } from "../addresses/reverse-search.service.js";
import type { AdminAreaOptionRow, AdminAreasRepository } from "../admin-areas/admin-areas.repo.js";
import {
    effectiveImportanceThresholdForZoom,
    PublicMapRepository,
    type PublicMapGeoLabelRow,
    type PublicMapViewportPlaceRow,
    type PublicPlaceRow,
    type PublicSearchRow,
    type ViewportPublicPlacesParams,
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

export type PublicMapPlacesFeatureCollection = {
    readonly type: "FeatureCollection";
    readonly features: ReadonlyArray<{
        readonly type: "Feature";
        readonly id: string;
        readonly geometry: unknown;
        readonly properties: {
            readonly id: string;
            readonly public_id: string;
            readonly publicId: string;
            readonly display_name: string | null;
            readonly primary_name: string | null;
            readonly name: string;
            readonly name_mm: string | null;
            readonly name_en: string | null;
            readonly category_code: string | null;
            readonly category_name: string | null;
            readonly categoryCode: string | null;
            readonly categoryName: string | null;
            readonly importance_score: number | null;
            readonly importanceScore: number | null;
            readonly is_verified: boolean;
            readonly isVerified: boolean;
            readonly lat: number;
            readonly lng: number;
        };
    }>;
    readonly metadata: {
        readonly count: number;
        readonly limit: number;
        readonly offset: number;
        readonly has_more: boolean;
        readonly bbox: readonly [number, number, number, number];
        readonly zoom: number;
        readonly density_debug?: {
            readonly zoom: number;
            readonly bbox: readonly [number, number, number, number];
            readonly threshold_used: number | null;
            readonly returned_count: number;
        };
    };
};

export class PublicPlaceNotFoundError extends Error {
    constructor(message = "Public place not found") {
        super(message);
        this.name = "PublicPlaceNotFoundError";
    }
}

/** Public admin-area option for the profile region picker (no internal fields). */
export type PublicAdminAreaResult = {
    readonly id: string;
    readonly name: string;
    readonly name_my: string | null;
    readonly name_en: string | null;
    readonly admin_level: string | null;
    readonly admin_level_code: string | null;
    readonly parent_name: string | null;
    readonly display_name: string;
};

export class PublicMapService {
    constructor(
        private readonly publicMapRepo: PublicMapRepository,
        /** Optional: enriches single-place detail with address_line. List paths never use it. */
        private readonly reverseSearch?: ReverseSearchService,
        /** Optional: powers the public admin-area (region) search used by the profile picker. */
        private readonly adminAreasRepo?: AdminAreasRepository,
    ) {}

    async searchAdminAreas(input: {
        q?: string | undefined;
        limit: number;
    }): Promise<PublicAdminAreaResult[]> {
        if (!this.adminAreasRepo) return [];
        // Reuses the indexed, active-only admin-area options query.
        // TODO: rank township-like levels above region/state for nicer ordering.
        const rows = await this.adminAreasRepo.listAdminAreaOptions({
            limit: input.limit,
            q: input.q,
        });
        return rows.map(toPublicAdminArea);
    }

    async getAdminAreaById(id: bigint): Promise<PublicAdminAreaResult | null> {
        if (!this.adminAreasRepo) return null;
        const row = await this.adminAreasRepo.getActiveAdminAreaById(id);
        return row ? toPublicAdminArea(row) : null;
    }

    async listPlaces(input: {
        q?: string;
        category?: string;
        categoryId?: bigint;
        limit: number;
    }) {
        const places = await this.publicMapRepo.listPlaces(input);
        return places.map((place) => serializePlace(place));
    }

    async listViewportPlaces(input: ViewportPublicPlacesParams): Promise<PublicMapPlacesFeatureCollection> {
        const rows = await this.publicMapRepo.listViewportPlaces(input);
        const hasMore = rows.length > input.limit;
        const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
        const thresholdUsed = effectiveImportanceThresholdForZoom(input.zoom);

        return {
            type: "FeatureCollection",
            features: pageRows.map((place) => viewportPlaceFeature(place)),
            metadata: {
                count: pageRows.length,
                limit: input.limit,
                offset: input.offset,
                has_more: hasMore,
                bbox: input.bbox,
                zoom: input.zoom,
                ...(isDevelopmentRuntime()
                    ? {
                          density_debug: {
                              zoom: input.zoom,
                              bbox: input.bbox,
                              threshold_used: thresholdUsed,
                              returned_count: pageRows.length,
                          },
                      }
                    : {}),
            },
        };
    }

    async getPlaceByPublicId(publicId: string) {
        const place = await this.publicMapRepo.getPlaceByPublicId(publicId);

        if (!place) {
            throw new PublicPlaceNotFoundError();
        }

        const serialized = serializePlace(place);

        // Detail-only enrichment: one Plus Code (pure compute) + one reverse lookup for this place.
        const plus_code = generatePlusCode(place.lat, place.lng);
        let address_line: string | undefined;
        if (this.reverseSearch) {
            try {
                const reverse = await this.reverseSearch.reverse(place.lat, place.lng);
                address_line = reverse.address_line;
            } catch {
                // Reverse lookup is best-effort; place detail must still return without it.
            }
        }

        return {
            ...serialized,
            plus_code,
            ...(address_line !== undefined ? { address_line } : {}),
        };
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
    if (row.admin_level_code) props.admin_level_code = row.admin_level_code;

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

function viewportPlaceFeature(place: PublicMapViewportPlaceRow) {
    const mm = normalizeName(place.name_mm);
    const en = normalizeName(place.name_en);
    const display = normalizeName(place.display_name);
    const primary = normalizeName(place.primary_name);
    const publicId = place.public_id;

    return {
        type: "Feature" as const,
        id: publicId,
        geometry: place.geom,
        properties: {
            id: place.id.toString(),
            public_id: publicId,
            publicId,
            display_name: display,
            primary_name: primary,
            name: mm ?? en ?? display ?? primary ?? "Unnamed",
            name_mm: mm,
            name_en: en,
            category_code: place.category_code,
            category_name: place.category_name,
            categoryCode: place.category_code,
            categoryName: place.category_name,
            importance_score: place.importance_score,
            importanceScore: place.importance_score,
            is_verified: place.is_verified,
            isVerified: place.is_verified,
            lat: place.lat,
            lng: place.lng,
        },
    };
}

function normalizeName(value: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function isDevelopmentRuntime() {
    return process.env.NODE_ENV !== "production";
}

function serializeSearchResult(result: PublicSearchRow) {
    const mm = normalizeName(result.name_mm);
    const en = normalizeName(result.name_en);
    const hasBbox =
        result.min_lng !== null &&
        result.min_lat !== null &&
        result.max_lng !== null &&
        result.max_lat !== null &&
        result.min_lng !== result.max_lng &&
        result.min_lat !== result.max_lat;

    const cameraTarget = (() => {
        if (result.result_type === "place") {
            return {
                type: "point" as const,
                center: [result.lng, result.lat] as [number, number],
                zoom: 16,
            };
        }

        if (result.result_type === "admin_area") {
            if (hasBbox) {
                return {
                    type: "bounds" as const,
                    bbox: [
                        result.min_lng,
                        result.min_lat,
                        result.max_lng,
                        result.max_lat,
                    ] as [number, number, number, number],
                    padding: 80,
                };
            }
            return {
                type: "point" as const,
                center: [result.lng, result.lat] as [number, number],
                zoom: 14,
            };
        }

        return {
            type: "bounds" as const,
            center: [result.lng, result.lat] as [number, number],
            zoom: 15,
            ...(hasBbox
                ? {
                      bbox: [
                          result.min_lng,
                          result.min_lat,
                          result.max_lng,
                          result.max_lat,
                      ] as [number, number, number, number],
                      padding: 80,
                  }
                : {}),
        };
    })();

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
        cameraTarget,
    };
}

function toPublicAdminArea(row: AdminAreaOptionRow): PublicAdminAreaResult {
    const nameMy = normalizeName(row.name_mm);
    const nameEn = normalizeName(row.name_en);
    const adminLevel = normalizeName(row.admin_level_name);
    const parentName = normalizeName(row.parent_label);
    const base = nameEn ?? nameMy ?? row.canonical_name;

    // Build "Kyauktan Township, <parent>" when columns are available.
    // TODO: prefer the region/state ancestor (not just the immediate parent) for parent_name.
    const labelWithLevel =
        adminLevel && !base.toLowerCase().includes(adminLevel.toLowerCase())
            ? `${base} ${adminLevel}`
            : base;
    const displayName = parentName ? `${labelWithLevel}, ${parentName}` : labelWithLevel;

    return {
        id: row.id.toString(),
        name: base,
        name_my: nameMy,
        name_en: nameEn,
        admin_level: adminLevel,
        admin_level_code: normalizeName(row.admin_level_code),
        parent_name: parentName,
        display_name: displayName,
    };
}
