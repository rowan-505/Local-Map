import fp from "fastify-plugin";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "../lib/prisma.js";

declare module "fastify" {
    interface FastifyInstance {
        prisma: PrismaClient;
    }
}

export default fp(async function prismaPlugin(app) {
    app.decorate("prisma", prisma);

    app.addHook("onClose", async (instance) => {
        await instance.prisma.$disconnect();
    });
});
