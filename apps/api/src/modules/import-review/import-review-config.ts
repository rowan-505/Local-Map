import type { FastifyBaseLogger } from "fastify";

import {
    getImportReviewDatabaseEnvSource,
    getImportReviewDatabaseUrlBase,
    parsePostgresUrlSanitized,
} from "./import-review-database-url.js";

export type { ParsedImportReviewDbTarget } from "./import-review-database-url.js";

export {
    getImportReviewDatabaseEnvSource,
    getImportReviewDatabaseUrlBase,
    logImportReviewBatchResolveHintsDev,
    parsePostgresUrlSanitized,
    throwIfImportReviewProductionLocalhostMismatch,
    verifyImportReviewSchemaOrThrow,
} from "./import-review-database-url.js";

/** Dev-only diagnostics (recent batch snapshots in logs — no response mutation). */
export function isImportReviewDevDiagnosticsEnabled(): boolean {
    return process.env.NODE_ENV !== "production";
}

/** Never logs passwords or raw URLs. */
export function logImportReviewDatabaseStartup(logger: FastifyBaseLogger): void {
    const identity = parsePostgresUrlSanitized(getImportReviewDatabaseUrlBase());

    if (!identity) {
        logger.error(
            {
                importReviewDatabaseTarget: {
                    host: "(unknown)",
                    port: "(unknown)",
                    database: "(unknown)",
                    user: "(unknown)",
                    selectedEnvSource: getImportReviewDatabaseEnvSource(),
                },
            },
            "import_review: could not parse DATABASE_URL / IMPORT_REVIEW_DATABASE_URL."
        );
        return;
    }

    logger.info(
        {
            importReviewDatabaseTarget: {
                host: identity.host,
                port: identity.port,
                database: identity.database,
                user: identity.user,
                sslmode: identity.sslmode,
                selectedEnvSource: getImportReviewDatabaseEnvSource(),
            },
        },
        "import-review database bootstrap"
    );
}
