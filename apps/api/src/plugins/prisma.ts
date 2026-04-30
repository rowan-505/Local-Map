import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

declare module "fastify" {
    interface FastifyInstance {
        prisma: PrismaClient;
    }
}

export default fp(async function prismaPlugin(app) {
    const databaseUrl = getPrismaDatabaseUrl();
    const prisma = databaseUrl
        ? new PrismaClient({
              datasources: {
                  db: {
                      url: databaseUrl,
                  },
              },
          })
        : new PrismaClient();

    app.decorate("prisma", prisma);

    app.addHook("onClose", async (instance) => {
        await instance.prisma.$disconnect();
    });
});

function getPrismaDatabaseUrl() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl || process.env.NODE_ENV === "production" || hasConnectionLimit(databaseUrl)) {
        return databaseUrl;
    }

    return appendConnectionLimit(databaseUrl, "1");
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
