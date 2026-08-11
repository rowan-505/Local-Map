import type { z } from "zod";

import type { JwtUser } from "../../plugins/auth.js";
import { BUILDING_TYPE_ID_VALIDATION_MESSAGE } from "../../lib/building-type/active-building-type-sql.js";
import {
    EntityAdminAreaService,
    EntityAdminAreaValidationError,
} from "../entity-admin-area/entity-admin-area.service.js";
import {
    buildBuildingTypeRef,
    resolveBuildingTypeCode,
    resolveBuildingTypeName,
    resolveBuildingTypeNameMm,
} from "../../lib/building-type/building-type-response.js";
import {
    buildingTypeClassificationNormalizedPatch,
    classifyBuildingTypeCode,
} from "../../lib/building-type/classify-building-type-code.js";
import { mapBuildingNameFields } from "../../lib/entity-names/building-detail-select-sql.js";
import {
    effectiveVerificationStatusFromRow,
    isVerifiedFromVerificationStatus,
    pickCoreReviewVerificationWrite,
    resolveCoreReviewVerificationWrite,
} from "../core-review/core-review-verification-write.js";
import type { BuildingValidationIssue } from "./buildings.schema.js";
import {
    BuildingsRepository,
    type BuildingDetailRow,
    type BuildingGeometryAnalysisRow,
    type BuildingPersistSnapshot,
} from "./buildings.repo.js";
import { resolveBuildingAdminAreaForUpdate } from "../../lib/core-review/building-admin-area-write.js";
import { createBuildingBodySchema, updateBuildingBodySchema } from "./buildings.schema.js";

type CreateBuildingBody = z.infer<typeof createBuildingBodySchema>;
type UpdateBuildingBody = z.infer<typeof updateBuildingBodySchema>;

const AREA_MIN_EXCLUSIVE = 3;
const AREA_MAX_EXCLUSIVE = 200_000;

