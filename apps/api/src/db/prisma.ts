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
 * When the URL has no `connection_limit`, append one so Supabase / poolers with a small
 * `pool_size` are not exhausted by Prisma's default pool (especially in production).
 *
 * Override with `PRISMA_CONNECTION_LIMIT` (e.g. `1` for tight session poolers).
 * Safe to reuse for secondary Prisma clients that need the same pooling behavior.
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

    const limit = process.env.PRISMA_CONNECTION_LIMIT?.trim() ?? "1";
    return appendConnectionLimit(trimmed, limit);
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
