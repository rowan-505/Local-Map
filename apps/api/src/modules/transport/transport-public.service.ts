import type { PrismaClient } from "@prisma/client";

import { TransportPublicRepository } from "./transport-public.repo.js";
import type { ListPublicTransportRoutesQuery, StopRoutesQuery } from "./transport.schema.js";
import type {
    PublicTransportRouteDetail,
    PublicTransportRouteListItem,
    PublicTransportRouteStopsResponse,
    PublicTransportStopRouteUsage,
    PublicTransportVariant,
} from "./transport-public.types.js";
import type { TransportPaginated } from "./transport.types.js";

export class TransportPublicService {
    private readonly repo: TransportPublicRepository;

    constructor(prisma: PrismaClient) {
        this.repo = new TransportPublicRepository(prisma);
    }

    listRoutes(
        query: ListPublicTransportRoutesQuery,
    ): Promise<TransportPaginated<PublicTransportRouteListItem>> {
        return this.repo.listRoutes(query);
    }

    getRouteByCode(routeCode: string): Promise<PublicTransportRouteDetail> {
        return this.repo.getRouteByCode(routeCode);
    }

    listVariantsForRouteCode(routeCode: string): Promise<PublicTransportVariant[]> {
        return this.repo.listVariantsForRouteCode(routeCode);
    }

    listStopsForRouteCode(routeCode: string): Promise<PublicTransportRouteStopsResponse> {
        return this.repo.listStopsForRouteCode(routeCode);
    }

    listRoutesForStop(
        stopPublicId: string,
        query: StopRoutesQuery,
    ): Promise<TransportPaginated<PublicTransportStopRouteUsage>> {
        return this.repo.listRoutesForStop(stopPublicId, query);
    }
}
