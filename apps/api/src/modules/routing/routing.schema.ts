import { z } from "zod";

import {
    isRoutingPhysicalModeCode,
    isRoutingPhysicalModeEnabled,
    isRoutingRouteProfileCode,
    isRoutingRouteProfileEnabled,
    isRoutingServiceClassCode,
    ROUTING_ENGINE_CODES,
    ROUTING_GRAPH_BUILD_DEFAULT_MAX_ROADS,
    ROUTING_GRAPH_PROFILE_CODES,
    ROUTING_LEG_MODE_CODES,
    ROUTING_PHYSICAL_MODE_CODES,
    ROUTING_ROUTE_PREFERENCE_CODES,
    ROUTING_ROUTE_PROFILE_CODES,
    ROUTING_ROUTE_STATUS_CODES,
    ROUTING_SERVICE_CLASS_CODES,
} from "./routing.config.js";
import {
    RoutingModeDisabledError,
    RoutingModeUnsupportedError,
    RoutingProfileDisabledError,
    RoutingProfileUnsupportedError,
    RoutingServiceClassUnsupportedError,
} from "./routing.errors.js";
import type { PostRouteRequestBody } from "./routing.types.js";

// -----------------------------------------------------------------------------
// Graph build (admin)
// -----------------------------------------------------------------------------

const bboxSchema = z
    .object({
        min_lon: z.number().min(-180).max(180),
        min_lat: z.number().min(-90).max(90),
        max_lon: z.number().min(-180).max(180),
        max_lat: z.number().min(-90).max(90),
    })
    .refine((b) => b.min_lon <= b.max_lon && b.min_lat <= b.max_lat, {
        message: "bbox min values must be <= max values",
    });

export const buildRoutingGraphBodySchema = z.object({
    profile_code: z.enum(ROUTING_GRAPH_PROFILE_CODES),
    source_publish_batch_id: z.string().regex(/^\d+$/).optional(),
    source_review_batch_id: z.string().regex(/^\d+$/).optional(),
    bbox: bboxSchema.optional(),
    region_code: z.string().trim().min(1).max(64).optional(),
    max_roads: z.coerce
        .number()
        .int()
        .min(1)
        .max(10_000)
        .default(ROUTING_GRAPH_BUILD_DEFAULT_MAX_ROADS),
    dry_run: z.boolean().default(false),
});

export type BuildRoutingGraphBody = z.infer<typeof buildRoutingGraphBodySchema>;

// -----------------------------------------------------------------------------
// Universal route API
// -----------------------------------------------------------------------------

const routeWaypointSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().trim().min(1).max(512).optional(),
});

const routeModeListSchema = z
    .array(z.string().trim().min(1).max(64))
    .max(16)
    .optional();

const routeServiceClassListSchema = z
    .array(z.string().trim().min(1).max(64))
    .max(16)
    .optional();

export const postRouteRequestBodySchema = z
    .object({
        origin: routeWaypointSchema,
        destination: routeWaypointSchema,
        profile: z.enum(ROUTING_ROUTE_PROFILE_CODES),
        allowedModes: routeModeListSchema,
        excludedModes: routeModeListSchema,
        serviceClasses: routeServiceClassListSchema,
        preference: z.enum(ROUTING_ROUTE_PREFERENCE_CODES).optional(),
        departureTime: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
        maxWalkMeters: z.number().min(0).max(50_000).optional(),
        maxTransfers: z.number().int().min(0).max(20).optional(),
    })
    .refine(
        (body) =>
            body.origin.lat !== body.destination.lat || body.origin.lng !== body.destination.lng,
        {
            message: "origin and destination must not be identical",
            path: ["destination"],
        }
    );

export type PostRouteRequestBodyParsed = z.infer<typeof postRouteRequestBodySchema>;

export const routeGeoJsonLineStringSchema = z.object({
    type: z.literal("LineString"),
    coordinates: z
        .array(z.tuple([z.number(), z.number()]))
        .min(2, { message: "LineString must have at least two positions" }),
});

