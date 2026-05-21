import { z } from "zod";

const coord2Schema = z.tuple([z.number().finite(), z.number().finite()]);

export const pointGeometrySchema = z
    .object({
        type: z.literal("Point"),
        coordinates: coord2Schema,
    })
    .strict();

export const lineStringGeometrySchema = z
    .object({
        type: z.literal("LineString"),
        coordinates: z.array(coord2Schema).min(2),
    })
    .strict();

export const polygonGeometrySchema = z
    .object({
        type: z.literal("Polygon"),
        coordinates: z.array(z.array(coord2Schema)).min(1),
    })
    .strict();

export const multiPolygonGeometrySchema = z
    .object({
        type: z.literal("MultiPolygon"),
        coordinates: z.array(z.array(z.array(coord2Schema))).min(1),
    })
    .strict();

export const multiLineStringGeometrySchema = z
    .object({
        type: z.literal("MultiLineString"),
        coordinates: z.array(z.array(coord2Schema)).min(1),
    })
    .strict();

export const polygonOrMultiPolygonSchema = z.discriminatedUnion("type", [
    polygonGeometrySchema,
    multiPolygonGeometrySchema,
]);

export const lineStringOrMultiLineStringSchema = z.discriminatedUnion("type", [
    lineStringGeometrySchema,
    multiLineStringGeometrySchema,
]);

/** Accept `geometry` or `geom` from dashboard forms. */
export function geometryFieldSchema<T extends z.ZodType>(schema: T) {
    return z.union([schema, z.object({ geometry: schema }), z.object({ geom: schema })]).transform(
        (value) => {
            if (value && typeof value === "object" && "geometry" in value) {
                return value.geometry;
            }
            if (value && typeof value === "object" && "geom" in value) {
                return value.geom;
            }
            return value;
        },
    );
}

export function pointFieldSchema() {
    return z
        .union([
            pointGeometrySchema,
            z.object({ geometry: pointGeometrySchema }),
            z.object({ geom: pointGeometrySchema }),
            z.object({ pointGeom: pointGeometrySchema }),
            z.object({ point_geom: pointGeometrySchema }),
        ])
        .transform((value) => {
            if (value && typeof value === "object") {
                if ("geometry" in value) return value.geometry;
                if ("geom" in value) return value.geom;
                if ("pointGeom" in value) return value.pointGeom;
                if ("point_geom" in value) return value.point_geom;
            }
            return value as z.infer<typeof pointGeometrySchema>;
        });
}

export function optionalPointFieldSchema() {
    return pointFieldSchema().optional().nullable();
}

export function optionalEntranceFieldSchema() {
    return z
        .union([
            pointGeometrySchema,
            z.object({ entranceGeom: pointGeometrySchema }),
            z.object({ entrance_geom: pointGeometrySchema }),
        ])
        .transform((value) => {
            if (value && typeof value === "object") {
                if ("entranceGeom" in value) return value.entranceGeom;
                if ("entrance_geom" in value) return value.entrance_geom;
            }
            return value as z.infer<typeof pointGeometrySchema>;
        })
        .optional()
        .nullable();
}

export type PointGeometry = z.infer<typeof pointGeometrySchema>;
export type LineStringGeometry = z.infer<typeof lineStringGeometrySchema>;
export type PolygonOrMultiPolygon = z.infer<typeof polygonOrMultiPolygonSchema>;
