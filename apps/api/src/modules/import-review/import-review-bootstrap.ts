import type { FastifyBaseLogger } from "fastify";

import { getImportReviewPrisma } from "../../lib/import-review-prisma.js";
import {
    throwIfImportReviewProductionLocalhostMismatch,
    verifyImportReviewSchemaOrThrow,
} from "./import-review-database-url.js";
import { logImportReviewDatabaseStartup } from "./import-review-config.js";

/**
 * Validates import_review targets (host safety, schema presence) and emits structured startup logs.
 * Call once during Fastify bootstrap before import-review routes rely on Postgres.
 */
export async function bootstrapImportReviewDatabase(logger: FastifyBaseLogger): Promise<void> {
    throwIfImportReviewProductionLocalhostMismatch();
    logImportReviewDatabaseStartup(logger);

    await verifyImportReviewSchemaOrThrow(getImportReviewPrisma());
}
