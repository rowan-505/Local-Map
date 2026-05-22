import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { BuildingsRepository } from "../../modules/buildings/buildings.repo.js";
import { PlacesRepository } from "../../modules/places/places.repo.js";
import { StreetsRepository } from "../../modules/streets/streets.repo.js";

export type ValidationIssue = { path: string; message: string };

export class CoreReviewRefValidator {
    private readonly buildingsRepo: BuildingsRepository;
    private readonly placesRepo: PlacesRepository;
    private readonly streetsRepo: StreetsRepository;

    constructor(private readonly prisma: PrismaClient) {
        this.buildingsRepo = new BuildingsRepository(prisma);
        this.placesRepo = new PlacesRepository(prisma);
        this.streetsRepo = new StreetsRepository(prisma);
    }

    async validateAdminAreaId(adminAreaId: bigint | null | undefined, path = "adminAreaId"): Promise<ValidationIssue[]> {
        if (adminAreaId === undefined || adminAreaId === null) {
            return [];
        }
        const ok = await this.buildingsRepo.hasActiveAdminArea(adminAreaId);
        return ok ? [] : [{ path, message: "admin_area_id is invalid or inactive" }];
    }

    async validateSourceTypeId(sourceTypeId: bigint | null | undefined, path = "sourceTypeId"): Promise<ValidationIssue[]> {
        if (sourceTypeId === undefined || sourceTypeId === null) {
            return [];
        }
        const ok = await this.placesRepo.hasSourceType(sourceTypeId);
        return ok ? [] : [{ path, message: "source_type_id is invalid" }];
    }

    async resolveManualSourceTypeId(): Promise<bigint | null> {
        return (await this.placesRepo.getSourceTypeIdByCode("manual")) ?? null;
    }

    async validateCategoryId(categoryId: bigint, path = "categoryId"): Promise<ValidationIssue[]> {
        const ok = await this.placesRepo.hasCategory(categoryId);
        return ok ? [] : [{ path, message: "category_id is invalid" }];
    }

    async validatePublishStatusId(
        publishStatusId: bigint | null | undefined,
        path = "publishStatusId",
    ): Promise<ValidationIssue[]> {
        if (publishStatusId === undefined || publishStatusId === null) {
            return [];
        }
        const ok = await this.placesRepo.hasPublishStatus(publishStatusId);
        return ok ? [] : [{ path, message: "publish_status_id is invalid" }];
    }

    async validateRoadClassId(roadClassId: bigint, path = "roadClassId"): Promise<ValidationIssue[]> {
        const ok = await this.streetsRepo.hasRoadClass(roadClassId);
        return ok ? [] : [{ path, message: "road_class_id not found" }];
    }

