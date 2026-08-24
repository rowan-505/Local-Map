import { z } from "zod";

import {
    PUBLIC_SEARCH_CATEGORIES,
    PUBLIC_SEARCH_TRANSPORT_MODES,
    PUBLIC_SEARCH_TRANSPORT_TYPES,
} from "./public-search-filters.js";
import { PUBLIC_SEARCH_LANGS } from "./public-search-language.js";

export const publicPlaceIdParamsSchema = z.object({
    id: z.string().uuid(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_RE = /^\d+$/;

/** Public transport stop lookup: uuid public_id (preferred) or internal numeric id. */
export const publicTransportStopIdParamsSchema = z.object({
    id: z
        .string()
        .trim()
        .refine((v) => NUMERIC_ID_RE.test(v) || UUID_RE.test(v), {
            message: "id must be a numeric id or a uuid",
        }),
});

/** Optional display language for stop/terminal detail name resolution. */
export const publicTransportStopQuerySchema = z.object({
    lang: z.enum(["my", "en", "und"]).optional(),
});

/** Public transport terminal lookup: uuid public_id (preferred) or internal numeric id. */
export const publicTransportTerminalIdParamsSchema = publicTransportStopIdParamsSchema;

export const publicTransportTerminalQuerySchema = publicTransportStopQuerySchema;

export const publicPlacesQuerySchema = z.object({
    q: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    categoryId: z
        .string()
        .trim()
        .regex(/^\d+$/)
        .transform((value) => BigInt(value))
        .optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
});

/**
 * Entity types the public search endpoint can return (and that the web client can
 * render + fetch geometry for). Streets are served as grouped `street_group`
 * rows. Transport uses mode-agnostic `transport_*` types; legacy `bus_*` aliases
 * remain accepted in filters during migration.
 */
export const PUBLIC_SEARCH_ENTITY_TYPES = [
    "place",
    "settlement",
    "address",
    "transport_stop",
    "transport_terminal",
    "transport_route",
    "transport_route_variant",
    "bus_stop",
    "admin_area",
    "street_group",
    "street",
    "bus_route",
    "bus_route_variant",
    "building",
    "water_line",
    "water_polygon",
    "land_area",
] as const;

export type PublicSearchEntityType = (typeof PUBLIC_SEARCH_ENTITY_TYPES)[number];

const PUBLIC_SEARCH_ENTITY_TYPE_SET = new Set<string>(PUBLIC_SEARCH_ENTITY_TYPES);

export const publicSearchQuerySchema = z.object({
    q: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().trim().min(1).optional(),
    category: z.enum(PUBLIC_SEARCH_CATEGORIES).optional().default("all"),
    transportType: z.enum(PUBLIC_SEARCH_TRANSPORT_TYPES).optional().default("all"),
    mode: z.enum(PUBLIC_SEARCH_TRANSPORT_MODES).optional().default("all"),
    // Optional reference location (map center or user location) used to expand
    // short Plus Codes into full codes, and to bias ranking toward nearby results.
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    lang: z.enum(PUBLIC_SEARCH_LANGS).optional(),
    // Optional comma-separated entity-type filter (subset of PUBLIC_SEARCH_ENTITY_TYPES).
    // Unknown values are dropped; an empty/all-invalid list behaves as "no filter".
    types: z
        .string()
        .trim()
        .transform((value) =>
            value
                .split(",")
                .map((part) => part.trim().toLowerCase())
                .filter((part) => PUBLIC_SEARCH_ENTITY_TYPE_SET.has(part)),
        )
        .optional(),
});

/** Entity types whose full geometry can be fetched for a clicked search result. */
export const SEARCH_GEOMETRY_ENTITY_TYPES = [
    "place",
    "settlement",
    "address",
    "transport_stop",
    "transport_terminal",
    "transport_route",
    "transport_route_variant",
    "bus_stop",
    "admin_area",
    "street",
    "street_group",
    "bus_route",
    "bus_route_variant",
    "building",
    "water_line",
    "water_polygon",
    "land_area",
] as const;

export type SearchGeometryEntityType = (typeof SEARCH_GEOMETRY_ENTITY_TYPES)[number];

export const publicSearchGeometryParamsSchema = z.object({
    entityType: z.enum(SEARCH_GEOMETRY_ENTITY_TYPES),
    // Accepts the internal numeric id (as returned by unified search) or a uuid
    // public_id. Water lines/polygons only have a numeric id.
    entityId: z
        .string()
        .trim()
        .refine((v) => NUMERIC_ID_RE.test(v) || UUID_RE.test(v), {
            message: "entityId must be a numeric id or a uuid",
        }),
});

export const publicSearchGeometryQuerySchema = z.object({
    // Optional map zoom (0–24) used to pick a simplification tolerance for large
    // line/polygon geometries. Omitted => light default simplification.
    zoom: z.coerce.number().min(0).max(24).optional(),
});

/** Transport route entities that support the lightweight map-preview endpoint. */
export const SEARCH_MAP_PREVIEW_ENTITY_TYPES = [
    "transport_route",
    "transport_route_variant",
    "bus_route",
    "bus_route_variant",
] as const;

export type SearchMapPreviewEntityType = (typeof SEARCH_MAP_PREVIEW_ENTITY_TYPES)[number];

export const publicSearchMapPreviewParamsSchema = z.object({
    entityType: z.enum(SEARCH_MAP_PREVIEW_ENTITY_TYPES),
    entityId: z
        .string()
        .trim()
        .refine((v) => NUMERIC_ID_RE.test(v) || UUID_RE.test(v), {
            message: "entityId must be a numeric id or a uuid",
        }),
});

export const publicSearchMapPreviewQuerySchema = publicSearchGeometryQuerySchema;

export const publicAdminAreaSearchQuerySchema = z.object({
    q: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const publicAdminAreaIdParamsSchema = z.object({
    id: z.string().trim().regex(/^\d+$/, "Admin area id must be a positive integer"),
});

export const publicMapPlacesQuerySchema = z.object({
    bbox: z
        .string()
        .trim()
        .transform((value, ctx) => {
            const parts = value.split(",").map((part) => Number(part.trim()));

            if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
                ctx.addIssue({
                    code: "custom",
                    message: 'bbox must be "minLng,minLat,maxLng,maxLat"',
                });
                return z.NEVER;
            }

            const [minLng, minLat, maxLng, maxLat] = parts;
            const valid =
                minLng >= -180 &&
                maxLng <= 180 &&
                minLat >= -90 &&
                maxLat <= 90 &&
                minLng < maxLng &&
                minLat < maxLat;

            if (!valid) {
                ctx.addIssue({
                    code: "custom",
                    message: "bbox coordinates are out of range or not ordered",
                });
                return z.NEVER;
            }

            return [minLng, minLat, maxLng, maxLat] as [number, number, number, number];
        }),
    zoom: z.coerce.number().min(0).max(24),
    category: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(300).default(100),
    offset: z.coerce.number().int().min(0).default(0),
});

export const searchResultClickAnalyticsBodySchema = z.object({
    event_id: z.string().trim().uuid(),
    entity_type: z.string().trim().min(1).max(64),
    entity_id: z
        .string()
        .trim()
        .regex(/^\d+$/, "entity_id must be a numeric id"),
    clicked_rank: z.coerce.number().int().min(1).max(100),
    time_to_click_ms: z.coerce.number().int().min(0).max(1_800_000).optional(),
});
