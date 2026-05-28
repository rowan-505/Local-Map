import type { RoutingRouteProfileCode } from "../routing.config.js";
import type {
    NormalizedRouteRequest,
    NormalizedRouteResponse,
    RouteGeoJsonLineString,
    RouteLeg,
    RouteWaypoint,
} from "../routing.types.js";
import {
    RoutingEngineInvalidResponseError,
    RoutingEngineUpstreamError,
} from "../routing.errors.js";
import { decodeValhallaPolyline } from "./valhalla-polyline.js";
import { resolveValhallaCosting } from "./profile-to-valhalla-costing.js";

/** Valhalla HTTP /route payload (internal — not exported to API clients). */
export type ValhallaRouteRequestPayload = {
    locations: { lat: number; lon: number }[];
    costing: string;
    directions_options?: { units: "kilometers" | "miles" };
    shape_format?: "geojson" | "polyline6" | "polyline";
};

export type ValhallaRouteRequestBuild = {
    payload: ValhallaRouteRequestPayload;
    profileWarnings: string[];
};

type ValhallaLocation = { lat: number; lon: number };

type ValhallaManeuver = {
    instruction?: string;
    verbal_transition_alert_instruction?: string;
    length?: number;
    time?: number;
};

type ValhallaLegSummary = {
    length?: number;
    time?: number;
    has_time_restrictions?: boolean;
    has_toll?: boolean;
    has_highway?: boolean;
};

type ValhallaLeg = {
    summary?: ValhallaLegSummary;
    shape?: string | RouteGeoJsonLineString;
    maneuvers?: ValhallaManeuver[];
};

type ValhallaTrip = {
    status?: number;
    status_message?: string;
    summary?: ValhallaLegSummary;
    legs?: ValhallaLeg[];
    shape?: string | RouteGeoJsonLineString;
    alerts?: { description?: string; text?: string }[];
};

type ValhallaRouteResponsePayload = {
    trip?: ValhallaTrip;
    error?: string;
    error_code?: number;
    status_code?: number;
};

export type MapValhallaRouteOptions = {
    extraWarnings?: string[];
};

function toValhallaLocation(waypoint: RouteWaypoint): ValhallaLocation {
    return { lat: waypoint.lat, lon: waypoint.lng };
}

/** Valhalla trip/leg lengths use `directions_options.units` (we request kilometers). */
function kilometersToMeters(kilometers: number | undefined): number {
    if (kilometers === undefined || Number.isNaN(kilometers)) {
        return 0;
    }
    return Math.max(0, Math.round(kilometers * 1000));
}

function secondsRounded(seconds: number | undefined): number {
    if (seconds === undefined || Number.isNaN(seconds)) {
        return 0;
    }
    return Math.max(0, Math.round(seconds));
}

export function buildValhallaRouteRequest(
    request: NormalizedRouteRequest,
    options?: { forceAutoForMotorcycle?: boolean }
): ValhallaRouteRequestBuild {
    const { costing, profileWarnings } = resolveValhallaCosting(request.profile, options);

    return {
        profileWarnings,
        payload: {
            locations: [toValhallaLocation(request.origin), toValhallaLocation(request.destination)],
            costing,
            directions_options: { units: "kilometers" },
            shape_format: "geojson",
        },
    };
}

/** @deprecated Use {@link buildValhallaRouteRequest}. */
export function buildValhallaRouteRequestPayload(
    request: NormalizedRouteRequest
): ValhallaRouteRequestPayload {
    return buildValhallaRouteRequest(request).payload;
}

function isGeoJsonLineString(value: unknown): value is RouteGeoJsonLineString {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as RouteGeoJsonLineString;
    return (
        candidate.type === "LineString" &&
        Array.isArray(candidate.coordinates) &&
        candidate.coordinates.length >= 2
    );
}

function shapeToLineString(shape: unknown, warnings: string[]): RouteGeoJsonLineString | null {
    if (isGeoJsonLineString(shape)) {
        return shape;
    }

    if (typeof shape === "string" && shape.length > 0) {
        const coordinates = decodeValhallaPolyline(shape, 6);
        if (coordinates.length >= 2) {
            warnings.push("Decoded Valhalla encoded polyline shape (geojson was not returned).");
            return { type: "LineString", coordinates: [...coordinates] };
        }
    }

    return null;
}

function mergeLegGeometries(legs: ValhallaLeg[], warnings: string[]): RouteGeoJsonLineString | null {
    const coordinates: [number, number][] = [];

    for (const leg of legs) {
        const line = shapeToLineString(leg.shape, warnings);
        if (!line) {
            continue;
        }
        for (const coord of line.coordinates) {
            const lng = coord[0];
            const lat = coord[1];
            const last = coordinates.at(-1);
            if (last && last[0] === lng && last[1] === lat) {
                continue;
            }
            coordinates.push([lng, lat]);
        }
    }

    if (coordinates.length < 2) {
        return null;
    }

    return { type: "LineString", coordinates };
}

