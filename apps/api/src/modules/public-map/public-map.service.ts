import {
    decodeOrExpandPlusCode,
    generatePlusCode,
    isLikelyPlusCode,
} from "../../lib/geo/plus-code.js";
import type { ReverseSearchService } from "../addresses/reverse-search.service.js";
import type { AdminAreaOptionRow, AdminAreasRepository } from "../admin-areas/admin-areas.repo.js";
import { PUBLIC_SEARCH_ENTITY_TYPES } from "./public-map.schema.js";
import {
    BUS_ROUTE_PATH_CAP,
    effectiveImportanceThresholdForZoom,
    PublicMapRepository,
    type EntityGeometryRow,
    type GeometryEntityType,
    type PublicMapGeoLabelRow,
    type PublicMapViewportPlaceRow,
    type PublicPlaceRow,
    type PublicSearchRow,
    type SearchPublicMapMode,
    STREET_GROUP_SEGMENT_CAP,
    type UnifiedSearchRow,
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

    /**
     * Public search. Single runtime path over the unified search index
     * (search.search_documents): normalize -> Plus Code branch -> unified index.
     * Streets are returned as grouped `street_group` rows (one per logical road).
     */
    async search(
        input: {
            q: string;
            limit: number;
            lat?: number;
            lng?: number;
            lang?: "my" | "en" | "und";
            types?: readonly string[];
        },
        logger?: SearchTelemetryLogger,
    ) {
        const q = input.q.trim();
        const limit = clampPublicSearchLimit(input.limit);

        // Plus Code branch: handled before the length guard so codes always work.
        // A valid (or reference-required) Plus Code short-circuits; an
        // invalid-looking one falls through to normal text search.
        if (isLikelyPlusCode(q)) {
            const plusResult = await this.resolvePlusCodeSearch(q, input.lat, input.lng);
            if (plusResult) {
                return [plusResult];
            }
        }

        // Coordinate branch: a valid "lat,lng" query resolves directly to a point
        // pin and NEVER touches the search index. Invalid/out-of-range values
        // return null here and fall through to normal text search.
        const coordinate = parseCoordinate(q);
        if (coordinate) {
            return [await this.resolveCoordinateSearch(coordinate.lat, coordinate.lng)];
        }

        // Guard cheap/broad queries. Plus Codes and coordinates bypass the length
        // guard (checked above / in `planPublicSearch`).
        const plan = planPublicSearch(q);
        if (!plan.allowed) {
            return [];
        }

        // Restrict to the renderable entity types (excludes the parent `bus_route`,
        // which has no geometry endpoint). A caller-provided subset is intersected.
        const allowed = new Set<string>(PUBLIC_SEARCH_ENTITY_TYPES);
        const requested = (input.types ?? []).filter((t) => allowed.has(t));
        const types = requested.length > 0 ? requested : [...PUBLIC_SEARCH_ENTITY_TYPES];

        const startedAt = Date.now();
        let timedOut = false;
        let rows: UnifiedSearchRow[] = [];
        try {
            rows = await this.publicMapRepo.searchUnifiedDocuments({
                q,
                lat: input.lat,
                lng: input.lng,
                lang: input.lang,
                types,
                mode: plan.mode,
                limit,
            });
        } catch (error) {
            if (isStatementTimeoutError(error)) {
                // Graceful degradation: a slow search returns empty, never a 500.
                timedOut = true;
            } else {
                throw error;
            }
        }

        const durationMs = Date.now() - startedAt;
        // TEMP: per-query duration profiling (debug level — quiet in production).
        logger?.debug?.(
            {
                event: "public_search_timing",
                query: q,
                mode: plan.mode,
                duration_ms: durationMs,
                result_count: rows.length,
                timed_out: timedOut,
            },
            "Public search timing",
        );
        if (logger && (timedOut || durationMs >= PUBLIC_SEARCH_SLOW_MS)) {
            logger.warn(
                {
                    event: "public_search_slow",
                    query: q,
                    mode: plan.mode,
                    duration_ms: durationMs,
                    result_count: rows.length,
                    timed_out: timedOut,
                },
                "Slow public search",
            );
        }

        // Telemetry: record zero-result (or timed-out) queries. Best-effort.
        if (rows.length === 0) {
            try {
                await this.publicMapRepo.logFailedSearch({
                    q,
                    normalizedQuery: q.toLowerCase(),
                    lang: input.lang ?? null,
                    lat: input.lat ?? null,
                    lng: input.lng ?? null,
                    types,
                    resultCount: 0,
                });
            } catch {
                // Telemetry failure never fails the search response.
            }
            return [];
        }

        return rows.map((row) => serializePublicSearchHit(row));
    }

    /**
     * Resolve a Plus Code query to a single pin result, or null to fall through
     * to text search. Never matches stored plus codes; decoding is on-demand.
     */
    private async resolvePlusCodeSearch(
        q: string,
        lat?: number,
        lng?: number,
    ): Promise<PlusCodeSearchResult | null> {
        const hasRef = Number.isFinite(lat) && Number.isFinite(lng);
        const resolution = decodeOrExpandPlusCode(
            q,
            hasRef ? { lat: lat as number, lng: lng as number } : undefined,
        );

        if (!resolution.ok) {
            // Short code without a reference -> ask the client for one.
            if (resolution.reason === "REFERENCE_REQUIRED") {
                return plusCodeReferenceRequiredResult(resolution.normalizedCode);
            }
            // Invalid -> let normal text search handle the query.
            return null;
        }

        const { lat: cellLat, lng: cellLng, normalizedCode } = resolution;
        const outsideServiceArea = !isWithinServiceArea(cellLat, cellLng);

        // Outside the service area: return a bare pin, do not force a nearest place.
        if (outsideServiceArea) {
            return plusCodePinResult(normalizedCode, cellLat, cellLng, null, true);
        }

        let reverse: PlusCodeReverse | null = null;
        if (this.reverseSearch) {
            try {
                const row = await this.reverseSearch.reverseDetails(cellLat, cellLng);
                reverse = row ? toPlusCodeReverse(row) : null;
            } catch {
                // Reverse enrichment is best-effort; the pin still resolves.
            }
        }

        return plusCodePinResult(normalizedCode, cellLat, cellLng, reverse, false);
    }

    /**
     * Resolve a parsed coordinate to a single pin result. Mirrors the Plus Code
     * branch: best-effort reverse details inside the service area; outside the
     * service area still returns a pin (flagged) without forcing a nearest result.
     */
    private async resolveCoordinateSearch(
        lat: number,
        lng: number,
    ): Promise<CoordinateSearchResult> {
        const outsideServiceArea = !isWithinServiceArea(lat, lng);

        let reverse: PlusCodeReverse | null = null;
        if (!outsideServiceArea && this.reverseSearch) {
            try {
                const row = await this.reverseSearch.reverseDetails(lat, lng);
                reverse = row ? toPlusCodeReverse(row) : null;
            } catch {
                // Reverse enrichment is best-effort; the pin still resolves.
            }
        }

        return coordinatePinResult(lat, lng, reverse, outsideServiceArea);
    }

    /**
     * Full geometry for a clicked search result. Returns null when the entity is
     * missing / not public (caller responds 404).
     */
    async getEntityGeometry(
        input: {
            entityType: GeometryEntityType;
            entityId: string;
            zoom?: number;
        },
        logger?: SearchTelemetryLogger,
    ): Promise<EntityGeometryResult | null> {
        const tolerance = resolveSimplifyTolerance(input.entityType, input.zoom);

        // Grouped streets: dedicated collect+cap path so we can warn on huge groups.
        if (input.entityType === "street_group") {
            const row = await this.publicMapRepo.getStreetGroupGeometry(
                input.entityId,
                tolerance,
            );
            if (!row || !row.geometry) return null;
            if (row.capped) {
                logger?.warn(
                    {
                        event: "street_group_geometry_capped",
                        entity_id: input.entityId,
                        segment_count: row.segment_count,
                        cap: STREET_GROUP_SEGMENT_CAP,
                    },
                    "street_group geometry capped to safe segment limit",
                );
            }
            return serializeEntityGeometry("street_group", input.entityId, row);
        }

        // Parent bus routes: collect their variants' paths (+cap) into one line.
        if (input.entityType === "bus_route") {
            const row = await this.publicMapRepo.getBusRouteGeometry(
                input.entityId,
                tolerance,
            );
            if (!row || !row.geometry) return null;
            if (row.capped) {
                logger?.warn(
                    {
                        event: "bus_route_geometry_capped",
                        entity_id: input.entityId,
                        segment_count: row.segment_count,
                        cap: BUS_ROUTE_PATH_CAP,
                    },
                    "bus_route geometry capped to safe path limit",
                );
            }
            return serializeEntityGeometry("bus_route", input.entityId, row);
        }

        const row = await this.publicMapRepo.getEntityGeometry(
            input.entityType,
            input.entityId,
            tolerance,
        );
        if (!row || !row.geometry) return null;
        return serializeEntityGeometry(input.entityType, input.entityId, row);
    }

    /**
     * Unified search over search.search_documents. Logs zero-result queries to
     * telemetry (best-effort — logging failure never fails the search request).
     */
    async searchUnified(input: UnifiedSearchInput): Promise<UnifiedSearchResult[]> {
        const q = input.q.trim();
        if (q.length === 0) return [];

        const limit = clampUnifiedSearchLimit(input.limit);
        const rows = await this.publicMapRepo.searchUnifiedDocuments({
            q,
            lat: input.lat,
            lng: input.lng,
            lang: input.lang,
            types: input.types,
            limit,
        });

        if (rows.length === 0) {
            try {
                await this.publicMapRepo.logFailedSearch({
                    q,
                    normalizedQuery: q.toLowerCase(),
                    lang: input.lang ?? null,
                    lat: input.lat ?? null,
                    lng: input.lng ?? null,
                    types: input.types ?? null,
                    resultCount: 0,
                });
            } catch {
                // Telemetry is best-effort; an empty result is still a valid response.
            }
            return [];
        }

        return rows.map((row) => serializeUnifiedSearchResult(row));
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

/** Camera point-zoom per point-like entity type (others fit a bbox). */
const PUBLIC_SEARCH_POINT_ZOOM: Record<string, number> = {
    place: 16,
    bus_stop: 17,
    address: 17,
};

/**
 * Serialize a unified search row into the public search hit shape the web client
 * consumes: localized names + lightweight geometry (center/bbox) + a camera
 * target + a geometry hint. No heavy geometry. Streets arrive as `street_group`
 * (one logical road); their geometry is fetched on click via the geometry endpoint.
 */
export function serializePublicSearchHit(row: UnifiedSearchRow) {
    const lng = row.lng;
    const lat = row.lat;
    const hasCenter =
        lng !== null && lat !== null && Number.isFinite(lng) && Number.isFinite(lat);
    const center: [number, number] | null = hasCenter
        ? [lng as number, lat as number]
        : null;

    const hasBbox =
        row.min_lng !== null &&
        row.min_lat !== null &&
        row.max_lng !== null &&
        row.max_lat !== null &&
        row.min_lng !== row.max_lng &&
        row.min_lat !== row.max_lat;
    const bbox: [number, number, number, number] | null = hasBbox
        ? [
              row.min_lng as number,
              row.min_lat as number,
              row.max_lng as number,
              row.max_lat as number,
          ]
        : null;

    const pointZoom = PUBLIC_SEARCH_POINT_ZOOM[row.entity_type];
    const cameraTarget = (() => {
        if (pointZoom !== undefined && center) {
            return { type: "point" as const, center, zoom: pointZoom };
        }
        if (bbox) {
            return {
                type: "bounds" as const,
                ...(center ? { center } : {}),
                bbox,
                padding: 80,
            };
        }
        if (center) {
            return {
                type: "point" as const,
                center,
                zoom: row.entity_type === "admin_area" ? 11 : 15,
            };
        }
        return undefined;
    })();

    const mm = normalizeName(row.primary_name_my);
    const en = normalizeName(row.primary_name_en);
    const display = normalizeName(row.display_name);

    return {
        id: `${row.entity_type}:${row.entity_id}`,
        entityType: row.entity_type,
        type: row.entity_type,
        entityId: row.entity_id,
        publicId: row.public_id,
        myanmar_name: mm,
        english_name: en,
        name_mm: mm,
        name_en: en,
        display_name: display,
        displayName: display,
        primary_name: display,
        canonical_name: display,
        subtitle: normalizeName(row.subtitle),
        matchedName: normalizeName(row.matched_name),
        categoryCode: row.category_code,
        categoryName:
            normalizeName(row.category_name_en) ?? normalizeName(row.category_name_my),
        adminAreaNameMy: normalizeName(row.admin_area_name_my),
        adminAreaNameEn: normalizeName(row.admin_area_name_en),
        lat: hasCenter ? (lat as number) : null,
        lng: hasCenter ? (lng as number) : null,
        center,
        bbox,
        geometryType: row.geometry_type,
        hasGeometry: row.has_geometry,
        isVerified: row.is_verified,
        confidenceScore: row.confidence_score,
        boundaryConfidenceScore: row.boundary_confidence_score,
        score: Math.round(row.score * 100) / 100,
        cameraTarget,
    };
}

/** Myanmar service-area bounding box (lng/lat, 4326). Generous national envelope. */
const MYANMAR_SERVICE_AREA = {
    minLng: 92.0,
    minLat: 9.0,
    maxLng: 102.0,
    maxLat: 29.0,
} as const;

export function isWithinServiceArea(lat: number, lng: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return (
        lng >= MYANMAR_SERVICE_AREA.minLng &&
        lng <= MYANMAR_SERVICE_AREA.maxLng &&
        lat >= MYANMAR_SERVICE_AREA.minLat &&
        lat <= MYANMAR_SERVICE_AREA.maxLat
    );
}

/** Entity types whose geometry is point-like and must never be simplified. */
const POINT_LIKE_GEOMETRY_TYPES = new Set<GeometryEntityType>(["place", "address", "bus_stop"]);

/** Light default simplification (~5m in degrees) when no zoom is provided. */
const DEFAULT_SIMPLIFY_TOLERANCE_DEG = 0.00005;
const MIN_SIMPLIFY_TOLERANCE_DEG = 0.000001;
const MAX_SIMPLIFY_TOLERANCE_DEG = 0.01;

/**
 * Resolve a ST_SimplifyPreserveTopology tolerance (in degrees, 4326).
 * - Point-like geometry: never simplify (0).
 * - No zoom: a safe light tolerance for large admin/water/route geometry.
 * - With zoom: higher zoom -> smaller tolerance (more detail), clamped.
 */
export function resolveSimplifyTolerance(
    entityType: GeometryEntityType,
    zoom?: number,
): number {
    if (POINT_LIKE_GEOMETRY_TYPES.has(entityType)) return 0;
    if (zoom == null || !Number.isFinite(zoom)) return DEFAULT_SIMPLIFY_TOLERANCE_DEG;
    const tolerance = 0.5 / 2 ** zoom;
    return Math.min(MAX_SIMPLIFY_TOLERANCE_DEG, Math.max(MIN_SIMPLIFY_TOLERANCE_DEG, tolerance));
}

export type EntityGeometryResult = {
    entityType: GeometryEntityType;
    entityId: string;
    geometryType: string | null;
    bbox: [number, number, number, number];
    feature: {
        type: "Feature";
        geometry: { type: string; coordinates: unknown };
        properties: { entityType: GeometryEntityType; entityId: string };
    };
};

function serializeEntityGeometry(
    entityType: GeometryEntityType,
    entityId: string,
    row: EntityGeometryRow,
): EntityGeometryResult {
    const geometry = row.geometry as { type: string; coordinates: unknown };
    return {
        entityType,
        entityId,
        geometryType: geometry.type ?? null,
        bbox: [row.min_lng, row.min_lat, row.max_lng, row.max_lat],
        feature: {
            type: "Feature",
            geometry,
            properties: { entityType, entityId },
        },
    };
}

export type PlusCodeReverse = {
    nearbyName: string | null;
    nearbyType: string | null;
    nearbyDistanceM: number | null;
    township: string | null;
    district: string | null;
    regionState: string | null;
    country: string | null;
    confidence: string | null;
};

/**
 * A Plus Code search hit. Shares the base search-hit fields (so existing clients
 * keep working) and adds plus-code-specific fields. For a short code with no
 * reference, `referenceRequired` is true and there is no center.
 */
export type PlusCodeSearchResult = {
    id: string;
    type: "plus_code";
    myanmar_name: null;
    english_name: null;
    name_mm: null;
    name_en: null;
    display_name: string;
    primary_name: null;
    canonical_name: null;
    subtitle: string | null;
    categoryName: null;
    lat: number | null;
    lng: number | null;
    cameraTarget?: { type: "point"; center: [number, number]; zoom: number };
    plus_code: string;
    geometryType: "Point";
    center: [number, number] | null;
    hasGeometry: boolean;
    outsideServiceArea: boolean;
    referenceRequired: boolean;
    reason?: "REFERENCE_REQUIRED";
    reverse: PlusCodeReverse | null;
};

function toPlusCodeReverse(row: {
    nearby_name: string | null;
    nearby_type: string | null;
    nearby_distance_m: number | null;
    township: string | null;
    district: string | null;
    region_state: string | null;
    country: string | null;
    confidence: string | null;
}): PlusCodeReverse {
    return {
        nearbyName: normalizeName(row.nearby_name),
        nearbyType: normalizeName(row.nearby_type),
        nearbyDistanceM: row.nearby_distance_m,
        township: normalizeName(row.township),
        district: normalizeName(row.district),
        regionState: normalizeName(row.region_state),
        country: normalizeName(row.country),
        confidence: normalizeName(row.confidence),
    };
}

function plusCodeBase(normalizedCode: string): Omit<
    PlusCodeSearchResult,
    "lat" | "lng" | "center" | "hasGeometry" | "outsideServiceArea" | "referenceRequired" | "reverse"
> {
    return {
        id: normalizedCode,
        type: "plus_code",
        myanmar_name: null,
        english_name: null,
        name_mm: null,
        name_en: null,
        display_name: normalizedCode,
        primary_name: null,
        canonical_name: null,
        subtitle: "Plus Code",
        categoryName: null,
        plus_code: normalizedCode,
        geometryType: "Point",
    };
}

export function plusCodePinResult(
    normalizedCode: string,
    lat: number,
    lng: number,
    reverse: PlusCodeReverse | null,
    outsideServiceArea: boolean,
): PlusCodeSearchResult {
    return {
        ...plusCodeBase(normalizedCode),
        subtitle: reverse?.nearbyName ?? "Plus Code",
        lat,
        lng,
        cameraTarget: { type: "point", center: [lng, lat], zoom: 18 },
        center: [lng, lat],
        hasGeometry: true,
        outsideServiceArea,
        referenceRequired: false,
        reverse,
    };
}

export function plusCodeReferenceRequiredResult(normalizedCode: string): PlusCodeSearchResult {
    return {
        ...plusCodeBase(normalizedCode),
        subtitle: "Short Plus Code — pan the map or share your location",
        lat: null,
        lng: null,
        center: null,
        hasGeometry: false,
        outsideServiceArea: false,
        referenceRequired: true,
        reason: "REFERENCE_REQUIRED",
        reverse: null,
    };
}

/**
 * A raw-coordinate search hit. Shares the base search-hit fields (so existing
 * clients keep working) and always resolves to a point pin — it never queries
 * the search index. Reverse details are best-effort (in-service-area only).
 */
export type CoordinateSearchResult = {
    id: string;
    type: "coordinate";
    entityType: "coordinate";
    myanmar_name: null;
    english_name: null;
    name_mm: null;
    name_en: null;
    display_name: string;
    displayName: string;
    primary_name: null;
    canonical_name: null;
    subtitle: string;
    categoryName: null;
    lat: number;
    lng: number;
    center: [number, number];
    bbox: [number, number, number, number] | null;
    geometryType: "Point";
    hasGeometry: true;
    score: number;
    cameraTarget: { type: "point"; center: [number, number]; zoom: number };
    outsideServiceArea: boolean;
    reverse: PlusCodeReverse | null;
};

/** "16.812345, 96.15" — trims trailing zeros via Number round-trip (max 6 dp). */
function formatCoordinateLabel(lat: number, lng: number): string {
    const round = (n: number) => String(Math.round(n * 1e6) / 1e6);
    return `${round(lat)}, ${round(lng)}`;
}

export function coordinatePinResult(
    lat: number,
    lng: number,
    reverse: PlusCodeReverse | null,
    outsideServiceArea: boolean,
): CoordinateSearchResult {
    const label = formatCoordinateLabel(lat, lng);
    return {
        id: label,
        type: "coordinate",
        entityType: "coordinate",
        myanmar_name: null,
        english_name: null,
        name_mm: null,
        name_en: null,
        display_name: label,
        displayName: label,
        primary_name: null,
        canonical_name: null,
        // Always a clean, stable descriptor. The locality/admin detail (township,
        // district, region) travels in `reverse` for the client to render.
        subtitle: "Coordinate location",
        categoryName: null,
        lat,
        lng,
        center: [lng, lat],
        bbox: null,
        geometryType: "Point",
        hasGeometry: true,
        score: 100,
        cameraTarget: { type: "point", center: [lng, lat], zoom: 17 },
        outsideServiceArea,
        reverse,
    };
}

export type UnifiedSearchInput = {
    q: string;
    lat?: number | undefined;
    lng?: number | undefined;
    lang?: "my" | "en" | "und" | undefined;
    types?: string[] | undefined;
    limit?: number | undefined;
};

export type UnifiedSearchResult = {
    entityType: string;
    entityId: string;
    publicId: string | null;
    displayName: string | null;
    subtitle: string | null;
    primaryNameMy: string | null;
    primaryNameEn: string | null;
    matchedName: string | null;
    geometryType: string | null;
    center: [number, number] | null;
    bbox: [number, number, number, number] | null;
    hasGeometry: boolean;
    categoryCode: string | null;
    categoryName: string | null;
    adminAreaNameMy: string | null;
    adminAreaNameEn: string | null;
    score: number;
    isVerified: boolean;
    confidenceScore: number;
    boundaryConfidenceScore: number;
};

/** Clamp the unified-search limit to the supported window (default 20, max 50). */
export function clampUnifiedSearchLimit(limit?: number): number {
    if (limit === undefined || !Number.isFinite(limit)) return 20;
    return Math.max(1, Math.min(50, Math.trunc(limit)));
}

/** Minimal structural logger (matches Fastify/pino `log.warn(obj, msg)`). */
export type SearchTelemetryLogger = {
    warn: (obj: Record<string, unknown>, msg: string) => void;
    /** Optional debug channel — used for temporary per-query duration profiling. */
    debug?: (obj: Record<string, unknown>, msg: string) => void;
};

/** Searches slower than this (ms) are logged at warn level for visibility. */
export const PUBLIC_SEARCH_SLOW_MS = 500;

export const PUBLIC_SEARCH_DEFAULT_LIMIT = 20;
export const PUBLIC_SEARCH_MAX_LIMIT = 50;

/** Defensive clamp (the route schema also enforces default 20 / max 50). */
export function clampPublicSearchLimit(limit?: number): number {
    if (limit === undefined || !Number.isFinite(limit)) return PUBLIC_SEARCH_DEFAULT_LIMIT;
    return Math.max(1, Math.min(PUBLIC_SEARCH_MAX_LIMIT, Math.trunc(limit)));
}

export type PublicSearchPlan =
    | { readonly allowed: false }
    | { readonly allowed: true; readonly mode: SearchPublicMapMode };

const COORDINATE_QUERY_RE = /^-?\d{1,3}(?:\.\d+)?\s*[,;\s]\s*-?\d{1,3}(?:\.\d+)?$/;

/** A query that looks like a `lat,lng` / `lng,lat` pair. */
export function isLikelyCoordinate(q: string): boolean {
    return COORDINATE_QUERY_RE.test(q.trim());
}

/**
 * Parse a `lat,lng` query (comma, semicolon, or whitespace separated) into a
 * validated point. Order is lat-first (the common map convention). Returns null
 * when the text isn't a coordinate or the values are out of range, so the caller
 * falls through to normal text search.
 *
 * Supported: "16.8,96.15", "16.8, 96.15", "16.8 96.15", "16.8;96.15".
 */
export function parseCoordinate(q: string): { lat: number; lng: number } | null {
    const trimmed = q.trim();
    if (!isLikelyCoordinate(trimmed)) return null;
    const parts = trimmed.split(/[\s,;]+/).filter((p) => p.length > 0);
    if (parts.length !== 2) return null;
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90) return null;
    if (lng < -180 || lng > 180) return null;
    return { lat, lng };
}

/**
 * Decide whether/how a normalized text query runs:
 * - length 0–1: blocked unless it looks like a Plus Code or coordinate.
 * - length 2: allowed, but `prefix` mode (no `%q%` trigram fuzzy search).
 * - length 3+: full search.
 */
export function planPublicSearch(q: string): PublicSearchPlan {
    const trimmed = q.trim();
    const len = trimmed.length;

    if (len <= 1) {
        if (isLikelyPlusCode(trimmed) || isLikelyCoordinate(trimmed)) {
            return { allowed: true, mode: "full" };
        }
        return { allowed: false };
    }

    if (len === 2) {
        return { allowed: true, mode: "prefix" };
    }

    return { allowed: true, mode: "full" };
}

/** Detect a Postgres `statement_timeout` cancellation (SQLSTATE 57014). */
export function isStatementTimeoutError(error: unknown): boolean {
    if (!error) return false;
    const code = (error as { code?: unknown; meta?: { code?: unknown } }).code;
    const metaCode = (error as { meta?: { code?: unknown } }).meta?.code;
    if (code === "57014" || metaCode === "57014") return true;
    const message = error instanceof Error ? error.message : String(error);
    return /statement timeout|canceling statement due to statement timeout/i.test(message);
}

export function serializeUnifiedSearchResult(row: UnifiedSearchRow): UnifiedSearchResult {
    const center: [number, number] | null =
        row.lng !== null &&
        row.lat !== null &&
        Number.isFinite(row.lng) &&
        Number.isFinite(row.lat)
            ? [row.lng, row.lat]
            : null;

    const bbox: [number, number, number, number] | null =
        row.min_lng !== null &&
        row.min_lat !== null &&
        row.max_lng !== null &&
        row.max_lat !== null
            ? [row.min_lng, row.min_lat, row.max_lng, row.max_lat]
            : null;

    return {
        entityType: row.entity_type,
        entityId: row.entity_id,
        publicId: row.public_id,
        displayName: normalizeName(row.display_name),
        subtitle: normalizeName(row.subtitle),
        primaryNameMy: normalizeName(row.primary_name_my),
        primaryNameEn: normalizeName(row.primary_name_en),
        matchedName: normalizeName(row.matched_name),
        geometryType: row.geometry_type,
        center,
        bbox,
        hasGeometry: row.has_geometry,
        categoryCode: row.category_code,
        categoryName: normalizeName(row.category_name_en) ?? normalizeName(row.category_name_my),
        adminAreaNameMy: normalizeName(row.admin_area_name_my),
        adminAreaNameEn: normalizeName(row.admin_area_name_en),
        score: Math.round(row.score * 100) / 100,
        isVerified: row.is_verified,
        confidenceScore: row.confidence_score,
        boundaryConfidenceScore: row.boundary_confidence_score,
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
