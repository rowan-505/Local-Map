import type { JwtUser } from "../../../plugins/auth.js";
import { createStreetBodySchema, updateStreetBodySchema } from "../../streets/streets.schema.js";
import {
    StreetNotFoundError,
    StreetsService,
    StreetValidationError,
} from "../../streets/streets.service.js";
import { StreetsRepository } from "../../streets/streets.repo.js";
import { CoreReviewValidationError } from "../core-review-write.errors.js";
import { mapCoreReviewStreetCreate, mapCoreReviewStreetPatch } from "../core-review-write.mappers.js";
import { getCoreReviewStreetDetail } from "./streets.handler.js";

export async function createCoreReviewStreet(
    repo: StreetsRepository,
    service: StreetsService,
    body: Record<string, unknown>,
    user: JwtUser,
) {
    const mapped = mapCoreReviewStreetCreate(body);
    const parsed = createStreetBodySchema.safeParse(mapped);
    if (!parsed.success) {
        throw new CoreReviewValidationError("Invalid street payload", [
            { path: "geometry", message: parsed.error.message },
        ]);
    }

    try {
        const created = await service.createStreet(parsed.data, user);
        const detail = await getCoreReviewStreetDetail(repo, created.public_id);
        if (!detail) {
            throw new CoreReviewValidationError("Street was created but could not be loaded");
        }
        return detail;
    } catch (error) {
        if (error instanceof StreetValidationError) {
            throw new CoreReviewValidationError(error.message);
        }
        throw error;
    }
}

export async function updateCoreReviewStreet(
    repo: StreetsRepository,
    service: StreetsService,
    id: string,
    body: Record<string, unknown>,
    user: JwtUser,
) {
    const mapped = mapCoreReviewStreetPatch(body);
    const parsed = updateStreetBodySchema.safeParse(mapped);
    if (!parsed.success) {
        throw new CoreReviewValidationError("Invalid street payload", [
            { path: "geometry", message: parsed.error.message },
        ]);
    }

    try {
        await service.updateStreet(id, parsed.data, user);
        const detail = await getCoreReviewStreetDetail(repo, id);
        if (!detail) {
            throw new CoreReviewValidationError("Street was updated but could not be loaded");
        }
        return detail;
    } catch (error) {
        if (error instanceof StreetNotFoundError) {
            return null;
        }
        if (error instanceof StreetValidationError) {
            throw new CoreReviewValidationError(error.message);
        }
        throw error;
    }
}
