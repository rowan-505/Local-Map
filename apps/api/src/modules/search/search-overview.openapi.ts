import type { FastifySchema } from "fastify";

import {
    Tags,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
} from "../../lib/openapi/common.js";

export const getSearchOverviewSchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Admin: search overview metrics",
    description:
        "Admin/super_admin. Lightweight summary counts for the Search dashboard overview.",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: [
                "total_search_documents",
                "total_aliases",
                "active_aliases",
                "unresolved_failed_searches",
                "today_searches",
                "overall_index_health_severity",
            ],
            properties: {
                total_search_documents: { type: "integer", minimum: 0 },
                total_aliases: { type: "integer", minimum: 0 },
                active_aliases: { type: "integer", minimum: 0 },
                unresolved_failed_searches: { type: "integer", minimum: 0 },
                today_searches: { type: "integer", minimum: 0 },
                overall_index_health_severity: {
                    type: "string",
                    enum: ["healthy", "warning", "critical"],
                },
            },
            additionalProperties: false,
        },
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;
