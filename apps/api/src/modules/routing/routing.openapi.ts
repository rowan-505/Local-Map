const routeWaypointOpenApi = {
    type: "object",
    required: ["lat", "lng"],
    properties: {
        lat: { type: "number", minimum: -90, maximum: 90 },
        lng: { type: "number", minimum: -180, maximum: 180 },
        label: { type: "string" },
    },
} as const;

const routeGeoJsonLineStringOpenApi = {
    type: "object",
    nullable: true,
    required: ["type", "coordinates"],
    properties: {
        type: { type: "string", enum: ["LineString"] },
        coordinates: {
            type: "array",
            minItems: 2,
            items: {
                type: "array",
                minItems: 2,
                maxItems: 2,
                items: { type: "number" },
            },
        },
    },
} as const;

const routeLegOpenApi = {
    type: "object",
    required: ["mode", "distanceMeters", "durationSeconds", "from", "to"],
    properties: {
        mode: {
            type: "string",
            enum: ["road", "walk", "transit", "transfer", "wait", "air"],
        },
        profile: { type: "string" },
        physicalMode: { type: "string" },
        serviceClass: { type: "string" },
        distanceMeters: { type: "number", minimum: 0 },
        durationSeconds: { type: "number", minimum: 0 },
        from: routeWaypointOpenApi,
        to: routeWaypointOpenApi,
        geometry: routeGeoJsonLineStringOpenApi,
        transit: {
            type: "object",
            nullable: true,
            properties: {
                agencyName: { type: "string" },
                routeShortName: { type: "string" },
                routeLongName: { type: "string" },
                headsign: { type: "string" },
                serviceClass: { type: "string" },
                physicalMode: { type: "string" },
            },
        },
        instructions: { type: "array", items: { type: "string" } },
    },
} as const;

const postRouteResponseOpenApi = {
    type: "object",
    required: ["status", "routingEngine", "profile", "summary", "geometry", "legs", "warnings"],
    properties: {
        status: { type: "string", enum: ["ok", "no_route", "error"] },
        routingEngine: { type: "string", enum: ["valhalla", "otp", "external", "mock"] },
        profile: { type: "string" },
        summary: {
            type: "object",
            required: ["distanceMeters", "durationSeconds", "transferCount"],
            properties: {
                distanceMeters: { type: "number", minimum: 0 },
                durationSeconds: { type: "number", minimum: 0 },
                transferCount: { type: "integer", minimum: 0 },
            },
        },
        geometry: routeGeoJsonLineStringOpenApi,
        legs: { type: "array", items: routeLegOpenApi },
        warnings: { type: "array", items: { type: "string" } },
        debug: {
            type: "object",
            properties: {
                buildCode: { type: "string" },
                requestId: { type: "string" },
            },
        },
    },
} as const;

const routingErrorResponseOpenApi = {
    type: "object",
    properties: {
        message: { type: "string" },
        code: { type: "string" },
        details: {},
        issues: {},
        engine: { type: "string" },
        upstreamStatus: { type: ["integer", "null"] },
    },
} as const;

export const getRoutingHealthSchema = {
    tags: ["routing"],
    summary: "Routing service health",
    description:
        "Returns ROUTING_ENABLED state, configured public profiles, and Valhalla engine health when applicable.",
    response: {
        200: {
            type: "object",
            required: [
                "routingEnabled",
                "defaultEngine",
                "configuredPublicProfiles",
                "activeEngine",
                "engineHealth",
            ],
            properties: {
                routingEnabled: { type: "boolean" },
                defaultEngine: { type: "string" },
                configuredPublicProfiles: { type: "array", items: { type: "string" } },
                activeEngine: { type: "string" },
                engineHealth: {
                    type: ["object", "null"],
                    properties: {
                        engine: { type: "string" },
                        status: { type: "string", enum: ["healthy", "degraded", "down", "unknown"] },
                        latencyMs: { type: "integer" },
                        message: { type: "string" },
                        checkedAt: { type: "string" },
                    },
                },
            },
        },
    },
} as const;

export const getRoutingProfilesSchema = {
    tags: ["routing"],
    summary: "List public routing profiles",
    description:
        "Reads routing.routing_profiles when available; falls back to ROUTING_PUBLIC_PROFILES env list.",
    response: {
        200: {
            type: "object",
            required: ["profiles", "source"],
            properties: {
                source: { type: "string", enum: ["database", "env"] },
                profiles: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["code", "name", "isPublicEnabled", "isRoutingEnabled", "sortOrder", "source"],
                        properties: {
                            code: { type: "string" },
                            name: { type: "string" },
                            description: { type: ["string", "null"] },
                            isPublicEnabled: { type: "boolean" },
                            isRoutingEnabled: { type: "boolean" },
                            sortOrder: { type: "integer" },
                            primaryPhysicalModeCode: { type: ["string", "null"] },
                            source: { type: "string", enum: ["database", "env"] },
                        },
                    },
                },
            },
        },
    },
} as const;

