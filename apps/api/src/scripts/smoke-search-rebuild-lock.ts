/**
 * Integration smoke: concurrent search-family rebuild advisory-lock behavior.
 *
 * Usage (from repo root):
 *   npm --prefix apps/api run smoke:search-rebuild-lock
 *
 * Safety:
 * - Uses session/direct Postgres (advisory locks do not work on transaction pooler)
 * - Rebuilds only tiny families (water_lines, water_polygons)
 * - Set SMOKE_ALLOW_PRODUCTION_DB=1 to run against Supabase production ref
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "../..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

import { applyPrismaConnectionLimit } from "../db/prisma.js";
import { resolveRebuildViewForHealthFamily } from "../modules/search/search-index-health.js";
import {
    SEARCH_INDEX_REBUILD_LOCK_NAMESPACE,
    SearchIndexRebuildLockError,
    searchIndexRebuildLockKeys,
    withSearchIndexRebuildLocks,
} from "../modules/search/search-index-maintenance.lock.js";
import {
    SearchIndexMaintenanceService,
    type SearchIndexMaintenanceOperationResult,
} from "../modules/search/search-index-maintenance.service.js";

const TEST_FAMILY_A = "water_lines";
const TEST_FAMILY_B = "water_polygons";
const SMOKE_ACTOR = {
    publicId: "00000000-0000-0000-0000-000000000001",
    ipAddress: "127.0.0.1",
    userAgent: "smoke-search-rebuild-lock",
};

type TestResult = {
    name: string;
    pass: boolean;
    detail: string;
};

const results: TestResult[] = [];

function pass(name: string, detail: string): void {
    results.push({ name, pass: true, detail });
    console.log(`[smoke] PASS ${name}: ${detail}`);
}

function fail(name: string, detail: string): never {
    results.push({ name, pass: false, detail });
    console.error(`[smoke] FAIL ${name}: ${detail}`);
    throw new Error(detail);
}

function maskDbHost(url: string): string {
    return url.replace(/:[^:@]+@/, ":***@").split("@")[1]?.split("/")[0] ?? "(unset)";
}

function isLocalDatabaseUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes("localhost") || lower.includes("127.0.0.1");
}

function isTransactionPoolerUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes(":6543") || lower.includes("pgbouncer=true");
}

/**
 * Advisory locks are session-scoped. Prefer session pooler / direct Postgres, not transaction pooler.
 */
export function resolveLockTestDatabaseUrl(): string {
    const explicit = process.env.SEARCH_LOCK_TEST_DATABASE_URL?.trim();
    if (explicit) {
        return explicit;
    }

    const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
    if (databaseUrl) {
        if (isTransactionPoolerUrl(databaseUrl)) {
            const url = new URL(databaseUrl);
            url.port = "5432";
            url.searchParams.delete("pgbouncer");
            url.searchParams.delete("pool_timeout");
            if (!url.searchParams.has("connection_limit")) {
                url.searchParams.set("connection_limit", "1");
            }
            return url.toString();
        }
        return applyPrismaConnectionLimit(databaseUrl) ?? databaseUrl;
    }

    const local = process.env.LOCAL_DATABASE_URL?.trim();
    if (local && process.env.SEARCH_LOCK_USE_LOCAL === "1") {
        return local;
    }

    throw new Error("DATABASE_URL is not set.");
}

function assertSafeDatabaseUrl(url: string): void {
    const lower = url.toLowerCase();
    if (lower.includes("prod") || lower.includes("production")) {
        throw new Error("Refusing production-looking DATABASE_URL.");
    }
    if (url.includes("locghyuranqaqsnbxflc") && process.env.SMOKE_ALLOW_PRODUCTION_DB !== "1") {
        throw new Error(
            "Refusing Supabase production ref without SMOKE_ALLOW_PRODUCTION_DB=1. " +
                "Rebuild is safe for water_* families but use staging/local when possible.",
        );
    }
    if (isTransactionPoolerUrl(url)) {
        throw new Error(
            "Transaction pooler URL cannot validate session advisory locks. " +
                "Set SEARCH_LOCK_TEST_DATABASE_URL or LOCAL_DATABASE_URL.",
        );
    }
    console.log("[smoke] database host:", maskDbHost(url));
}

