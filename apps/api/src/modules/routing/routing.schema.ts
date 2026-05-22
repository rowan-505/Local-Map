import { z } from "zod";

import {
    ROUTING_GRAPH_BUILD_DEFAULT_MAX_ROADS,
    ROUTING_GRAPH_PROFILE_CODES,
} from "./routing.config.js";

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