export const postRoutingRouteSchema = {
    tags: ["routing"],
    summary: "Compute a route between two points",
    description:
        "Road directions via Valhalla adapter (walk, car, motorcycle). Requires ROUTING_ENABLED=true. " +
        "Returns normalized geometry and legs — not raw Valhalla JSON.",
    body: {
        type: "object",
        required: ["origin", "destination", "profile"],
        properties: {
            origin: routeWaypointOpenApi,
            destination: routeWaypointOpenApi,
            profile: {
                type: "string",
                enum: ["walk", "car", "motorcycle", "multimodal"],
            },
            allowedModes: {
                type: "array",
                items: {
                    type: "string",
                    enum: ["walk", "car", "motorcycle", "bus", "rail", "ferry", "air"],
                },
            },
            excludedModes: {
                type: "array",
                items: {
                    type: "string",
                    enum: ["walk", "car", "motorcycle", "bus", "rail", "ferry", "air"],
                },
            },
            serviceClasses: {
                type: "array",
                items: {
                    type: "string",
                    enum: ["local", "express", "intercity", "premium", "airport_shuttle"],
                },
            },
            preference: { type: "string", enum: ["fastest", "shortest", "balanced"] },
            departureTime: { type: "string", format: "date-time", nullable: true },
            maxWalkMeters: { type: "number", minimum: 0 },
            maxTransfers: { type: "integer", minimum: 0 },
        },
    },
    response: {
        200: postRouteResponseOpenApi,
        400: routingErrorResponseOpenApi,
        503: routingErrorResponseOpenApi,
        502: routingErrorResponseOpenApi,
        504: routingErrorResponseOpenApi,
    },
} as const;

export const postRoutingFeedbackSchema = {
    tags: ["routing"],
    summary: "Submit routing feedback",
    description:
        "Stores user feedback in routing.routing_feedback when the table exists; otherwise returns an accepted stub id.",
    body: {
        type: "object",
        required: ["origin", "destination", "profile", "problemType"],
        properties: {
            requestId: { type: "string", format: "uuid" },
            origin: routeWaypointOpenApi,
            destination: routeWaypointOpenApi,
            profile: { type: "string" },
            problemType: {
                type: "string",
                enum: [
                    "wrong_route",
                    "missing_road",
                    "road_closed",
                    "bad_oneway",
                    "bad_motorbike_route",
                    "bad_walk_route",
                    "dangerous_route",
                    "bad_eta",
                    "cannot_route",
                    "other",
                ],
            },
            message: { type: "string", maxLength: 4000 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["publicId", "status", "stored"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                status: { type: "string" },
                stored: { type: "boolean" },
            },
        },
        400: routingErrorResponseOpenApi,
    },
} as const;

export const postRoutingAdminBuildGraphSchema = {
    tags: ["routing"],
    summary: "Build a tiny routing graph from selected core.core_streets rows",
    description:
        "Generates routing.routing_nodes, routing.routing_edges, routing.routing_edge_names, and validation reports for a scoped batch. Requires ENABLE_ROUTING_GRAPH_BUILD=true.",
    security: [{ bearerAuth: [] }],
    body: {
        type: "object",
        required: ["profile_code"],
        properties: {
            profile_code: { type: "string", enum: ["walk", "drive", "bus"] },
            source_publish_batch_id: { type: "string", pattern: "^\\d+$" },
            source_review_batch_id: { type: "string", pattern: "^\\d+$" },
            bbox: {
                type: "object",
                required: ["min_lon", "min_lat", "max_lon", "max_lat"],
                properties: {
                    min_lon: { type: "number" },
                    min_lat: { type: "number" },
                    max_lon: { type: "number" },
                    max_lat: { type: "number" },
                },
            },
            region_code: { type: "string" },
            max_roads: { type: "integer", minimum: 1, maximum: 10000, default: 25 },
            dry_run: { type: "boolean", default: false },
        },
    },
    response: {
        200: {
            type: "object",
            properties: {
                build_job_id: { type: "string" },
                build_job_public_id: { type: "string" },
                status: { type: "string", enum: ["completed", "failed", "dry_run"] },
                dry_run: { type: "boolean" },
                profile_code: { type: "string" },
                selected_core_road_count: { type: "integer" },
                generated_node_count: { type: "integer" },
                generated_edge_count: { type: "integer" },
                generated_edge_name_count: { type: "integer" },
                warning_count: { type: "integer" },
                error_count: { type: "integer" },
                validation_codes: { type: "array", items: { type: "string" } },
                message: { type: "string" },
                metadata_id: { type: "string", nullable: true },
            },
        },
        400: {
            type: "object",
            properties: {
                message: { type: "string" },
            },
        },
        403: {
            type: "object",
            properties: {
                message: { type: "string" },
            },
        },
        409: {
            type: "object",
            properties: {
                message: { type: "string" },
            },
        },
    },
} as const;
