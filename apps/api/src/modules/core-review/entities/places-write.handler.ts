import { createPlaceBodySchema, updatePlaceBodySchema } from "../../places/places.schema.js";
import {
    PlaceNotFoundError,
    PlacesService,
    PlaceValidationError,
} from "../../places/places.service.js";
import { PlacesRepository } from "../../places/places.repo.js";
import { CoreReviewValidationError } from "../core-review-write.errors.js";
import { mapCoreReviewPlaceCreate, mapCoreReviewPlacePatch } from "../core-review-write.mappers.js";
import { getCoreReviewPlaceDetail } from "./places.handler.js";

export async function createCoreReviewPlace(
    repo: PlacesRepository,
    service: PlacesService,
    body: Record<string, unknown>,
) {
    let mapped: Record<string, unknown>;
    try {
        mapped = mapCoreReviewPlaceCreate(body);
    } catch {
        throw new CoreReviewValidationError("lat and lng are required (or provide point geometry)", [
            { path: "lat", message: "Required" },
        ]);
    }

    const parsed = createPlaceBodySchema.safeParse(mapped);
    if (!parsed.success) {
        throw new CoreReviewValidationError("Invalid place payload", [
            { path: "categoryId", message: parsed.error.message },
        ]);
    }

    try {
        const created = await service.createPlace(parsed.data);
        const detail = await getCoreReviewPlaceDetail(repo, created.public_id);
        if (!detail) {
            throw new CoreReviewValidationError("Place was created but could not be loaded");
        }
        return detail;
    } catch (error) {
        if (error instanceof PlaceValidationError) {
            throw new CoreReviewValidationError(error.message);
        }
        throw error;
    }
}

export async function updateCoreReviewPlace(
    repo: PlacesRepository,
    service: PlacesService,
    id: string,
    body: Record<string, unknown>,
) {
    const mapped = mapCoreReviewPlacePatch(body);
    const parsed = updatePlaceBodySchema.safeParse(mapped);
    if (!parsed.success) {
        throw new CoreReviewValidationError("Invalid place payload", [
            { path: "categoryId", message: parsed.error.message },
        ]);
    }

    try {
        await service.updatePlace(id, parsed.data);
        const detail = await getCoreReviewPlaceDetail(repo, id);
        if (!detail) {
            throw new CoreReviewValidationError("Place was updated but could not be loaded");
        }
        return detail;
    } catch (error) {
        if (error instanceof PlaceNotFoundError) {
            return null;
        }
        if (error instanceof PlaceValidationError) {
            throw new CoreReviewValidationError(error.message);
        }
        throw error;
    }
}
