import type { PrismaClient } from "@prisma/client";

import type { JwtUser } from "../../plugins/auth.js";
import { BuildingsRepository } from "../buildings/buildings.repo.js";
import { PlacesRepository } from "../places/places.repo.js";
import { StreetsRepository } from "../streets/streets.repo.js";
import { getCoreReviewEntityByPath } from "./core-review.entity-registry.js";
import { getCoreReviewBuildingDetail } from "./entities/buildings.handler.js";
import { getCoreReviewPlaceDetail } from "./entities/places.handler.js";
import { getCoreReviewStreetDetail } from "./entities/streets.handler.js";
import { CoreReviewEntitiesRepository } from "./core-review-entities.repo.js";
import { getCoreReviewLifecycleConfig } from "./core-review-lifecycle.config.js";
import { CoreReviewLifecycleRepository } from "./core-review-lifecycle.repo.js";
import { buildDetailResponse } from "./core-review.pagination.js";
import { serializeGenericCoreRow } from "./core-review-serializers.js";
import {
    CoreReviewLifecycleNotSupportedError,
    CoreReviewNotFoundError,
    CoreReviewValidationError,
} from "./core-review-write.errors.js";
import type { CoreReviewEntitySlug } from "./core-review.types.js";
import type { CoreReviewDetailResponse } from "./core-review.types.js";

export class CoreReviewLifecycleService {
    private readonly lifecycleRepo: CoreReviewLifecycleRepository;
    private readonly placesRepo: PlacesRepository;
    private readonly buildingsRepo: BuildingsRepository;
    private readonly streetsRepo: StreetsRepository;
    private readonly entitiesRepo: CoreReviewEntitiesRepository;

    constructor(prisma: PrismaClient) {
        this.lifecycleRepo = new CoreReviewLifecycleRepository(prisma);
        this.placesRepo = new PlacesRepository(prisma);
        this.buildingsRepo = new BuildingsRepository(prisma);
        this.streetsRepo = new StreetsRepository(prisma);
        this.entitiesRepo = new CoreReviewEntitiesRepository(prisma);
    }

    private validateIdFormat(slug: CoreReviewEntitySlug, id: string): void {
        const config = getCoreReviewLifecycleConfig(slug);
        if (config.idKind === "public_id") {
            const uuid =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!uuid.test(id)) {
                throw new CoreReviewValidationError("Invalid record id", [
                    { path: "id", message: "Expected a UUID public_id" },
                ]);
            }
            return;
        }
        if (!/^\d+$/.test(id)) {
            throw new CoreReviewValidationError("Invalid record id", [
                { path: "id", message: "Expected a numeric id" },
            ]);
        }
    }

    async softDelete(entityPath: string, id: string, user?: JwtUser): Promise<CoreReviewDetailResponse<unknown>> {
        const def = getCoreReviewEntityByPath(entityPath);
        if (!def) {
            throw new CoreReviewNotFoundError("Unknown core-review entity");
        }

        const slug = def.slug as CoreReviewEntitySlug;
        const config = getCoreReviewLifecycleConfig(slug);
        if (!config.supportsSoftDelete) {
            throw new CoreReviewLifecycleNotSupportedError();
        }

        this.validateIdFormat(slug, id);

        const exists = await this.lifecycleRepo.recordExists(slug, id);
        if (!exists) {
            throw new CoreReviewNotFoundError();
        }

        const isActive = await this.lifecycleRepo.isActiveRecord(slug, id);
        if (isActive === false) {
            throw new CoreReviewValidationError("Record is already soft-deleted");
        }

        const applied = await this.applySoftDelete(slug, id, user);
        if (!applied) {
            throw new CoreReviewNotFoundError();
        }

        const detail = await this.loadDetail(slug, id);
        if (!detail) {
            throw new CoreReviewNotFoundError();
        }
        return detail;
    }

    async restore(entityPath: string, id: string, user?: JwtUser): Promise<CoreReviewDetailResponse<unknown>> {
        const def = getCoreReviewEntityByPath(entityPath);
        if (!def) {
            throw new CoreReviewNotFoundError("Unknown core-review entity");
        }

        const slug = def.slug as CoreReviewEntitySlug;
        const config = getCoreReviewLifecycleConfig(slug);
        if (!config.supportsSoftDelete) {
            throw new CoreReviewLifecycleNotSupportedError();
        }

        this.validateIdFormat(slug, id);

        const exists = await this.lifecycleRepo.recordExists(slug, id);
        if (!exists) {
            throw new CoreReviewNotFoundError();
        }

        const isActive = await this.lifecycleRepo.isActiveRecord(slug, id);
        if (isActive === true) {
            throw new CoreReviewValidationError("Record is not soft-deleted");
        }

        const applied = await this.applyRestore(slug, id, user);
        if (!applied) {
            throw new CoreReviewNotFoundError();
        }

        const detail = await this.loadDetail(slug, id);
        if (!detail) {
            throw new CoreReviewNotFoundError();
        }
        return detail;
    }

    private async applySoftDelete(slug: CoreReviewEntitySlug, id: string, user?: JwtUser): Promise<boolean> {
        switch (slug) {
            case "places": {
                const row = await this.placesRepo.deletePlace(id);
                return row !== null;
            }
            case "buildings": {
                const row = await this.buildingsRepo.softDeleteActiveBuildingByPublicId(id);
                return row !== null;
            }
            case "streets": {
                const row = await this.streetsRepo.softDeleteStreet(id);
                return row !== null;
            }
            default:
                return this.lifecycleRepo.softDeleteGeneric(slug, id);
        }
    }

    private async applyRestore(slug: CoreReviewEntitySlug, id: string, _user?: JwtUser): Promise<boolean> {
        switch (slug) {
            case "places":
                return this.placesRepo.restorePlaceByPublicId(id);
            case "buildings":
                return this.buildingsRepo.restoreBuildingByPublicId(id);
            case "streets":
                return (await this.streetsRepo.restoreStreet(id)) !== null;
            default:
                return this.lifecycleRepo.restoreGeneric(slug, id);
        }
    }

    private async loadDetail(
        slug: CoreReviewEntitySlug,
        id: string
    ): Promise<CoreReviewDetailResponse<unknown> | null> {
        switch (slug) {
            case "buildings":
                return getCoreReviewBuildingDetail(this.buildingsRepo, id, { anyStatus: true });
            case "places":
                return getCoreReviewPlaceDetail(this.placesRepo, id, { anyStatus: true });
            case "streets":
                return getCoreReviewStreetDetail(this.streetsRepo, id, { anyStatus: true });
            case "bus-stops": {
                const row = await this.entitiesRepo.getBusStopByPublicId(id, { anyStatus: true });
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "bus-routes": {
                const row = await this.entitiesRepo.getBusRouteById(id, { anyStatus: true });
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "bus-route-variants": {
                const row = await this.entitiesRepo.getBusRouteVariantById(id, { anyStatus: true });
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "landuse": {
                const row = await this.entitiesRepo.getLanduseById(id, { anyStatus: true });
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "water-lines": {
                const row = await this.entitiesRepo.getWaterLineById(id, { anyStatus: true });
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "water-polygons": {
                const row = await this.entitiesRepo.getWaterPolygonById(id, { anyStatus: true });
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "addresses": {
                const row = await this.entitiesRepo.getAddressByPublicId(id, { anyStatus: true });
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            case "admin-areas": {
                const row = await this.entitiesRepo.getAdminAreaByPublicId(id, { anyStatus: true });
                return row ? buildDetailResponse(serializeGenericCoreRow(row)) : null;
            }
            default:
                return null;
        }
    }
}