function normalizedOptionalName(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function editorIdFromJwt(user: JwtUser): bigint | null {
    const raw = user.id?.trim();
    return raw && /^\d+$/.test(raw) ? BigInt(raw) : null;
}

export function buildingPatchChangesImportedAttributes(
    existing: BuildingDetailRow,
    patch: UpdateBuildingBody,
    snapshot: BuildingPersistSnapshot
): boolean {
    if (
        patch.name !== undefined
        && normalizedOptionalName(snapshot.name)
            !== normalizedOptionalName(existing.fallback_name)
    ) {
        return true;
    }

    if (
        patch.name_mm !== undefined
        && normalizedOptionalName(snapshot.name_mm)
            !== normalizedOptionalName(existing.name_mm)
    ) {
        return true;
    }

    if (
        patch.name_en !== undefined
        && normalizedOptionalName(snapshot.name_en)
            !== normalizedOptionalName(existing.name_en)
    ) {
        return true;
    }

    if (
        (patch.building_type_id !== undefined || patch.building_type !== undefined)
        && snapshot.building_type_id?.toString() !== (existing.building_type_id ?? undefined)
    ) {
        return true;
    }

    if (
        patch.admin_area_id !== undefined
        && snapshot.admin_area_id?.toString() !== (existing.admin_area_id ?? undefined)
    ) {
        return true;
    }

    if (patch.levels !== undefined && snapshot.levels !== existing.levels) {
        return true;
    }

    if (patch.height_m !== undefined && snapshot.height_m !== existing.height_m) {
        return true;
    }

    return (
        patch.confidence_score !== undefined
        && snapshot.confidence_score !== Number(existing.confidence_score ?? 80)
    );
}

export class BuildingNotFoundError extends Error {
    constructor(message = "Building not found") {
        super(message);
        this.name = "BuildingNotFoundError";
    }
}

export class BuildingValidationError extends Error {
    readonly issues: BuildingValidationIssue[];

    constructor(message: string, issues: BuildingValidationIssue[]) {
        super(message);
        this.name = "BuildingValidationError";
        this.issues = issues;
    }
}

export class BuildingsService {
    constructor(
        private readonly buildingsRepo: BuildingsRepository,
        private readonly entityAdminArea: EntityAdminAreaService
    ) {}

    async listBuildings(params: {
        limit: number;
        offset: number;
        q?: string;
        sortBy: "name" | "building_type" | "admin_area" | "created" | "updated" | "updated_at";
        sortOrder: "asc" | "desc";
    }) {
        const buildings = await this.buildingsRepo.listActiveBuildings(params);
        return buildings.map((row) => this.serializeBuilding(row));
    }

    async getBuildingByPublicId(publicId: string) {
        const row = await this.buildingsRepo.getActiveBuildingByPublicId(publicId);

        if (!row) {
            throw new BuildingNotFoundError();
        }

        return this.serializeBuilding(row);
    }

    async createBuilding(body: CreateBuildingBody, user: JwtUser) {
        const geojsonText = JSON.stringify(body.geometry);

        await this.validateGeoJsonPipeline(geojsonText);

        const snapshot = await this.buildPersistSnapshotFromCreate(body, user);
        const created = await this.buildingsRepo.createDashboardBuilding(geojsonText, snapshot);

        if (!created) {
            throw new BuildingValidationError("Building could not be saved", [
                {
                    path: "geometry",
                    message:
                        `Polygon area must be between ${AREA_MIN_EXCLUSIVE} and ${AREA_MAX_EXCLUSIVE} square meters after normalization.`,
                },
            ]);
        }

        return this.serializeBuilding(created);
    }

    async updateBuilding(publicId: string, body: UpdateBuildingBody, user: JwtUser) {
        const existing = await this.buildingsRepo.getDashboardBuildingByPublicId(publicId);

        if (!existing) {
            throw new BuildingNotFoundError();
        }

        const snapshot = await this.mergePersistSnapshot(existing, body, user);
        const protectAttributes = buildingPatchChangesImportedAttributes(existing, body, snapshot);
        const editorId = editorIdFromJwt(user);

        if (body.geometry !== undefined) {
            const geojsonText = JSON.stringify(body.geometry);
            await this.validateGeoJsonPipeline(geojsonText);

            const updated = await this.buildingsRepo.updateDashboardBuildingGeometry(
                publicId,
                geojsonText,
                snapshot,
                "dashboard",
                { editorId, protectAttributes }
            );

            if (!updated) {
                throw new BuildingValidationError("Building geometry update failed validation", [
                    {
                        path: "geometry",
                        message:
                            `Polygon area must be between ${AREA_MIN_EXCLUSIVE} and ${AREA_MAX_EXCLUSIVE} square meters.`,
                    },
                ]);
            }

            return this.serializeBuilding(updated);
        }

        const updated = await this.buildingsRepo.updateDashboardBuildingScalars(
            publicId,
            snapshot,
            "dashboard",
            { editorId, protectAttributes }
        );

        if (!updated) {
            throw new BuildingNotFoundError();
        }

        return this.serializeBuilding(updated);
    }

    /** Core Review inline edit — any active building (import or dashboard). */
    async updateCoreReviewBuilding(publicId: string, body: UpdateBuildingBody, user: JwtUser) {
        const existing = await this.buildingsRepo.getActiveBuildingByPublicId(publicId);

        if (!existing) {
            throw new BuildingNotFoundError();
        }

        const snapshot = await this.mergePersistSnapshot(existing, body, user);
        const protectAttributes = buildingPatchChangesImportedAttributes(existing, body, snapshot);
        const editorId = editorIdFromJwt(user);

        if (body.geometry !== undefined) {
            const geojsonText = JSON.stringify(body.geometry);
            await this.validateGeoJsonPipeline(geojsonText);

            const updated = await this.buildingsRepo.updateDashboardBuildingGeometry(
                publicId,
                geojsonText,
                snapshot,
                "active",
                { editorId, protectAttributes },
            );

            if (!updated) {
                throw new BuildingValidationError("Building geometry update failed validation", [
                    {
                        path: "geometry",
                        message:
                            `Polygon area must be between ${AREA_MIN_EXCLUSIVE} and ${AREA_MAX_EXCLUSIVE} square meters.`,
                    },
                ]);
            }

            return this.serializeBuilding(updated);
        }

        const updated = await this.buildingsRepo.updateDashboardBuildingScalars(
            publicId,
            snapshot,
            "active",
            { editorId, protectAttributes },
        );

        if (!updated) {
            throw new BuildingNotFoundError();
        }

        return this.serializeBuilding(updated);
    }

    async softDeleteBuilding(publicId: string): Promise<{ public_id: string }> {
        const deleted = await this.buildingsRepo.softDeleteActiveBuildingByPublicId(publicId);

        if (!deleted) {
            throw new BuildingNotFoundError();
        }

        return { public_id: deleted.public_id };
    }

    async listRefBuildingTypes() {
        return this.buildingsRepo.listActiveRefBuildingTypes();
    }

    private serializeBuilding(row: BuildingDetailRow) {
        const names = mapBuildingNameFields(row);
        const buildingTypeCode = resolveBuildingTypeCode(row);
        const buildingType = buildBuildingTypeRef(row);

        return {
            id: row.id,
            public_id: row.public_id,
            source_staging_id: row.source_staging_id,
            external_id: row.external_id,
            names: names.names,
            name_mm: names.name_mm,
            name_en: names.name_en,
            fallback_name: names.fallback_name,
            name: names.name,
            building_type_id: row.building_type_id,
            building_type: buildingType,
            building_type_code: buildingTypeCode,
            building_type_name: resolveBuildingTypeName(row, buildingTypeCode),
            building_type_name_mm: resolveBuildingTypeNameMm(row),
            admin_area_id: row.admin_area_id,
            admin_area:
                row.admin_area_row_id !== null && row.admin_area_row_id !== undefined
                    ? {
                          id: row.admin_area_row_id,
                          canonical_name: row.admin_area_canonical_name ?? "",
                          slug: row.admin_area_slug ?? "",
                      }
                    : null,
            class_code: row.class_code,
            normalized_data: row.normalized_data,
            source_refs: row.source_refs,
            levels: row.levels,
            height_m: row.height_m,
            area_m2: row.area_m2,
            confidence_score: row.confidence_score,
            verification_status: effectiveVerificationStatusFromRow(row),
            is_verified: isVerifiedFromVerificationStatus(effectiveVerificationStatusFromRow(row)),
            is_active: row.is_active,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            deleted_at: row.deleted_at?.toISOString() ?? null,
            geometry: row.geometry,
        };
    }

    private async buildPersistSnapshotFromCreate(
        body: CreateBuildingBody,
        user: JwtUser
    ): Promise<BuildingPersistSnapshot> {
        const { admin_area_id, admin_area_resolve_spatial } = await this.resolveBuildingAdminAssignment(
            body.geometry,
            body.admin_area_id,
            user
        );

        const verification = resolveCoreReviewVerificationWrite(
            body as unknown as Record<string, unknown>,
        );

        if (body.building_type_id !== undefined) {
            const ref = await this.buildingsRepo.getActiveBuildingTypeById(body.building_type_id);

            if (!ref) {
                throw new BuildingValidationError("Invalid building type", [
                    {
                        path: "building_type_id",
                        message: BUILDING_TYPE_ID_VALIDATION_MESSAGE,
                    },
                ]);
            }

            const label = ref.code;

            return {
                name: body.name ?? null,
                name_mm: body.name_mm,
                name_en: body.name_en,
                class_code: label,
                building_type_column: label,
                building_type_id: ref.id,
                admin_area_resolve_spatial,
                admin_area_id,
                normalized_data: normalizedFromCreate(body, label, ref.id),
                levels: body.levels ?? null,
                height_m: body.height_m ?? null,
                confidence_score: body.confidence_score ?? 80,
                verification_status: verification.verificationStatus,
                is_verified: verification.isVerified,
            };
        }

        const classified = classifyBuildingTypeCode(body.building_type);
        const matched = await this.buildingsRepo.findBuildingTypeByCode(classified.code);

        if (!matched) {
            throw new BuildingValidationError("Invalid building type", [
                {
                    path: "building_type",
                    message: BUILDING_TYPE_ID_VALIDATION_MESSAGE,
                },
            ]);
        }

        const label = matched.code;

        return {
            name: body.name ?? null,
            name_mm: body.name_mm,
            name_en: body.name_en,
            class_code: label,
            building_type_column: label,
            building_type_id: matched.id,
            admin_area_resolve_spatial,
            admin_area_id,
            normalized_data: {
                ...normalizedFromCreate(body, label, matched.id),
                ...buildingTypeClassificationNormalizedPatch(classified),
            },
            levels: body.levels ?? null,
            height_m: body.height_m ?? null,
            confidence_score: body.confidence_score ?? 80,
            verification_status: verification.verificationStatus,
            is_verified: verification.isVerified,
        };
    }

    private async mergePersistSnapshot(
        existing: BuildingDetailRow,
        patch: UpdateBuildingBody,
        user: JwtUser
    ): Promise<BuildingPersistSnapshot> {
        let building_type_id: bigint | null = existing.building_type_id ? BigInt(existing.building_type_id) : null;
        let resolvedType: string;

        if (patch.building_type_id === null) {
            building_type_id = null;
            resolvedType = coalesceBuildingTypeFromRow(existing.building_type_code, existing.class_code);
        } else if (patch.building_type_id !== undefined) {
            const ref = await this.buildingsRepo.getActiveBuildingTypeById(patch.building_type_id);

            if (!ref) {
                throw new BuildingValidationError("Invalid building type", [
                    {
                        path: "building_type_id",
                        message: BUILDING_TYPE_ID_VALIDATION_MESSAGE,
                    },
                ]);
            }

            building_type_id = ref.id;
            resolvedType = ref.code;
        } else if (patch.building_type !== undefined) {
            const classified = classifyBuildingTypeCode(patch.building_type);
            const matched = await this.buildingsRepo.findBuildingTypeByCode(classified.code);

            if (!matched) {
                throw new BuildingValidationError("Invalid building type", [
                    {
                        path: "building_type",
                        message: BUILDING_TYPE_ID_VALIDATION_MESSAGE,
                    },
                ]);
            }

            building_type_id = matched.id;
            resolvedType = matched.code;
        } else {
            resolvedType = coalesceBuildingTypeFromRow(existing.building_type_code, existing.class_code);
        }

        const name =
            patch.name !== undefined ? patch.name : (existing.fallback_name ?? null);

        const name_mm = patch.name_mm !== undefined ? patch.name_mm : undefined;
        const name_en = patch.name_en !== undefined ? patch.name_en : undefined;

        const levels = patch.levels !== undefined ? patch.levels : existing.levels;

        const height_m = patch.height_m !== undefined ? patch.height_m : existing.height_m;

        const confidence_score =
            patch.confidence_score !== undefined
                ? patch.confidence_score
                : Number(existing.confidence_score ?? 80);

        let verification_status = effectiveVerificationStatusFromRow(existing);
        let is_verified = isVerifiedFromVerificationStatus(verification_status);
        const pickedVerification = pickCoreReviewVerificationWrite(
            patch as unknown as Record<string, unknown>,
        );
        if (pickedVerification) {
            verification_status = pickedVerification.verificationStatus;
            is_verified = pickedVerification.isVerified;
        }

        const classificationPatch =
            patch.building_type !== undefined
                ? buildingTypeClassificationNormalizedPatch(classifyBuildingTypeCode(patch.building_type))
                : {};

        const normalized_data = {
            ...mergeNormalizedForPatch(
                coerceRecord(existing.normalized_data),
                resolvedType,
                building_type_id,
                patch
            ),
            ...classificationPatch,
        };

        const geometry =
            patch.geometry ??
            (existing.geometry as CreateBuildingBody["geometry"] | null | undefined);

        const { admin_area_id, admin_area_resolve_spatial } =
            await this.resolveBuildingAdminAssignmentForUpdate(
                existing,
                patch,
                geometry ?? undefined,
                user,
            );

        return {
            name,
            name_mm,
            name_en,
            class_code: resolvedType,
            building_type_column: resolvedType,
            building_type_id,
            admin_area_resolve_spatial,
            admin_area_id,
            normalized_data,
            levels,
            height_m,
            confidence_score,
            verification_status,
            is_verified,
        };
    }

    private async resolveBuildingAdminAssignmentForUpdate(
        existing: BuildingDetailRow,
        patch: UpdateBuildingBody,
        geometry: CreateBuildingBody["geometry"] | undefined,
        user: JwtUser,
    ): Promise<{ admin_area_id: bigint | null; admin_area_resolve_spatial: boolean }> {
        const existingAdminAreaId =
            existing.admin_area_id !== null && existing.admin_area_id !== undefined
                ? BigInt(existing.admin_area_id)
                : null;

        try {
            return await resolveBuildingAdminAreaForUpdate({
                service: this.entityAdminArea,
                patch,
                existingAdminAreaId,
                fallbackGeometry: geometry,
                user,
            });
        } catch (error) {
            if (error instanceof EntityAdminAreaValidationError) {
                throw new BuildingValidationError(error.message, error.issues);
            }
            throw error;
        }
    }

    private async resolveBuildingAdminAssignment(
        geometry: CreateBuildingBody["geometry"] | undefined,
        requestedAdminAreaId: bigint | null | undefined,
        user: JwtUser
    ): Promise<{ admin_area_id: bigint | null; admin_area_resolve_spatial: boolean }> {
        if (!geometry) {
            return { admin_area_id: requestedAdminAreaId ?? null, admin_area_resolve_spatial: false };
        }

        try {
            const resolved = await this.entityAdminArea.resolveForWrite({
                kind: "building",
                geometry,
                requested_admin_area_id: requestedAdminAreaId,
                user,
                path: "admin_area_id",
            });
            return {
                admin_area_id: resolved.admin_area_id,
                admin_area_resolve_spatial: resolved.admin_area_id === null,
            };
        } catch (error) {
            if (error instanceof EntityAdminAreaValidationError) {
                throw new BuildingValidationError(error.message, error.issues);
            }
            throw error;
        }
    }

    private async validateGeoJsonPipeline(geojsonText: string) {
        let analysis: BuildingGeometryAnalysisRow | null;

        try {
            analysis = await this.buildingsRepo.analyzeBuildingGeometry(geojsonText);
        } catch {
            throw new BuildingValidationError("Geometry could not be parsed", [
                {
                    path: "geometry",
                    message:
                        "Invalid GeoJSON payload or incompatible geometry type for PostGIS ST_GeomFromGeoJSON.",
                },
            ]);
        }

        this.validateAnalysisOrThrow(analysis);
    }

    private validateAnalysisOrThrow(analysis: BuildingGeometryAnalysisRow | null) {
        const issues: BuildingValidationIssue[] = [];

        if (!analysis?.allowed_type) {
            issues.push({
                path: "geometry",
                message: "Geometry must be a Polygon or MultiPolygon with coordinates in EPSG:4326.",
            });
        } else if (!analysis.is_valid) {
            issues.push({
                path: "geometry",
                message: analysis.invalid_reason?.trim()
                    ? `Invalid geometry: ${analysis.invalid_reason}`
                    : "Geometry failed validity checks (ST_IsValid).",
            });
        } else if (
            analysis.area_m2 === null ||
            !(analysis.area_m2 > AREA_MIN_EXCLUSIVE && analysis.area_m2 < AREA_MAX_EXCLUSIVE)
        ) {
            issues.push({
                path: "geometry",
                message: `Polygon area must be greater than ${AREA_MIN_EXCLUSIVE} m² and less than ${AREA_MAX_EXCLUSIVE} m² (computed via geography).`,
            });
        }

        if (issues.length > 0) {
            throw new BuildingValidationError("Building geometry validation failed", issues);
        }
    }
}

function normalizeBuildingType(input?: string | null): string {
    return classifyBuildingTypeCode(input).code;
}

/** Label for class_code when no FK: COALESCE(ref code via join, class_code, 'yes'). */
function coalesceBuildingTypeFromRow(buildingTypeCode: string | null, classCode: string): string {
    const code = buildingTypeCode?.trim();
    if (code) {
        return code;
    }

    const cc = classCode?.trim();
    if (cc) {
        return cc;
    }

    return "yes";
}

function coerceRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return { ...(value as Record<string, unknown>) };
    }

    return {};
}

function normalizedFromCreate(
    body: CreateBuildingBody,
    label: string,
    buildingTypeId: bigint | null
): Record<string, unknown> {
    const out: Record<string, unknown> = {
        building_type: label,
    };

    if (buildingTypeId !== null) {
        out.building_type_id = String(buildingTypeId);
    }

    if (body.levels !== undefined) {
        out.levels = body.levels;
    }

    if (body.height_m !== undefined) {
        out.height_m = body.height_m;
    }

    return out;
}

function mergeNormalizedForPatch(
    existing: Record<string, unknown>,
    resolvedBuildingTypeLabel: string,
    buildingTypeId: bigint | null,
    patch: UpdateBuildingBody
): Record<string, unknown> {
    const next = { ...existing };
    next.building_type = resolvedBuildingTypeLabel;

    if (buildingTypeId !== null) {
        next.building_type_id = String(buildingTypeId);
    } else {
        delete next.building_type_id;
    }

    if ("levels" in patch) {
        if (patch.levels === null) {
            delete next.levels;
        } else {
            next.levels = patch.levels;
        }
    }

    if ("height_m" in patch) {
        if (patch.height_m === null) {
            delete next.height_m;
        } else {
            next.height_m = patch.height_m;
        }
    }

    return next;
}
