import type { PrismaClient } from "@prisma/client";

import { CoreReviewRefValidator } from "../../lib/core-review/ref-validation.js";
import {
    applyAdminAreaBoundaryDefaultsForCreate,
    applyAdminAreaBoundaryDefaultsForPatch,
} from "./admin-area-boundary-fields.js";
import { CoreReviewEntitiesRepository } from "./core-review-entities.repo.js";
import { CoreReviewEntitiesWriteRepository } from "./core-review-entities-write.repo.js";
import { CoreReviewLanduseRepository } from "./entities/landuse.repo.js";
import { CoreReviewNotFoundError, CoreReviewValidationError } from "./core-review-write.errors.js";
import { validationMessageFromIssues } from "./core-review-write.helpers.js";
import { pickAlias } from "./core-review-write.schema.js";
import { buildDetailResponse } from "./core-review.pagination.js";
import { serializeGenericCoreRow } from "./core-review-serializers.js";
import { getCoreReviewLanduseDetail } from "./entities/landuse.handler.js";
import type { CoreReviewEntitySlug } from "./core-review.types.js";

type WriteLogger = {
    warn: (obj: Record<string, unknown>, msg: string) => void;
};

async function resolveSourceTypeId(
    validator: CoreReviewRefValidator,
    body: Record<string, unknown>,
): Promise<bigint> {
    const explicit = pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id");
    if (explicit !== undefined && explicit !== null) {
        return explicit;
    }
    const manual = await validator.resolveManualSourceTypeId();
    if (!manual) {
        throw new CoreReviewValidationError("manual source_type_id was not found", [
            { path: "sourceTypeId", message: "Default manual source type missing" },
        ]);
    }
    return manual;
}

