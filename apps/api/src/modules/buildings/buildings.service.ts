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

    async listBuildings(params: { limit: number; offset: number; q?: string }) {
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

        const snapshot = persistSnapshotFromCreate(body);
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

        const snapshot = mergePersistSnapshot(existing, body);

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

    async softDeleteBuilding(publicId: string) {
        const deleted = await this.buildingsRepo.softDeleteDashboardBuilding(publicId);

        if (!deleted) {
            throw new BuildingNotFoundError();
        }

        return this.serializeBuilding(deleted);
    }

    private serializeBuilding(row: BuildingDetailRow) {
        return {
            id: row.id,
            public_id: row.public_id,
            source_staging_id: row.source_staging_id,
            external_id: row.external_id,
            name: row.name,
            building_type: coalesceBuildingType(row.building_type, row.class_code),
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

/** Matches SQL: COALESCE(building_type, class_code, 'yes') (blank building_type falls through). */
function coalesceBuildingType(buildingType: string | null, classCode: string): string {
    const bt = buildingType?.trim();
    if (bt) {
        return bt;
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

function normalizedFromCreate(body: CreateBuildingBody): Record<string, unknown> {
    const label = normalizeBuildingType(body.building_type);
    const out: Record<string, unknown> = {
        building_type: label,
    };

    if (body.levels !== undefined) {
        out.levels = body.levels;
    }

    if (body.height_m !== undefined) {
        out.height_m = body.height_m;
    }

    return out;
}

function persistSnapshotFromCreate(body: CreateBuildingBody): BuildingPersistSnapshot {
    const resolvedType = normalizeBuildingType(body.building_type);

    return {
        name: body.name ?? null,
        class_code: resolvedType,
        building_type_column: resolvedType,
        normalized_data: normalizedFromCreate(body),
        levels: body.levels ?? null,
        height_m: body.height_m ?? null,
        confidence_score: body.confidence_score ?? 80,
        is_verified: body.is_verified ?? false,
    };
}

function mergeNormalizedForPatch(
    existing: Record<string, unknown>,
    resolvedBuildingTypeLabel: string,
    patch: UpdateBuildingBody
): Record<string, unknown> {
    const next = { ...existing };
    next.building_type = resolvedBuildingTypeLabel;

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

function mergePersistSnapshot(existing: BuildingDetailRow, patch: UpdateBuildingBody): BuildingPersistSnapshot {
    const resolvedTypeSource =
        patch.building_type !== undefined
            ? patch.building_type
            : coalesceBuildingType(existing.building_type, existing.class_code);

    const resolvedType = normalizeBuildingType(resolvedTypeSource);

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
        patch
    );

    return {
        name,
        class_code: resolvedType,
        building_type_column: resolvedType,
        normalized_data,
        levels,
        height_m,
        confidence_score,
        is_verified,
    };
}
