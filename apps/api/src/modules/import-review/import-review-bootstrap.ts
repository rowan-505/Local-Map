import type { FastifyBaseLogger } from "fastify";

import { getImportReviewPrisma } from "../../db/import-review-prisma.js";
import {
    throwIfImportReviewProductionLocalhostMismatch,
    verifyImportReviewSchemaOrThrow,
} from "./import-review-database-url.js";
import { logImportReviewDatabaseStartup } from "./import-review-config.js";
import { markImportReviewFailed, markImportReviewReady } from "./import-review-readiness.js";

/** Max time the import_review schema check may take before we give up this attempt. */
export const IMPORT_REVIEW_BOOTSTRAP_TIMEOUT_MS = 8000;
/** Slow, non-aggressive retry cadence after a failed/timed-out attempt. */
export const IMPORT_REVIEW_BOOTSTRAP_RETRY_MS = 60_000;

/**
 * Race a promise against a timeout. On timeout the returned promise rejects with a
 * labelled Error (the underlying promise is abandoned, not cancelled). The timer is
 * unref'd so it never keeps the Node process alive on its own.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
        if (typeof timer.unref === "function") {
            timer.unref();
        }
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

/**
 * Validates import_review targets (host safety, schema presence) and emits structured
 * startup logs. The schema-presence query is time-boxed so a hung Supabase pooler
 * connection cannot block forever. Call once during bootstrap (AFTER app.listen()).
 */
export async function bootstrapImportReviewDatabase(logger: FastifyBaseLogger): Promise<void> {
    throwIfImportReviewProductionLocalhostMismatch();
    logImportReviewDatabaseStartup(logger);

    await withTimeout(
        verifyImportReviewSchemaOrThrow(getImportReviewPrisma()),
        IMPORT_REVIEW_BOOTSTRAP_TIMEOUT_MS,
        "[api] import-review DB bootstrap"
    );
}

/**
 * Fire-and-forget bootstrap runner used after `app.listen()`. Tracks readiness state,
 * logs the outcome, and on failure/timeout schedules a single slow retry (once per
 * minute) so a transient Supabase hang recovers without a redeploy — never an
 * infinite tight loop, and never crashes the process.
 */
export function startImportReviewBootstrap(logger: FastifyBaseLogger): void {
    void attemptImportReviewBootstrap(logger);
}

async function attemptImportReviewBootstrap(logger: FastifyBaseLogger): Promise<void> {
    logger.info("[api] import-review bootstrap starting after listen");
    try {
        await bootstrapImportReviewDatabase(logger);
        markImportReviewReady();
        logger.info("[api] import-review bootstrap OK");
    } catch (error) {
        markImportReviewFailed(error);
        const timedOut = error instanceof Error && error.message.includes("timed out");
        if (timedOut) {
            logger.error({ err: error }, "[api] import-review DB bootstrap timed out");
        } else {
            logger.error({ err: error }, "[api] import-review bootstrap failed after listen");
        }
        scheduleImportReviewBootstrapRetry(logger);
    }
}

function scheduleImportReviewBootstrapRetry(logger: FastifyBaseLogger): void {
    const timer = setTimeout(() => {
        logger.info("[api] import-review bootstrap retry");
        void attemptImportReviewBootstrap(logger);
    }, IMPORT_REVIEW_BOOTSTRAP_RETRY_MS);
    if (typeof timer.unref === "function") {
        timer.unref();
    }
}
