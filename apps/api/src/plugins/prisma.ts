import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

declare module "fastify" {
    interface FastifyInstance {
        prisma: PrismaClient;
    }
}

export default fp(async function prismaPlugin(app) {
    const prisma = new PrismaClient();

    await prisma.$connect();
    app.decorate("prisma", prisma);

    app.addHook("onClose", async (instance) => {
        await instance.prisma.$disconnect();
    });
});