function mapManeuverInstructions(maneuvers: ValhallaManeuver[] | undefined): string[] {
    if (!maneuvers?.length) {
        return [];
    }

    return maneuvers
        .map((maneuver) => maneuver.instruction?.trim())
        .filter((instruction): instruction is string => Boolean(instruction));
}

function collectTripWarnings(trip: ValhallaTrip, leg: ValhallaLeg): string[] {
    const warnings: string[] = [];

    for (const alert of trip.alerts ?? []) {
        const text = alert.description?.trim() || alert.text?.trim();
        if (text) {
            warnings.push(text);
        }
    }

    const summary = leg.summary;
    if (summary?.has_time_restrictions) {
        warnings.push("Route may include time restrictions.");
    }
    if (summary?.has_toll) {
        warnings.push("Route may include toll roads.");
    }

    return warnings;
}

function mapValhallaLeg(
    leg: ValhallaLeg,
    trip: ValhallaTrip,
    profile: RoutingRouteProfileCode,
    from: RouteWaypoint,
    to: RouteWaypoint,
    warnings: string[]
): RouteLeg {
    const geometry = shapeToLineString(leg.shape, warnings);
    const instructions = mapManeuverInstructions(leg.maneuvers);

    return {
        mode: profile === "walk" ? "walk" : "road",
        profile,
        distanceMeters: kilometersToMeters(leg.summary?.length),
        durationSeconds: secondsRounded(leg.summary?.time),
        from,
        to,
        geometry,
        instructions: instructions.length > 0 ? instructions : undefined,
        transit: null,
    };
}

export function mapValhallaRouteResponse(
    payload: unknown,
    request: NormalizedRouteRequest,
    options: MapValhallaRouteOptions = {}
): NormalizedRouteResponse {
    if (!payload || typeof payload !== "object") {
        throw new RoutingEngineInvalidResponseError("valhalla", "Valhalla returned a non-JSON response.");
    }

    const body = payload as ValhallaRouteResponsePayload;
    const warnings: string[] = [...(options.extraWarnings ?? [])];

    if (body.error || body.error_code) {
        const message = body.error ?? "Valhalla returned an error.";
        if (body.error_code === 442 || body.error_code === 443 || body.error_code === 444) {
            return {
                status: "no_route",
                routingEngine: "valhalla",
                profile: request.profile,
                summary: { distanceMeters: 0, durationSeconds: 0, transferCount: 0 },
                geometry: null,
                legs: [],
                warnings: [message],
            };
        }
        throw new RoutingEngineUpstreamError("valhalla", message, {
            statusCode: 502,
            upstreamStatus: body.error_code,
        });
    }

    const trip = body.trip;
    if (!trip) {
        throw new RoutingEngineInvalidResponseError("valhalla", "Valhalla response missing trip.");
    }

    if (trip.status !== undefined && trip.status !== 0) {
        return {
            status: "no_route",
            routingEngine: "valhalla",
            profile: request.profile,
            summary: { distanceMeters: 0, durationSeconds: 0, transferCount: 0 },
            geometry: null,
            legs: [],
            warnings: [trip.status_message ?? "No route found."],
        };
    }

    const legs = trip.legs ?? [];
    const geometry =
        shapeToLineString(trip.shape, warnings) ?? (legs.length > 0 ? mergeLegGeometries(legs, warnings) : null);

    const mappedLegs: RouteLeg[] =
        legs.length > 0
            ? legs.map((leg, index) => {
                  const from = index === 0 ? request.origin : request.destination;
                  const to = index === legs.length - 1 ? request.destination : request.origin;
                  warnings.push(...collectTripWarnings(trip, leg));
                  return mapValhallaLeg(leg, trip, request.profile, from, to, warnings);
              })
            : [
                  {
                      mode: request.profile === "walk" ? "walk" : "road",
                      profile: request.profile,
                      distanceMeters: kilometersToMeters(trip.summary?.length),
                      durationSeconds: secondsRounded(trip.summary?.time),
                      from: request.origin,
                      to: request.destination,
                      geometry,
                      transit: null,
                  },
              ];

    const uniqueWarnings = [...new Set(warnings.filter((w) => w.length > 0))];

    return {
        status: "ok",
        routingEngine: "valhalla",
        profile: request.profile,
        summary: {
            distanceMeters: kilometersToMeters(trip.summary?.length),
            durationSeconds: secondsRounded(trip.summary?.time),
            transferCount: Math.max(0, mappedLegs.length - 1),
        },
        geometry,
        legs: mappedLegs,
        warnings: uniqueWarnings,
    };
}
