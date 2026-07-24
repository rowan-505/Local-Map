import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
    prisma?: PrismaClient;
    prismaShutdownHooksRegistered?: boolean;
};

/**
 * Single PrismaClient per Node process. Always attached to `globalThis` so dev HMR / tooling
 * and production builds cannot accidentally create multiple pools to the same database.
 */
export const prisma: PrismaClient = getOrCreatePrismaClient();

registerPrismaShutdownHooks();

function getOrCreatePrismaClient(): PrismaClient {
    if (globalForPrisma.prisma) {
        return globalForPrisma.prisma;
    }

    const client = createPrismaClient();
    globalForPrisma.prisma = client;
    return client;
}

function createPrismaClient() {
    const databaseUrl = applyPrismaConnectionLimit(process.env.DATABASE_URL);
    const options = databaseUrl
        ? {
              datasources: {
                  db: {
                      url: databaseUrl,
                  },
              },
          }
        : undefined;

    return new PrismaClient(options);
}

/**
 * Effective Prisma `connection_limit` when the URL does not already set one.
 * Default is `"1"` (safe for tight poolers). Production transport target: `3`
 * via `PRISMA_CONNECTION_LIMIT` (see apps/api/.env.example).
 */
export function resolvePrismaConnectionLimitValue(): string {
    const fromEnv = process.env.PRISMA_CONNECTION_LIMIT?.trim();
    return fromEnv && fromEnv.length > 0 ? fromEnv : "1";
}

/**
 * When the URL has no `connection_limit`, append one so Supabase / poolers with a small
 * `pool_size` are not exhausted by Prisma's default pool (especially in production).
 *
 * Override with `PRISMA_CONNECTION_LIMIT` (e.g. `1` for tight session poolers;
 * production transport target `3`). Safe to reuse for secondary Prisma clients.
 */
export function applyPrismaConnectionLimit(databaseUrl: string | undefined): string | undefined {
    if (!databaseUrl) {
        return undefined;
    }

    const trimmed = databaseUrl.trim();
    if (!trimmed) {
        return undefined;
    }

    if (hasConnectionLimit(trimmed)) {
        return trimmed;
    }

    return appendConnectionLimit(trimmed, resolvePrismaConnectionLimitValue());
}

/**
 * Effective numeric connection limit for startup diagnostics.
 * Prefer an explicit `connection_limit` on the URL; otherwise use env/default.
 * Never returns or logs the database URL itself.
 */
export function resolveEffectivePrismaConnectionLimit(
    databaseUrl: string | undefined = process.env.DATABASE_URL,
): string {
    if (databaseUrl?.trim()) {
        try {
            const fromUrl = new URL(databaseUrl.trim()).searchParams.get("connection_limit");
            if (fromUrl && fromUrl.trim().length > 0) {
                return fromUrl.trim();
            }
        } catch {
            // fall through to env/default
        }
    }
    return resolvePrismaConnectionLimitValue();
}

function hasConnectionLimit(databaseUrl: string) {
    try {
        return new URL(databaseUrl).searchParams.has("connection_limit");
    } catch {
        return false;
    }
}

function appendConnectionLimit(databaseUrl: string, connectionLimit: string) {
    try {
        const url = new URL(databaseUrl);
        url.searchParams.set("connection_limit", connectionLimit);
        return url.toString();
    } catch {
        return databaseUrl;
    }
}

function registerPrismaShutdownHooks() {
    if (globalForPrisma.prismaShutdownHooksRegistered) {
        return;
    }

    globalForPrisma.prismaShutdownHooksRegistered = true;

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, async () => {
            await prisma.$disconnect();
            const { disconnectImportReviewPrisma } = await import("./import-review-prisma.js");
            await disconnectImportReviewPrisma();
            process.kill(process.pid, signal);
        });
    }
}
