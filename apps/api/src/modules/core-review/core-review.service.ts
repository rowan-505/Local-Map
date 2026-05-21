import type { PrismaClient } from "@prisma/client";

import type { JwtUser } from "../../plugins/auth.js";
import { BuildingsRepository } from "../buildings/buildings.repo.js";
import { BuildingsService } from "../buildings/buildings.service.js";
import { PlacesRepository } from "../places/places.repo.js";
import { PlacesService } from "../places/places.service.js";
import { StreetsRepository } from "../streets/streets.repo.js";
import { StreetsService } from "../streets/streets.service.js";
import {
    getCoreReviewBuildingDetail,
    listCoreReviewBuildings,
} from "./entities/buildings.handler.js";
import { getCoreReviewPlaceDetail, listCoreReviewPlaces } from "./entities/places.handler.js";
import { getCoreReviewStreetDetail, listCoreReviewStreets } from "./entities/streets.handler.js";
import {
    CoreReviewEntitiesRepository,
    type CoreReviewEntityListParams,
} from "./core-review-entities.repo.js";
import { getCoreReviewEntityByPath, resolveCoreReviewSortBy } from "./core-review.entity-registry.js";
import { buildDetailResponse, buildListResponse, pageToOffset } from "./core-review.pagination.js";
import type { CoreReviewListQueryParsed } from "./core-review.schema.js";
import { serializeGenericCoreRow } from "./core-review-serializers.js";
import { CoreReviewGenericWriteService } from "./core-review-generic-write.service.js";
import { createCoreReviewBuilding, updateCoreReviewBuilding } from "./entities/buildings-write.handler.js";
import { createCoreReviewPlace, updateCoreReviewPlace } from "./entities/places-write.handler.js";
import { createCoreReviewStreet, updateCoreReviewStreet } from "./entities/streets-write.handler.js";
import { CoreReviewLifecycleService } from "./core-review-lifecycle.service.js";
import { resolveCoreReviewListStatus } from "./core-review-list-status.js";
import type { CoreReviewEntitySlug } from "./core-review.types.js";

function toListParams(
    def: ReturnType<typeof getCoreReviewEntityByPath>,
    query: CoreReviewListQueryParsed
): CoreReviewEntityListParams {
    if (!def) {
        throw new Error("invalid entity");
    }
    return {
        limit: query.pageSize,
        offset: pageToOffset(query.page, query.pageSize),
        search: query.search,
        sortBy: resolveCoreReviewSortBy(def, query.sortBy),
        sortOrder: query.sortOrder,
        isVerified: query.isVerified,
        adminAreaId: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        routeId: query.routeId ? BigInt(query.routeId) : undefined,
        isPublic: query.isPublic,
        parentAdminAreaId: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        status: resolveCoreReviewListStatus(query),
    };
}

function filterEcho(query: CoreReviewListQueryParsed): Record<string, unknown> {
    return {
        search: query.search,
        status: resolveCoreReviewListStatus(query),
        isVerified: query.isVerified,
        adminAreaId: query.adminAreaId,
        categoryId: query.categoryId,
        buildingTypeId: query.buildingTypeId,
        roadClassId: query.roadClassId,
        isPublic: query.isPublic,
        includeDeleted: query.includeDeleted,
        routeId: query.routeId,
    };
}

async function listGeneric(
    entitiesRepo: CoreReviewEntitiesRepository,
    slug: string,
    params: CoreReviewEntityListParams,
    query: CoreReviewListQueryParsed,
    listFn: (p: CoreReviewEntityListParams) => Promise<Record<string, unknown>[]>,
    countFn: (p: CoreReviewEntityListParams) => Promise<number>
) {
    const [rows, total] = await Promise.all([listFn(params), countFn(params)]);
    return buildListResponse({
        data: rows.map(serializeGenericCoreRow),
        page: query.page,
        pageSize: query.pageSize,
        total,
        filters: filterEcho(query),
        meta: { entity: slug, sortBy: params.sortBy, sortOrder: params.sortOrder },
    });
}

type WriteLogger = {
    warn: (obj: Record<string, unknown>, msg: string) => void;
};

export class CoreReviewService {
    private readonly buildingsRepo: BuildingsRepository;
    private readonly buildingsService: BuildingsService;
    private readonly placesRepo: PlacesRepository;
    private readonly placesService: PlacesService;
    private readonly streetsRepo: StreetsRepository;
    private readonly streetsService: StreetsService;
    private readonly entitiesRepo: CoreReviewEntitiesRepository;
    private readonly genericWriteService: CoreReviewGenericWriteService;
    private readonly lifecycleService: CoreReviewLifecycleService;

    constructor(prisma: PrismaClient) {
        this.buildingsRepo = new BuildingsRepository(prisma);
        this.buildingsService = new BuildingsService(this.buildingsRepo);
        this.placesRepo = new PlacesRepository(prisma);
        this.placesService = new PlacesService(this.placesRepo);
        this.streetsRepo = new StreetsRepository(prisma);
        this.streetsService = new StreetsService(this.streetsRepo);
        this.entitiesRepo = new CoreReviewEntitiesRepository(prisma);
        this.genericWriteService = new CoreReviewGenericWriteService(prisma);
        this.lifecycleService = new CoreReviewLifecycleService(prisma);
    }

    softDelete(entityPath: string, id: string, user?: JwtUser) {
        return this.lifecycleService.softDelete(entityPath, id, user);
    }

    restore(entityPath: string, id: string, user?: JwtUser) {
        return this.lifecycleService.restore(entityPath, id, user);
    }

