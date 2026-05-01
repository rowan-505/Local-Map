import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
    prisma?: PrismaClient;
    prismaShutdownHooksRegistered?: boolean;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}

registerPrismaShutdownHooks();

function createPrismaClient() {
    const databaseUrl = getPrismaDatabaseUrl();
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

function getPrismaDatabaseUrl() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl || process.env.NODE_ENV === "production" || hasConnectionLimit(databaseUrl)) {
        return databaseUrl;
    }

    return appendConnectionLimit(databaseUrl, "3");
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
            process.kill(process.pid, signal);
        });
    }
}