function createTestPrisma(databaseUrl: string): PrismaClient {
    return new PrismaClient({
        datasources: {
            db: {
                url: applyPrismaConnectionLimit(databaseUrl) ?? databaseUrl,
            },
        },
    });
}

function httpStatusForResult(result: SearchIndexMaintenanceOperationResult): number {
    if (result.status === "conflict") {
        return 409;
    }
    if (result.operation === "reindex_family" && result.status === "failed") {
        return 500;
    }
    return 200;
}

async function tryAcquireLock(
    prisma: PrismaClient,
    view: string,
): Promise<boolean> {
    const key = searchIndexRebuildLockKeys([view])[0];
    if (key === undefined) {
        return false;
    }
    const rows = await prisma.$queryRawUnsafe<Array<{ pg_try_advisory_lock: boolean }>>(
        "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS pg_try_advisory_lock",
        SEARCH_INDEX_REBUILD_LOCK_NAMESPACE,
        key,
    );
    const acquired = rows[0]?.pg_try_advisory_lock === true;
    if (acquired) {
        await prisma.$executeRawUnsafe(
            "SELECT pg_advisory_unlock($1::integer, $2::integer)",
            SEARCH_INDEX_REBUILD_LOCK_NAMESPACE,
            key,
        );
    }
    return acquired;
}

async function holdLock(prisma: PrismaClient, view: string): Promise<number> {
    const key = searchIndexRebuildLockKeys([view])[0];
    if (key === undefined) {
        throw new Error(`No lock key for view ${view}`);
    }
    await prisma.$executeRawUnsafe(
        "SELECT pg_advisory_lock($1::integer, $2::integer)",
        SEARCH_INDEX_REBUILD_LOCK_NAMESPACE,
        key,
    );
    return key;
}

async function releaseLock(prisma: PrismaClient, key: number): Promise<void> {
    await prisma.$executeRawUnsafe(
        "SELECT pg_advisory_unlock($1::integer, $2::integer)",
        SEARCH_INDEX_REBUILD_LOCK_NAMESPACE,
        key,
    );
}

async function testConcurrentSameFamily(
    databaseUrl: string,
): Promise<{ statusA: number; statusB: number; detail: string }> {
    const view = resolveRebuildViewForHealthFamily(TEST_FAMILY_A);
    if (!view) {
        throw new Error(`No rebuild view for ${TEST_FAMILY_A}`);
    }

    const holder = createTestPrisma(databaseUrl);
    const worker = createTestPrisma(databaseUrl);
    const service = new SearchIndexMaintenanceService(worker);

    const key = await holdLock(holder, view);
    try {
        const blocked = await service.reindexFamily(SMOKE_ACTOR, { entity_family: TEST_FAMILY_A });
        const statusB = httpStatusForResult(blocked);
        if (statusB !== 409 || blocked.status !== "conflict") {
            fail(
                "concurrent_same_family_blocked",
                `Expected conflict/409 while lock held, got status=${blocked.status} http=${statusB}`,
            );
        }

        await releaseLock(holder, key);

        const retry = await service.reindexFamily(SMOKE_ACTOR, { entity_family: TEST_FAMILY_A });
        const statusA = httpStatusForResult(retry);
        if (retry.status === "conflict") {
            fail(
                "concurrent_same_family_retry",
                `Expected retry to proceed after unlock, got conflict`,
            );
        }

        pass(
            "concurrent_same_family_blocked",
            `B returned 409 conflict while A held lock: ${blocked.message ?? "already running"}`,
        );
        pass(
            "concurrent_same_family_retry",
            `Retry after unlock returned HTTP ${statusA} (status=${retry.status})`,
        );

        return {
            statusA,
            statusB,
            detail: `held-lock B=${statusB}, retry A=${statusA}`,
        };
    } finally {
        await releaseLock(holder, key).catch(() => undefined);
        await holder.$disconnect();
        await worker.$disconnect();
    }
}

