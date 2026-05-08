/** OpenAPI tag names — keep aligned with docs/api-route-inventory.md */
export const Tags = {
    Health: "Health",
    Auth: "Auth",
    User: "User",
    Categories: "Categories",
    AdminAreas: "Admin Areas",
    Places: "Places",
    Streets: "Streets",
    Buildings: "Buildings",
    Dashboard: "Dashboard",
    Stats: "Stats",
    Transit: "Transit",
    Search: "Search",
} as const;

export const bearerAuth = [{ bearerAuth: [] }] as const;

/** Zod `flatten()`-shaped validation detail (structure matches typical Zod output). */
export const zodFlattenIssuesSchema = {
    type: "object",
    properties: {
        formErrors: { type: "array", items: { type: "string" } },
        fieldErrors: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } },
        },
    },
    additionalProperties: false,
} as const;

export const messageSchema = {
    type: "object",
    required: ["message"],
    properties: {
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const badRequestSchema = {
    type: "object",
    required: ["message"],
    properties: {
        message: { type: "string" },
        issues: zodFlattenIssuesSchema,
    },
    additionalProperties: false,
} as const;

export const forbiddenSchema = messageSchema;
export const notFoundSchema = messageSchema;
export const conflictSchema = messageSchema;
export const unauthorizedSchema = messageSchema;

/** Map overlay feature properties: string or boolean values. */
export const geoFeaturePropertiesSchema = {
    type: "object",
    additionalProperties: {
        oneOf: [{ type: "string" }, { type: "boolean" }],
    },
} as const;

/** GeoJSON geometry per RFC 7946 (`coordinates` shape depends on `type`). */
export const geoJsonGeometrySchema = {
    type: "object",
    description: "GeoJSON Geometry object (Point, LineString, Polygon, MultiPolygon, etc.)",
    properties: {
        type: { type: "string" },
        coordinates: { description: "Coordinate positions per geometry type" },
        bbox: { type: "array", items: { type: "number" } },
    },
    additionalProperties: false,
} as const;

export const geoJsonFeatureCollectionSchema = {
    type: "object",
    required: ["type", "features"],
    properties: {
        type: { type: "string", enum: ["FeatureCollection"] },
        features: {
            type: "array",
            items: {
                type: "object",
                required: ["type", "geometry", "properties"],
                properties: {
                    type: { type: "string", enum: ["Feature"] },
                    id: { type: "string" },
                    geometry: geoJsonGeometrySchema,
                    properties: geoFeaturePropertiesSchema,
                },
                additionalProperties: false,
            },
        },
    },
    additionalProperties: false,
} as const;
