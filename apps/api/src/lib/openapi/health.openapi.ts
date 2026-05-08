import type { FastifySchema } from "fastify";

import { Tags } from "./common.js";

export const healthGetSchema = {
    tags: [Tags.Health],
    summary: "Health check",
    description: "Liveness probe. No authentication required.",
    response: {
        200: {
            type: "object",
            required: ["ok"],
            properties: {
                ok: { type: "boolean", enum: [true] },
            },
            additionalProperties: false,
        },
    },
} satisfies FastifySchema;