async function testParallelRebuildRace(databaseUrl: string): Promise<{
    statusA: number;
    statusB: number;
    detail: string;
}> {
    const clientA = createTestPrisma(databaseUrl);
    const clientB = createTestPrisma(databaseUrl);
    const serviceA = new SearchIndexMaintenanceService(clientA);
    const serviceB = new SearchIndexMaintenanceService(clientB);

    try {
        const [resultA, resultB] = await Promise.all([
            serviceA.reindexFamily(SMOKE_ACTOR, { entity_family: TEST_FAMILY_A }),
            serviceB.reindexFamily(SMOKE_ACTOR, { entity_family: TEST_FAMILY_A }),
        ]);

        const statusA = httpStatusForResult(resultA);
        const statusB = httpStatusForResult(resultB);
        const conflicts = [resultA, resultB].filter((row) => row.status === "conflict").length;
        const successes = [resultA, resultB].filter((row) => row.status !== "conflict").length;

        if (conflicts === 1 && successes === 1) {
            pass(
                "parallel_same_family_race",
                `A=${statusA} (${resultA.status}), B=${statusB} (${resultB.status}) — one conflict as expected`,
            );
        } else if (conflicts === 0 && successes === 2) {
            pass(
                "parallel_same_family_race",
                `A=${statusA}, B=${statusB} — both succeeded (rebuild finished before overlap; holder test is authoritative)`,
            );
        } else {
            fail(
                "parallel_same_family_race",
                `Unexpected outcomes: A=${resultA.status}/${statusA}, B=${resultB.status}/${statusB}`,
            );
        }

        return {
            statusA,
            statusB,
            detail: `parallel A=${statusA}/${resultA.status}, B=${statusB}/${resultB.status}`,
        };
    } finally {
        await clientA.$disconnect();
        await clientB.$disconnect();
    }
}

async function testDifferentFamilies(databaseUrl: string): Promise<void> {
    const clientA = createTestPrisma(databaseUrl);
    const clientB = createTestPrisma(databaseUrl);
    const serviceA = new SearchIndexMaintenanceService(clientA);
    const serviceB = new SearchIndexMaintenanceService(clientB);

    try {
        const [resultA, resultB] = await Promise.all([
            serviceA.reindexFamily(SMOKE_ACTOR, { entity_family: TEST_FAMILY_A }),
            serviceB.reindexFamily(SMOKE_ACTOR, { entity_family: TEST_FAMILY_B }),
        ]);

        if (resultA.status === "conflict" || resultB.status === "conflict") {
            fail(
                "different_families_parallel",
                `Expected independent rebuilds, got A=${resultA.status}, B=${resultB.status}`,
            );
        }

        pass(
            "different_families_parallel",
            `water_lines=${resultA.status}, water_polygons=${resultB.status} (HTTP ${httpStatusForResult(resultA)} / ${httpStatusForResult(resultB)})`,
        );
    } finally {
        await clientA.$disconnect();
        await clientB.$disconnect();
    }
}

async function testLockReleaseAfterFailure(databaseUrl: string): Promise<void> {
    const prisma = createTestPrisma(databaseUrl);
    const view = resolveRebuildViewForHealthFamily(TEST_FAMILY_A);
    if (!view) {
        throw new Error(`No rebuild view for ${TEST_FAMILY_A}`);
    }

    try {
        await withSearchIndexRebuildLocks(prisma, [view], async () => {
            throw new Error("intentional smoke failure");
        }).catch((err: unknown) => {
            if (!(err instanceof Error) || err.message !== "intentional smoke failure") {
                throw err;
            }
        });

        const available = await tryAcquireLock(prisma, view);
        if (!available) {
            fail("lock_release_after_failure", "Advisory lock still held after failure");
        }
        pass("lock_release_after_failure", "Lock released after thrown rebuild callback");
    } finally {
        await prisma.$disconnect();
    }
}

