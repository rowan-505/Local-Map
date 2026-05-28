import { z } from "zod";

import { ROUTING_ROUTE_PROFILE_CODES } from "./routing.config.js";

const feedbackWaypointSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
});

export const ROUTING_FEEDBACK_PROBLEM_TYPES = [
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
] as const;

export type RoutingFeedbackProblemType = (typeof ROUTING_FEEDBACK_PROBLEM_TYPES)[number];

export const postRoutingFeedbackBodySchema = z.object({
    requestId: z.string().uuid().optional(),
    origin: feedbackWaypointSchema,
    destination: feedbackWaypointSchema,
    profile: z.enum(ROUTING_ROUTE_PROFILE_CODES),
    problemType: z.enum(ROUTING_FEEDBACK_PROBLEM_TYPES),
    message: z.string().trim().min(1).max(4000).optional(),
});

export type PostRoutingFeedbackBody = z.infer<typeof postRoutingFeedbackBodySchema>;
