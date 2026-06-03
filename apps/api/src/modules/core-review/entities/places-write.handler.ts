import type { JwtUser } from "../../../plugins/auth.js";
import { createPlaceBodySchema, updatePlaceBodySchema } from "../../places/places.schema.js";
import { PLACE_CATEGORY_NOT_FOUND_MESSAGE } from "../../places/places-category-validation.js";
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
    user: JwtUser,
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
        const created = await service.createPlace(parsed.data, user);
        const detail = await getCoreReviewPlaceDetail(repo, created.public_id);
        if (!detail) {
            throw new CoreReviewValidationError("Place was created but could not be loaded");
        }
        return detail;
    } catch (error) {
        if (error instanceof PlaceValidationError) {
            throw mapPlaceValidationError(error);
        }
        throw error;
    }
}

function mapPlaceValidationError(error: PlaceValidationError): CoreReviewValidationError {
    if (error.message.includes(PLACE_CATEGORY_NOT_FOUND_MESSAGE)) {
        return new CoreReviewValidationError(error.message, [
            { path: "categoryId", message: error.message },
        ]);
    }
    return new CoreReviewValidationError(error.message);
}

export async function updateCoreReviewPlace(
    repo: PlacesRepository,
    service: PlacesService,
    id: string,
    body: Record<string, unknown>,
    user: JwtUser,
) {
    const mapped = mapCoreReviewPlacePatch(body);
    const parsed = updatePlaceBodySchema.safeParse(mapped);
    if (!parsed.success) {
        throw new CoreReviewValidationError("Invalid place payload", [
            { path: "categoryId", message: parsed.error.message },
        ]);
    }

    try {
        await service.updatePlace(id, parsed.data, user);
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
            throw mapPlaceValidationError(error);
        }
        throw error;
    }
}
