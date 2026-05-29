import type { FastifyPluginAsync } from "fastify";

import { buildVerificationSummary } from "../../lib/verification-summary/verification-summary.repo.js";
import { CORE_REVIEW_VERIFICATION_SUMMARY_CONFIGS } from "../core-review/core-review-verification-summary.config.js";

const SUCCESSOR_SUMMARY_PATH = "/core-review/verification-summary";

/**
 * Temporary compatibility for retired GET /api/core-verification/summary.
 * Returns the Core Review verification summary payload with Deprecation headers.
 */
const coreVerificationCompatRoutes: FastifyPluginAsync = async (app) => {
    app.get(
        "/summary",
        { preHandler: app.authenticate },
        async (_request, reply) => {
            reply.header("Deprecation", "true");
            reply.header("Link", `<${SUCCESSOR_SUMMARY_PATH}>; rel="successor-version"`);
            return reply.send(
                await buildVerificationSummary(app.prisma, CORE_REVIEW_VERIFICATION_SUMMARY_CONFIGS)
            );
        }
    );

    app.route({
        method: ["GET", "PATCH", "POST", "PUT", "DELETE"],
        url: "/*",
        handler: async (_request, reply) => {
            return reply.code(410).send({
                message:
                    "The core-verification API is retired. Use Core Review list endpoints and /core-review/verification-summary.",
                successor: SUCCESSOR_SUMMARY_PATH,
            });
        },
    });
};

export default coreVerificationCompatRoutes;