export class CoreReviewGenericWriteService {
    private readonly prisma: PrismaClient;
    private readonly writeRepo: CoreReviewEntitiesWriteRepository;
    private readonly entitiesRepo: CoreReviewEntitiesRepository;
    private readonly refValidator: CoreReviewRefValidator;
    private readonly landuseRepo: CoreReviewLanduseRepository;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.writeRepo = new CoreReviewEntitiesWriteRepository(prisma);
        this.entitiesRepo = new CoreReviewEntitiesRepository(prisma);
        this.refValidator = new CoreReviewRefValidator(prisma);
        this.landuseRepo = new CoreReviewLanduseRepository(prisma);
    }

    private async validateIssues(
        checks: Promise<{ path: string; message: string }[]>[],
    ): Promise<void> {
        const results = await Promise.all(checks);
        const issues = results.flat();
        if (issues.length > 0) {
            throw new CoreReviewValidationError(validationMessageFromIssues(issues), issues);
        }
    }

    private warnParentGeometry(log: WriteLogger | undefined, parentId: bigint | null | undefined) {
        if (parentId != null) {
            // TODO: ST_Contains parent boundary check when validation endpoint exists
            log?.warn({ parentId: parentId.toString() }, "admin-area parent geometry containment not validated");
        }
    }

    async create(slug: CoreReviewEntitySlug, body: Record<string, unknown>, log?: WriteLogger) {
        switch (slug) {
            case "bus-stops": {
                const sourceTypeId = await resolveSourceTypeId(this.refValidator, body);
                await this.validateIssues([
                    this.refValidator.validateAdminAreaId(
                        pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id") ?? null,
                    ),
                    this.refValidator.validateSourceTypeId(sourceTypeId),
                ]);
                const publicId = await this.writeRepo.createBusStop(body, sourceTypeId);
                if (!publicId) throw new CoreReviewValidationError("Failed to create bus stop");
                const row = await this.entitiesRepo.getBusStopByPublicId(publicId);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "bus-routes": {
                const sourceTypeId = await resolveSourceTypeId(this.refValidator, body);
                await this.validateIssues([this.refValidator.validateSourceTypeId(sourceTypeId)]);
                const id = await this.writeRepo.createBusRoute(body, sourceTypeId);
                if (!id) throw new CoreReviewValidationError("Failed to create bus route");
                const row = await this.entitiesRepo.getBusRouteById(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "bus-route-variants": {
                const routeId = pickAlias<bigint>(body, "routeId", "route_id");
                if (routeId === undefined) {
                    throw new CoreReviewValidationError("routeId is required", [
                        { path: "routeId", message: "Required" },
                    ]);
                }
                await this.validateIssues([this.refValidator.validateBusRouteId(routeId)]);
                const id = await this.writeRepo.createBusRouteVariant(body);
                if (!id) throw new CoreReviewValidationError("Failed to create bus route variant");
                const row = await this.entitiesRepo.getBusRouteVariantById(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "landuse": {
                await this.validateIssues([
                    this.refValidator.validateLanduseClassId(
                        pickAlias<bigint>(body, "landuseClassId", "landuse_class_id"),
                        true
                    ),
                    this.refValidator.validateAdminAreaId(
                        pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id") ?? null
                    ),
                ]);
                const publicId = await this.landuseRepo.createLanduse(body);
                if (!publicId) throw new CoreReviewValidationError("Failed to create landuse feature");
                return getCoreReviewLanduseDetail(this.landuseRepo, publicId);
            }
            case "water-lines": {
                const id = await this.writeRepo.createWaterLine(body);
                if (!id) throw new CoreReviewValidationError("Failed to create water line");
                const row = await this.entitiesRepo.getWaterLineById(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "water-polygons": {
                const id = await this.writeRepo.createMapPolygon("core.core_map_water_polygons", body);
                if (!id) throw new CoreReviewValidationError("Failed to create water polygon");
                const row = await this.entitiesRepo.getWaterPolygonById(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "addresses": {
                const sourceTypeId = await resolveSourceTypeId(this.refValidator, body);
                const streetPublicId = pickAlias<string | null>(body, "streetId", "street_id") ?? null;
                const street = await this.refValidator.validateStreetPublicId(streetPublicId);
                if (street.issues.length > 0) {
                    throw new CoreReviewValidationError(
                        validationMessageFromIssues(street.issues),
                        street.issues,
                    );
                }
                await this.validateIssues([
                    this.refValidator.validateAdminAreaId(
                        pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id") ?? null,
                    ),
                    this.refValidator.validateSourceTypeId(sourceTypeId),
                ]);
                const publicId = await this.writeRepo.createAddress(body, sourceTypeId, street.internalId);
                if (!publicId) throw new CoreReviewValidationError("Failed to create address");
                const row = await this.entitiesRepo.getAddressByPublicId(publicId);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "admin-areas": {
                const sourceTypeId = await resolveSourceTypeId(this.refValidator, body);
                const adminLevelId = pickAlias<bigint>(body, "adminLevelId", "admin_level_id");
                if (adminLevelId === undefined) {
                    throw new CoreReviewValidationError("adminLevelId is required", [
                        { path: "adminLevelId", message: "Required" },
                    ]);
                }
                const parentId = pickAlias<bigint | null>(body, "parentId", "parent_id") ?? null;
                this.warnParentGeometry(log, parentId);
                Object.assign(
                    body,
                    await applyAdminAreaBoundaryDefaultsForCreate(this.prisma, body),
                );
                await this.validateIssues([
                    this.refValidator.validateAdminLevelId(adminLevelId),
                    this.refValidator.validateParentAdminAreaId(parentId),
                    this.refValidator.validateSourceTypeId(sourceTypeId),
                    this.refValidator.validateBoundaryStatusCode(
                        pickAlias(body, "boundaryStatus", "boundary_status"),
                        true,
                    ),
                    this.refValidator.validateAddressUsageCode(
                        pickAlias(body, "addressUsage", "address_usage"),
                        true,
                    ),
                    Promise.resolve(
                        this.refValidator.validateBoundaryConfidenceScore(
                            pickAlias(body, "boundaryConfidenceScore", "boundary_confidence_score"),
                            true,
                        ),
                    ),
                ]);
                const publicId = await this.writeRepo.createAdminArea(body, sourceTypeId);
                if (!publicId) throw new CoreReviewValidationError("Failed to create admin area");
                const row = await this.entitiesRepo.getAdminAreaByPublicId(publicId);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            default:
                throw new CoreReviewValidationError(`Write not supported for ${slug}`);
        }
    }

    async update(slug: CoreReviewEntitySlug, id: string, body: Record<string, unknown>, log?: WriteLogger) {
        switch (slug) {
            case "bus-stops": {
                await this.validateIssues([
                    this.refValidator.validateAdminAreaId(
                        pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id"),
                    ),
                    this.refValidator.validateSourceTypeId(
                        pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id"),
                    ),
                ]);
                const ok = await this.writeRepo.updateBusStop(id, body);
                if (!ok) throw new CoreReviewNotFoundError();
                const row = await this.entitiesRepo.getBusStopByPublicId(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "bus-routes": {
                await this.validateIssues([
                    this.refValidator.validateSourceTypeId(
                        pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id"),
                    ),
                ]);
                const ok = await this.writeRepo.updateBusRoute(id, body);
                if (!ok) throw new CoreReviewNotFoundError();
                const row = await this.entitiesRepo.getBusRouteById(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "bus-route-variants": {
                const routeId = pickAlias<bigint>(body, "routeId", "route_id");
                if (routeId !== undefined) {
                    await this.validateIssues([this.refValidator.validateBusRouteId(routeId)]);
                }
                const ok = await this.writeRepo.updateBusRouteVariant(id, body);
                if (!ok) throw new CoreReviewNotFoundError();
                const row = await this.entitiesRepo.getBusRouteVariantById(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "landuse": {
                await this.validateIssues([
                    this.refValidator.validateLanduseClassId(
                        pickAlias<bigint | null>(body, "landuseClassId", "landuse_class_id"),
                        false
                    ),
                    this.refValidator.validateAdminAreaId(
                        pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id")
                    ),
                ]);
                const ok = await this.landuseRepo.updateLanduse(id, body);
                if (!ok) throw new CoreReviewNotFoundError();
                const detail = await getCoreReviewLanduseDetail(this.landuseRepo, id);
                if (!detail) throw new CoreReviewNotFoundError();
                return detail;
            }
            case "water-lines": {
                const ok = await this.writeRepo.updateWaterLine(id, body);
                if (!ok) throw new CoreReviewNotFoundError();
                const row = await this.entitiesRepo.getWaterLineById(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "water-polygons": {
                const ok = await this.writeRepo.updateMapPolygon("core.core_map_water_polygons", id, body);
                if (!ok) throw new CoreReviewNotFoundError();
                const row = await this.entitiesRepo.getWaterPolygonById(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "addresses": {
                const streetPublicId = pickAlias<string | null>(body, "streetId", "street_id");
                let streetInternalId: bigint | null | undefined;
                if (streetPublicId !== undefined) {
                    const street = await this.refValidator.validateStreetPublicId(streetPublicId);
                    if (street.issues.length > 0) {
                        throw new CoreReviewValidationError("Validation failed", street.issues);
                    }
                    streetInternalId = street.internalId;
                }
                await this.validateIssues([
                    this.refValidator.validateAdminAreaId(
                        pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id"),
                    ),
                    this.refValidator.validateSourceTypeId(
                        pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id"),
                    ),
                ]);
                const ok = await this.writeRepo.updateAddress(id, body, streetInternalId);
                if (!ok) throw new CoreReviewNotFoundError();
                const row = await this.entitiesRepo.getAddressByPublicId(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            case "admin-areas": {
                const parentId = pickAlias<bigint | null>(body, "parentId", "parent_id");
                if (parentId !== undefined) {
                    this.warnParentGeometry(log, parentId);
                }
                Object.assign(
                    body,
                    await applyAdminAreaBoundaryDefaultsForPatch(this.prisma, body),
                );
                const checks = [];
                const adminLevelId = pickAlias<bigint>(body, "adminLevelId", "admin_level_id");
                if (adminLevelId !== undefined) {
                    checks.push(this.refValidator.validateAdminLevelId(adminLevelId));
                }
                if (parentId !== undefined) {
                    checks.push(this.refValidator.validateParentAdminAreaId(parentId));
                }
                checks.push(
                    this.refValidator.validateSourceTypeId(
                        pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id"),
                    ),
                );
                if (pickAlias(body, "boundaryStatus", "boundary_status") !== undefined) {
                    checks.push(
                        this.refValidator.validateBoundaryStatusCode(
                            pickAlias(body, "boundaryStatus", "boundary_status"),
                        ),
                    );
                }
                if (pickAlias(body, "addressUsage", "address_usage") !== undefined) {
                    checks.push(
                        this.refValidator.validateAddressUsageCode(
                            pickAlias(body, "addressUsage", "address_usage"),
                        ),
                    );
                }
                if (pickAlias(body, "boundaryConfidenceScore", "boundary_confidence_score") !== undefined) {
                    checks.push(
                        Promise.resolve(
                            this.refValidator.validateBoundaryConfidenceScore(
                                pickAlias(body, "boundaryConfidenceScore", "boundary_confidence_score"),
                            ),
                        ),
                    );
                }
                await this.validateIssues(checks);
                const ok = await this.writeRepo.updateAdminArea(id, body);
                if (!ok) throw new CoreReviewNotFoundError();
                const row = await this.entitiesRepo.getAdminAreaByPublicId(id);
                return buildDetailResponse(serializeGenericCoreRow(row!));
            }
            default:
                throw new CoreReviewValidationError(`Write not supported for ${slug}`);
        }
    }
}