    async validateLanduseClassId(
        landuseClassId: bigint | null | undefined,
        required = false,
        path = "landuseClassId"
    ): Promise<ValidationIssue[]> {
        if (landuseClassId === undefined || landuseClassId === null) {
            return required ? [{ path, message: "landuse_class_id is required" }] : [];
        }
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM ref.ref_landuse_classes
            WHERE id = ${landuseClassId} AND is_active IS TRUE
            LIMIT 1
        `;
        return rows.length > 0 ? [] : [{ path, message: "landuse_class_id is invalid or inactive" }];
    }

    async validateBusRouteId(routeId: bigint, path = "routeId"): Promise<ValidationIssue[]> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id FROM core.core_bus_routes WHERE id = ${routeId} AND is_active IS TRUE LIMIT 1
        `);
        return rows.length > 0 ? [] : [{ path, message: "route_id is invalid or inactive" }];
    }

    async validateAdminLevelId(adminLevelId: bigint, path = "adminLevelId"): Promise<ValidationIssue[]> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id FROM ref.ref_admin_levels WHERE id = ${adminLevelId} LIMIT 1
        `);
        return rows.length > 0 ? [] : [{ path, message: "Admin level id is invalid or not found" }];
    }

    async validateParentAdminAreaId(
        parentId: bigint | null | undefined,
        excludeId?: bigint,
        path = "parentId",
    ): Promise<ValidationIssue[]> {
        if (parentId === undefined || parentId === null) {
            return [];
        }
        if (excludeId !== undefined && parentId === excludeId) {
            return [{ path, message: "parent_id cannot reference self" }];
        }
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id FROM core.core_admin_areas WHERE id = ${parentId} AND is_active IS TRUE LIMIT 1
        `);
        return rows.length > 0 ? [] : [{ path, message: "parent_id is invalid or inactive" }];
    }

    /** Resolve street public_id (UUID) to internal bigint id. */
    async resolveStreetInternalId(streetPublicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id FROM core.core_streets
            WHERE public_id = CAST(${streetPublicId} AS uuid)
              AND deleted_at IS NULL
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async validateStreetPublicId(
        streetPublicId: string | null | undefined,
        path = "streetId",
    ): Promise<{ issues: ValidationIssue[]; internalId: bigint | null }> {
        if (streetPublicId === undefined || streetPublicId === null || streetPublicId === "") {
            return { issues: [], internalId: null };
        }
        const internalId = await this.resolveStreetInternalId(streetPublicId);
        if (!internalId) {
            return { issues: [{ path, message: "street_id is invalid" }], internalId: null };
        }
        return { issues: [], internalId };
    }

    async validateBuildingTypeId(
        buildingTypeId: bigint | null | undefined,
        path = "buildingTypeId",
    ): Promise<ValidationIssue[]> {
        if (buildingTypeId === undefined || buildingTypeId === null) {
            return [];
        }
        const row = await this.buildingsRepo.getActiveBuildingTypeById(buildingTypeId);
        return row ? [] : [{ path, message: "building_type_id is invalid or inactive" }];
    }

    async validateBoundaryStatusCode(
        boundaryStatus: string | null | undefined,
        required = false,
        path = "boundaryStatus",
    ): Promise<ValidationIssue[]> {
        if (boundaryStatus === undefined || boundaryStatus === null || boundaryStatus === "") {
            return required ? [{ path, message: "Required" }] : [];
        }
        const code = String(boundaryStatus).trim();
        const rows = await this.prisma.$queryRaw<{ code: string }[]>(Prisma.sql`
            SELECT code FROM ref.ref_boundary_statuses
            WHERE lower(trim(code)) = lower(trim(${code}))
              AND is_active IS TRUE
            LIMIT 1
        `);
        return rows.length > 0 ? [] : [{ path, message: "Invalid or inactive boundary status code" }];
    }

    async validateAddressUsageCode(
        addressUsage: string | null | undefined,
        required = false,
        path = "addressUsage",
    ): Promise<ValidationIssue[]> {
        if (addressUsage === undefined || addressUsage === null || addressUsage === "") {
            return required ? [{ path, message: "Required" }] : [];
        }
        const code = String(addressUsage).trim();
        const rows = await this.prisma.$queryRaw<{ code: string }[]>(Prisma.sql`
            SELECT code FROM ref.ref_address_usage_types
            WHERE lower(trim(code)) = lower(trim(${code}))
              AND is_active IS TRUE
            LIMIT 1
        `);
        return rows.length > 0 ? [] : [{ path, message: "Invalid or inactive address usage code" }];
    }

    validateBoundaryConfidenceScore(
        score: unknown,
        required = false,
        path = "boundaryConfidenceScore",
    ): ValidationIssue[] {
        if (score === undefined || score === null || score === "") {
            return required ? [{ path, message: "Required" }] : [];
        }
        const value = typeof score === "number" ? score : Number(String(score));
        if (!Number.isFinite(value) || value < 0 || value > 100) {
            return [{ path, message: "Must be between 0 and 100" }];
        }
        return [];
    }
}
