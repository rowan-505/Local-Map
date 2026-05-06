import type { z } from "zod";

import type { BuildingValidationIssue } from "./buildings.schema.js";
import {
    BuildingsRepository,
    type BuildingDetailRow,
    type BuildingGeometryAnalysisRow,
    type BuildingPersistSnapshot,
} from "./buildings.repo.js";
import { createBuildingBodySchema, updateBuildingBodySchema } from "./buildings.schema.js";

type CreateBuildingBody = z.infer<typeof createBuildingBodySchema>;
type UpdateBuildingBody = z.infer<typeof updateBuildingBodySchema>;

const AREA_MIN_EXCLUSIVE = 3;
const AREA_MAX_EXCLUSIVE = 200_000;

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
    constructor(private readonly buildingsRepo: BuildingsRepository) {}

    async listBuildings(params: {
        limit: number;
        offset: number;
        q?: string;
        sortBy: "name" | "building_type" | "admin_area" | "created" | "updated";
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

    async createBuilding(body: CreateBuildingBody) {
        const geojsonText = JSON.stringify(body.geometry);

        await this.validateGeoJsonPipeline(geojsonText);

        const snapshot = await this.buildPersistSnapshotFromCreate(body);
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

    async updateBuilding(publicId: string, body: UpdateBuildingBody) {
        const existing = await this.buildingsRepo.getDashboardBuildingByPublicId(publicId);

        if (!existing) {
            throw new BuildingNotFoundError();
        }

        const snapshot = await this.mergePersistSnapshot(existing, body);

        if (body.geometry !== undefined) {
            const geojsonText = JSON.stringify(body.geometry);
            await this.validateGeoJsonPipeline(geojsonText);

            const updated = await this.buildingsRepo.updateDashboardBuildingGeometry(
                publicId,
                geojsonText,
                snapshot
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

        const updated = await this.buildingsRepo.updateDashboardBuildingScalars(publicId, snapshot);

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
        const buildingType =
            row.ref_bt_id && row.ref_bt_code && row.ref_bt_name
                ? {
                      id: row.ref_bt_id,
                      code: row.ref_bt_code,
                      name: row.ref_bt_name,
                      name_mm: row.ref_bt_name_mm,
                      parent_id: row.ref_bt_parent_id,
                  }
                : null;

        return {
            id: row.id,
            public_id: row.public_id,
            source_staging_id: row.source_staging_id,
            external_id: row.external_id,
            name: row.name,
            building_type_id: row.building_type_id,
            building_type: buildingType,
            building_type_code: row.building_type_code,
            building_type_name: row.building_type_name,
            building_type_name_mm: row.building_type_name_mm,
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
            is_verified: row.is_verified,
            is_active: row.is_active,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            deleted_at: row.deleted_at?.toISOString() ?? null,
            geometry: row.geometry,
        };
    }

    private async buildPersistSnapshotFromCreate(body: CreateBuildingBody): Promise<BuildingPersistSnapshot> {
        const userPinnedAdmin = typeof body.admin_area_id === "bigint";

        let admin_area_id: bigint | null = null;
        let admin_area_resolve_spatial = true;

        if (userPinnedAdmin) {
            admin_area_id = await this.resolveAdminAreaOrThrow(body.admin_area_id, "create");
            admin_area_resolve_spatial = false;
        }

        if (body.building_type_id !== undefined) {
            const ref = await this.buildingsRepo.getActiveBuildingTypeById(body.building_type_id);

            if (!ref) {
                throw new BuildingValidationError("Invalid building type", [
                    {
                        path: "building_type_id",
                        message: "Not found or inactive.",
                    },
                ]);
            }

            const label = ref.code;

            return {
                name: body.name ?? null,
                class_code: label,
                building_type_column: label,
                building_type_id: ref.id,
                admin_area_resolve_spatial,
                admin_area_id,
                normalized_data: normalizedFromCreate(body, label, ref.id),
                levels: body.levels ?? null,
                height_m: body.height_m ?? null,
                confidence_score: body.confidence_score ?? 80,
                is_verified: body.is_verified ?? false,
            };
        }

        const normalizedLabel = normalizeBuildingType(body.building_type);
        const matched = await this.buildingsRepo.findBuildingTypeByCode(normalizedLabel);
        const label = matched?.code ?? normalizedLabel;

        return {
            name: body.name ?? null,
            class_code: label,
            building_type_column: label,
            building_type_id: matched?.id ?? null,
            admin_area_resolve_spatial,
            admin_area_id,
            normalized_data: normalizedFromCreate(body, label, matched?.id ?? null),
            levels: body.levels ?? null,
            height_m: body.height_m ?? null,
            confidence_score: body.confidence_score ?? 80,
            is_verified: body.is_verified ?? false,
        };
    }

    private async mergePersistSnapshot(
        existing: BuildingDetailRow,
        patch: UpdateBuildingBody
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
                        message: "Not found or inactive.",
                    },
                ]);
            }

            building_type_id = ref.id;
            resolvedType = ref.code;
        } else if (patch.building_type !== undefined) {
            resolvedType = normalizeBuildingType(patch.building_type);
            const matched = await this.buildingsRepo.findBuildingTypeByCode(resolvedType);
            building_type_id = matched?.id ?? null;
            if (matched) {
                resolvedType = matched.code;
            }
        } else {
            resolvedType = coalesceBuildingTypeFromRow(existing.building_type_code, existing.class_code);
        }

        const name = patch.name !== undefined ? patch.name : existing.name;

        const levels = patch.levels !== undefined ? patch.levels : existing.levels;

        const height_m = patch.height_m !== undefined ? patch.height_m : existing.height_m;

        const confidence_score =
            patch.confidence_score !== undefined
                ? patch.confidence_score
                : Number(existing.confidence_score ?? 80);

        const is_verified = patch.is_verified !== undefined ? patch.is_verified : existing.is_verified;

        const normalized_data = mergeNormalizedForPatch(
            coerceRecord(existing.normalized_data),
            resolvedType,
            building_type_id,
            patch
        );

        let admin_area_id: bigint | null =
            existing.admin_area_id !== null &&
            existing.admin_area_id !== undefined &&
            existing.admin_area_id !== ""
                ? BigInt(existing.admin_area_id)
                : null;

        let admin_area_resolve_spatial = false;

        if (patch.admin_area_id === null) {
            admin_area_id = null;
        } else if (patch.admin_area_id !== undefined) {
            admin_area_id = await this.resolveAdminAreaOrThrow(patch.admin_area_id, "patch");
            admin_area_resolve_spatial = false;
        } else if (patch.geometry !== undefined) {
            admin_area_resolve_spatial = true;
            admin_area_id = null;
        }

        return {
            name,
            class_code: resolvedType,
            building_type_column: resolvedType,
            building_type_id,
            admin_area_resolve_spatial,
            admin_area_id,
            normalized_data,
            levels,
            height_m,
            confidence_score,
            is_verified,
        };
    }

    /** Resolves nullable admin FK; rejects inactive or unknown ids when non-null. */
    private async resolveAdminAreaOrThrow(
        adminAreaId: bigint | undefined | null,
        _context: "create" | "patch"
    ): Promise<bigint | null> {
        if (adminAreaId === undefined || adminAreaId === null) {
            return null;
        }

        const has = await this.buildingsRepo.hasActiveAdminArea(adminAreaId);

        if (!has) {
            throw new BuildingValidationError("Invalid admin area", [
                {
                    path: "admin_area_id",
                    message: "Not found or inactive.",
                },
            ]);
        }

        return adminAreaId;
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
    const trimmed = input?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "yes";
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