    list(entityPath: string, query: CoreReviewListQueryParsed) {
        const def = getCoreReviewEntityByPath(entityPath);
        if (!def) {
            return null;
        }

        switch (def.slug) {
            case "buildings":
                return listCoreReviewBuildings(this.buildingsRepo, def, query);
            case "places":
                return listCoreReviewPlaces(this.placesRepo, def, query);
            case "streets":
                return listCoreReviewStreets(this.streetsRepo, def, query);
            case "bus-stops": {
                const p = toListParams(def, query);
                return listGeneric(
                    this.entitiesRepo,
                    def.slug,
                    p,
                    query,
                    (x) => this.entitiesRepo.listBusStops(x),
                    (x) => this.entitiesRepo.countBusStops(x)
                );
            }
            case "bus-routes": {
                const p = toListParams(def, query);
                return listGeneric(
                    this.entitiesRepo,
                    def.slug,
                    p,
                    query,
                    (x) => this.entitiesRepo.listBusRoutes(x),
                    (x) => this.entitiesRepo.countBusRoutes(x)
                );
            }
            case "bus-route-variants": {
                const p = toListParams(def, query);
                return listGeneric(
                    this.entitiesRepo,
                    def.slug,
                    p,
                    query,
                    (x) => this.entitiesRepo.listBusRouteVariants(x),
                    (x) => this.entitiesRepo.countBusRouteVariants(x)
                );
            }
            case "landuse": {
                const p = toListParams(def, query);
                return listGeneric(
                    this.entitiesRepo,
                    def.slug,
                    p,
                    query,
                    (x) => this.entitiesRepo.listLanduse(x),
                    (x) => this.entitiesRepo.countLanduse(x)
                );
            }
            case "water-lines": {
                const p = toListParams(def, query);
                return listGeneric(
                    this.entitiesRepo,
                    def.slug,
                    p,
                    query,
                    (x) => this.entitiesRepo.listWaterLines(x),
                    (x) => this.entitiesRepo.countWaterLines(x)
                );
            }
            case "water-polygons": {
                const p = toListParams(def, query);
                return listGeneric(
                    this.entitiesRepo,
                    def.slug,
                    p,
                    query,
                    (x) => this.entitiesRepo.listWaterPolygons(x),
                    (x) => this.entitiesRepo.countWaterPolygons(x)
                );
            }
            case "addresses": {
                const p = toListParams(def, query);
                return listGeneric(
                    this.entitiesRepo,
                    def.slug,
                    p,
                    query,
                    (x) => this.entitiesRepo.listAddresses(x),
                    (x) => this.entitiesRepo.countAddresses(x)
                );
            }
            case "admin-areas": {
                const p = toListParams(def, query);
                return listGeneric(
                    this.entitiesRepo,
                    def.slug,
                    p,
                    query,
                    (x) => this.entitiesRepo.listAdminAreas(x),
                    (x) => this.entitiesRepo.countAdminAreas(x)
                );
            }
            default:
                return null;
        }
    }

    async getDetail(entityPath: string, id: string) {
        const def = getCoreReviewEntityByPath(entityPath);
        if (!def) {
            return null;
        }

        switch (def.slug) {
            case "buildings":
                return getCoreReviewBuildingDetail(this.buildingsRepo, id);
            case "places":
                return getCoreReviewPlaceDetail(this.placesRepo, id);
            case "streets":
                return getCoreReviewStreetDetail(this.streetsRepo, id);
            case "bus-stops": {
                const row = await this.entitiesRepo.getBusStopByPublicId(id);
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "bus-routes": {
                const row = await this.entitiesRepo.getBusRouteById(id);
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "bus-route-variants": {
                const row = await this.entitiesRepo.getBusRouteVariantById(id);
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "landuse": {
                const row = await this.entitiesRepo.getLanduseById(id);
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "water-lines": {
                const row = await this.entitiesRepo.getWaterLineById(id);
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "water-polygons": {
                const row = await this.entitiesRepo.getWaterPolygonById(id);
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "addresses": {
                const row = await this.entitiesRepo.getAddressByPublicId(id);
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "admin-areas": {
                const row = await this.entitiesRepo.getAdminAreaByPublicId(id);
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            default:
                return null;
        }
    }

    async create(
        entityPath: string,
        body: Record<string, unknown>,
        user?: JwtUser,
        log?: WriteLogger,
    ) {
        const def = getCoreReviewEntityByPath(entityPath);
        if (!def) {
            return null;
        }

        switch (def.slug) {
            case "buildings":
                return createCoreReviewBuilding(this.buildingsRepo, this.buildingsService, body);
            case "places":
                return createCoreReviewPlace(this.placesRepo, this.placesService, body);
            case "streets":
                return createCoreReviewStreet(
                    this.streetsRepo,
                    this.streetsService,
                    body,
                    user ?? { sub: "system", email: "system@local", roles: ["admin"] },
                );
            default:
                return this.genericWriteService.create(def.slug as CoreReviewEntitySlug, body, log);
        }
    }

    async update(
        entityPath: string,
        id: string,
        body: Record<string, unknown>,
        user?: JwtUser,
        log?: WriteLogger,
    ) {
        const def = getCoreReviewEntityByPath(entityPath);
        if (!def) {
            return null;
        }

        switch (def.slug) {
            case "buildings":
                return updateCoreReviewBuilding(this.buildingsRepo, this.buildingsService, id, body);
            case "places":
                return updateCoreReviewPlace(this.placesRepo, this.placesService, id, body);
            case "streets":
                return updateCoreReviewStreet(
                    this.streetsRepo,
                    this.streetsService,
                    id,
                    body,
                    user ?? { sub: "system", email: "system@local", roles: ["admin"] },
                );
            default:
                return this.genericWriteService.update(def.slug as CoreReviewEntitySlug, id, body, log);
        }
    }
}