async function testLockReleaseAfterSuccess(databaseUrl: string): Promise<void> {
    const prisma = createTestPrisma(databaseUrl);
    const service = new SearchIndexMaintenanceService(prisma);
    const view = resolveRebuildViewForHealthFamily(TEST_FAMILY_A);
    if (!view) {
        throw new Error(`No rebuild view for ${TEST_FAMILY_A}`);
    }

    try {
        const result = await service.reindexFamily(SMOKE_ACTOR, { entity_family: TEST_FAMILY_A });
        if (result.status === "conflict") {
            fail("lock_release_after_success", "Unexpected conflict on single rebuild");
        }

        const available = await tryAcquireLock(prisma, view);
        if (!available) {
            fail("lock_release_after_success", "Advisory lock still held after successful rebuild");
        }
        pass(
            "lock_release_after_success",
            `Rebuild status=${result.status}, lock available afterward`,
        );
    } finally {
        await prisma.$disconnect();
    }
}

async function testTryLockConflictPrimitive(databaseUrl: string): Promise<void> {
    const view = resolveRebuildViewForHealthFamily(TEST_FAMILY_A);
    if (!view) {
        throw new Error(`No rebuild view for ${TEST_FAMILY_A}`);
    }

    const clientA = createTestPrisma(databaseUrl);
    const clientB = createTestPrisma(databaseUrl);

    try {
        let conflictMessage: string | null = null;
        await withSearchIndexRebuildLocks(clientA, [view], async () => {
            try {
                await withSearchIndexRebuildLocks(clientB, [view], async () => "should not run");
            } catch (err) {
                if (err instanceof SearchIndexRebuildLockError) {
                    conflictMessage = err.message;
                    return;
                }
                throw err;
            }
            fail("try_lock_primitive", "Second client acquired the same rebuild lock");
        });

        if (!conflictMessage) {
            fail("try_lock_primitive", "Expected SearchIndexRebuildLockError on second client");
        }
        pass("try_lock_primitive", `Second client rejected: ${conflictMessage}`);
    } finally {
        await clientA.$disconnect();
        await clientB.$disconnect();
    }
}

async function main(): Promise<void> {
    console.log("[smoke] search rebuild lock integration validation");

    const databaseUrl = resolveLockTestDatabaseUrl();
    assertSafeDatabaseUrl(databaseUrl);

    if (process.env.SMOKE_ALLOW_PRODUCTION_DB === "1") {
        console.log("[smoke] warning: running against production-ref database (safe water_* families only)");
    }

    await testTryLockConflictPrimitive(databaseUrl);
    const held = await testConcurrentSameFamily(databaseUrl);
    const race = await testParallelRebuildRace(databaseUrl);
    await testDifferentFamilies(databaseUrl);
    await testLockReleaseAfterFailure(databaseUrl);
    await testLockReleaseAfterSuccess(databaseUrl);

    const failed = results.filter((row) => !row.pass);
    console.log("\n[smoke] summary");
    console.log(`  tests: ${results.length}`);
    console.log(`  passed: ${results.length - failed.length}`);
    console.log(`  failed: ${failed.length}`);
    console.log(`  held-lock: ${held.detail}`);
    console.log(`  parallel race: ${race.detail}`);

    if (failed.length > 0) {
        process.exitCode = 1;
        return;
    }

    console.log("\n[smoke] PASS — rebuild lock integration validated");
}

main().catch((err) => {
    console.error("\n[smoke] FAIL", err);
    process.exitCode = 1;
});
