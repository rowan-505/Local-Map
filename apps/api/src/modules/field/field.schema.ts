import { z } from "zod";

export const fieldBootstrapQuerySchema = z.object({
    revision: z.string().trim().min(1).max(80).optional(),
});

export type FieldBootstrapQuery = z.infer<typeof fieldBootstrapQuerySchema>;

const geoJsonLineStringSchema = z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
});

export const fieldRouteSchema = z.object({
    publicId: z.string().uuid(),
    routeCode: z.string(),
    nameMy: z.string().nullable(),
    nameEn: z.string().nullable(),
});

export const fieldVariantSchema = z.object({
    publicId: z.string().uuid(),
    routePublicId: z.string().uuid(),
    variantCode: z.enum(["D0", "D1"]),
    directionId: z.union([z.literal(0), z.literal(1)]),
    originName: z.string().nullable(),
    destinationName: z.string().nullable(),
});

export const fieldStopSchema = z.object({
    publicId: z.string().uuid(),
    stopCode: z.string().nullable(),
    nameMy: z.string().nullable(),
    nameEn: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
});

export const fieldRouteStopSchema = z.object({
    variantPublicId: z.string().uuid(),
    stopPublicId: z.string().uuid(),
    stopSequence: z.number().int().positive(),
});

export const fieldRoutePathSchema = z.object({
    variantPublicId: z.string().uuid(),
    geometry: geoJsonLineStringSchema,
});

export const fieldBootstrapUnchangedSchema = z.object({
    snapshotRevision: z.string(),
    unchanged: z.literal(true),
});

export const fieldBootstrapSnapshotSchema = z.object({
    snapshotRevision: z.string(),
    unchanged: z.literal(false),
    routes: z.array(fieldRouteSchema),
    variants: z.array(fieldVariantSchema),
    stops: z.array(fieldStopSchema),
    routeStops: z.array(fieldRouteStopSchema),
    routePaths: z.array(fieldRoutePathSchema),
});

export const fieldBootstrapResponseSchema = z.discriminatedUnion("unchanged", [
    fieldBootstrapUnchangedSchema,
    fieldBootstrapSnapshotSchema,
]);

export type FieldRoute = z.infer<typeof fieldRouteSchema>;
export type FieldVariant = z.infer<typeof fieldVariantSchema>;
export type FieldStop = z.infer<typeof fieldStopSchema>;
export type FieldRouteStop = z.infer<typeof fieldRouteStopSchema>;
export type FieldRoutePath = z.infer<typeof fieldRoutePathSchema>;
export type FieldBootstrapResponse = z.infer<typeof fieldBootstrapResponseSchema>;
