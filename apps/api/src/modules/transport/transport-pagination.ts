import type { FastifyReply } from "fastify";

import type { TransportPaginated } from "./transport.types.js";

type PaginationQuery = {
    limit?: number;
    page?: number;
    offset?: number;
};

/** Normalizes list payloads so list endpoints always return a 200 JSON body. */
export function toTransportListResponse<T>(
    result: TransportPaginated<T> | null | undefined,
    query: PaginationQuery
): TransportPaginated<T> {
    const limit = result?.limit ?? query.limit ?? 25;
    const offset =
        result?.offset ??
        (query.page !== undefined ? (query.page - 1) * limit : (query.offset ?? 0));
    const page = query.page ?? Math.floor(offset / limit) + 1;
    const total = result?.total ?? 0;
    const items = result?.items ?? [];

    return {
        items,
        total,
        limit,
        offset,
        page,
        hasNextPage: offset + items.length < total,
    };
}

export function sendTransportListReply<T>(
    reply: FastifyReply,
    result: TransportPaginated<T> | null | undefined,
    query: PaginationQuery
): FastifyReply {
    return reply.code(200).send(toTransportListResponse(result, query));
}
