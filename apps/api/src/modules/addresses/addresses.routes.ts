import type { FastifyPluginAsync } from "fastify";

import { AddressIndexRepository } from "./address-index.repo.js";
import { AddressSearchService } from "./address-search.service.js";
import { getAddressSearchSchema } from "./address-search.openapi.js";
import { addressSearchQuerySchema } from "./address-search.schema.js";
import { ReverseAddressRepository } from "./reverse-address.repo.js";
import { ReverseAddressResolver } from "./reverse-address.resolver.js";
import { getReverseAddressDebugSchema, getReverseAddressSchema } from "./reverse-address.openapi.js";
import { reverseAddressQuerySchema } from "./reverse-address.schema.js";
import { ReverseSearchRepository } from "./reverse-search.repo.js";
import { ReverseSearchService } from "./reverse-search.service.js";
import { getReverseSearchSchema } from "./reverse-search.openapi.js";
import { reverseSearchQuerySchema } from "./reverse-search.schema.js";

const addressesRoutes: FastifyPluginAsync = async (app) => {
    const repo = new ReverseAddressRepository(app.prisma);
    const resolver = new ReverseAddressResolver(repo);
    const indexRepo = new AddressIndexRepository(app.prisma);
    const searchService = new AddressSearchService(indexRepo);
    const reverseSearchService = new ReverseSearchService(new ReverseSearchRepository(app.prisma));

    app.get("/addresses/search", { schema: getAddressSearchSchema }, async (request, reply) => {
        const parsed = addressSearchQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid address search query",
                issues: parsed.error.flatten(),
            });
        }

        const results = await searchService.search(parsed.data);
        return reply.send({
            q: parsed.data.q,
            lang: parsed.data.lang,
            count: results.length,
            results,
        });
    });

    app.get("/search/reverse", { schema: getReverseSearchSchema }, async (request, reply) => {
        const parsed = reverseSearchQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid reverse search query",
                issues: parsed.error.flatten(),
            });
        }

        try {
            const result = await reverseSearchService.reverse(parsed.data.lat, parsed.data.lng);
            return reply.send(result);
        } catch (error) {
            request.log.error({ err: error }, "Reverse search lookup failed");
            return reply.code(500).send({ message: "Reverse address lookup failed" });
        }
    });

    app.get("/addresses/reverse", { schema: getReverseAddressSchema }, async (request, reply) => {
        const parsed = reverseAddressQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid reverse address query",
                issues: parsed.error.flatten(),
            });
        }

        const { lat, lng, lang } = parsed.data;
        const result = await resolver.resolve(lat, lng, lang);
        return reply.send(result);
    });

    app.get(
        "/admin/addresses/reverse-debug",
        {
            preHandler: app.authenticate,
            schema: getReverseAddressDebugSchema,
        },
        async (request, reply) => {
            const parsed = reverseAddressQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid reverse address query",
                    issues: parsed.error.flatten(),
                });
            }

            const { lat, lng, lang } = parsed.data;
            const result = await resolver.resolveDebug(lat, lng, lang);
            return reply.send(result);
        }
    );
};

export default addressesRoutes;
