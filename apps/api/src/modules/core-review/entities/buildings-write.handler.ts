import { createBuildingBodySchema, updateBuildingBodySchema } from "../../buildings/buildings.schema.js";
import {
    BuildingNotFoundError,
    BuildingsService,
    BuildingValidationError,
} from "../../buildings/buildings.service.js";
import { BuildingsRepository } from "../../buildings/buildings.repo.js";
import { CoreReviewValidationError } from "../core-review-write.errors.js";
import { mapCoreReviewBuildingCreate, mapCoreReviewBuildingPatch } from "../core-review-write.mappers.js";
import { getCoreReviewBuildingDetail } from "./buildings.handler.js";

export async function createCoreReviewBuilding(
    repo: BuildingsRepository,
    service: BuildingsService,
    body: Record<string, unknown>,
) {
    const mapped = mapCoreReviewBuildingCreate(body);
    const parsed = createBuildingBodySchema.safeParse(mapped);
    if (!parsed.success) {
        throw new CoreReviewValidationError("Invalid building payload", [
            { path: "geometry", message: parsed.error.message },
        ]);
    }

    try {
        const created = await service.createBuilding(parsed.data);
        const detail = await getCoreReviewBuildingDetail(repo, created.public_id);
        if (!detail) {
            throw new CoreReviewValidationError("Building was created but could not be loaded");
        }
        return detail;
    } catch (error) {
        if (error instanceof BuildingValidationError) {
            throw new CoreReviewValidationError(error.message, error.issues);
        }
        throw error;
    }
}

export async function updateCoreReviewBuilding(
    repo: BuildingsRepository,
    service: BuildingsService,
    id: string,
    body: Record<string, unknown>,
) {
    const mapped = mapCoreReviewBuildingPatch(body);
    const parsed = updateBuildingBodySchema.safeParse(mapped);
    if (!parsed.success) {
        throw new CoreReviewValidationError("Invalid building payload", [
            { path: "geometry", message: parsed.error.message },
        ]);
    }

    try {
        await service.updateBuilding(id, parsed.data);
        const detail = await getCoreReviewBuildingDetail(repo, id);
        if (!detail) {
            throw new CoreReviewValidationError("Building was updated but could not be loaded");
        }
        return detail;
    } catch (error) {
        if (error instanceof BuildingNotFoundError) {
            return null;
        }
        if (error instanceof BuildingValidationError) {
            throw new CoreReviewValidationError(error.message, error.issues);
        }
        throw error;
    }
}