export const routeLegTransitDetailsSchema = z.object({
    agencyName: z.string().optional(),
    routeShortName: z.string().optional(),
    routeLongName: z.string().optional(),
    headsign: z.string().optional(),
    serviceClass: z.string().optional(),
    physicalMode: z.string().optional(),
});

export const routeLegSchema = z.object({
    mode: z.enum(ROUTING_LEG_MODE_CODES),
    profile: z.string().optional(),
    physicalMode: z.string().optional(),
    serviceClass: z.string().optional(),
    distanceMeters: z.number().min(0),
    durationSeconds: z.number().min(0),
    from: routeWaypointSchema,
    to: routeWaypointSchema,
    geometry: routeGeoJsonLineStringSchema.nullable().optional(),
    transit: routeLegTransitDetailsSchema.nullable().optional(),
    instructions: z.array(z.string()).optional(),
});

export const routeSummarySchema = z.object({
    distanceMeters: z.number().min(0),
    durationSeconds: z.number().min(0),
    transferCount: z.number().int().min(0),
});

export const routeResponseDebugSchema = z.object({
    buildCode: z.string().optional(),
    requestId: z.string().optional(),
});

export const postRouteResponseBodySchema = z.object({
    status: z.enum(ROUTING_ROUTE_STATUS_CODES),
    routingEngine: z.enum(ROUTING_ENGINE_CODES),
    profile: z.string(),
    summary: routeSummarySchema,
    geometry: routeGeoJsonLineStringSchema.nullable(),
    legs: z.array(routeLegSchema),
    warnings: z.array(z.string()),
    debug: routeResponseDebugSchema.optional(),
});

export type PostRouteResponseBodyParsed = z.infer<typeof postRouteResponseBodySchema>;

function validateModeList(modes: readonly string[] | undefined): void {
    if (!modes?.length) {
        return;
    }

    for (const mode of modes) {
        if (!isRoutingPhysicalModeCode(mode)) {
            throw new RoutingModeUnsupportedError(mode);
        }
        if (!isRoutingPhysicalModeEnabled(mode)) {
            throw new RoutingModeDisabledError(mode);
        }
    }
}

function validateServiceClassList(serviceClasses: readonly string[] | undefined): void {
    if (!serviceClasses?.length) {
        return;
    }

    for (const serviceClass of serviceClasses) {
        if (!isRoutingServiceClassCode(serviceClass)) {
            throw new RoutingServiceClassUnsupportedError(serviceClass);
        }
    }
}

/**
 * Enforces routing policy after Zod structural validation.
 * @throws {RoutingProfileUnsupportedError}
 * @throws {RoutingProfileDisabledError}
 * @throws {RoutingModeUnsupportedError}
 * @throws {RoutingModeDisabledError}
 * @throws {RoutingServiceClassUnsupportedError}
 */
export function assertRoutingRouteRequestPolicy(body: PostRouteRequestBody): void {
    const profile = body.profile;

    if (!isRoutingRouteProfileCode(profile)) {
        throw new RoutingProfileUnsupportedError(profile);
    }
    if (!isRoutingRouteProfileEnabled(profile)) {
        throw new RoutingProfileDisabledError(profile);
    }

    validateModeList(body.allowedModes);
    validateModeList(body.excludedModes);
    validateServiceClassList(body.serviceClasses);
}

/**
 * Parse and validate a POST /routing/route body (shape + policy).
 */
export function parsePostRouteRequestBody(input: unknown): PostRouteRequestBodyParsed {
    const parsed = postRouteRequestBodySchema.safeParse(input);
    if (!parsed.success) {
        throw parsed.error;
    }
    assertRoutingRouteRequestPolicy(parsed.data);
    return parsed.data;
}

/** Known physical mode codes for OpenAPI / docs. */
export const ROUTING_PHYSICAL_MODE_CODES_OPENAPI = [...ROUTING_PHYSICAL_MODE_CODES] as const;
