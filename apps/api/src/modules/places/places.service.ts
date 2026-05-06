import type { z } from "zod";

import {
    PlacesRepository,
    type PlaceDetailRow,
    type PlaceRow,
    deriveDisplayName,
    derivePrimaryName,
} from "./places.repo.js";
import type { UpdatePlaceInput } from "./places.repo.js";
import { createPlaceBodySchema, updatePlaceBodySchema } from "./places.schema.js";

type CreatePlaceBody = z.infer<typeof createPlaceBodySchema>;
type UpdatePlaceBody = z.infer<typeof updatePlaceBodySchema>;

type ListPlacesInput = {
    limit: number;
    offset: number;
    q?: string;
    category?: string;
    is_public?: boolean;
    is_verified?: boolean;
    sortBy: "name" | "category" | "admin_area" | "created" | "updated";
    sortOrder: "asc" | "desc";
};

export class PlaceNotFoundError extends Error {
    constructor(message = "Place not found") {
        super(message);
        this.name = "PlaceNotFoundError";
    }
}

export class PlaceValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PlaceValidationError";
    }
}

export class PlacesService {
    constructor(private readonly placesRepo: PlacesRepository) {}

    private serializePlace(place: PlaceRow) {
        return {
            id: place.id.toString(),
            public_id: place.public_id,
            primary_name: place.primary_name,
            secondary_name: place.english_name ?? null,
            name_local: place.myanmar_name ?? null,
            myanmar_name: place.myanmar_name,
            english_name: place.english_name,
            name_mm: place.myanmar_name,
            name_en: place.english_name,
            display_name: place.display_name,
            category_id: place.category_id.toString(),
            category_name: place.category_name,
            admin_area_id: place.admin_area_id?.toString() ?? null,
            admin_area_name: place.admin_area_name,
            lat: place.lat,
            lng: place.lng,
            importance_score: place.importance_score,
            popularity_score: place.popularity_score,
            confidence_score: place.confidence_score,
            is_public: place.is_public,
            is_verified: place.is_verified,
            source_type_id: place.source_type_id.toString(),
            publish_status_id: place.publish_status_id?.toString() ?? null,
            created_at: place.created_at.toISOString(),
            updated_at: place.updated_at.toISOString(),
            names: place.names,
            myanmarName: place.myanmar_name,
            englishName: place.english_name,
        };
    }

    private serializePlaceDetail(place: PlaceDetailRow) {
        return {
            ...this.serializePlace(place),
            plus_code: place.plus_code,
            current_version_id: place.current_version_id?.toString() ?? null,
            deleted_at: place.deleted_at,
        };
    }

    async listPlaces(input: ListPlacesInput) {
        const places = await this.placesRepo.listPlaces({
            limit: input.limit,
            offset: input.offset,
            q: input.q,
            category: input.category,
            is_public: input.is_public,
            is_verified: input.is_verified,
            sortBy: input.sortBy,
            sortOrder: input.sortOrder,
        });

        return places.map((place) => this.serializePlace(place));
    }

    async getPlaceByPublicId(publicId: string) {
        const place = await this.placesRepo.getPlaceDetailByPublicId(publicId);

        if (!place) {
            throw new PlaceNotFoundError();
        }

        return this.serializePlaceDetail(place);
    }

    async getPlaceFormOptions() {
        const options = await this.placesRepo.getPlaceFormOptions();

        return {
            categories: options.categories.map((category) => ({
                id: category.id.toString(),
                label: category.name,
            })),
            admin_areas: options.admin_areas.map((adminArea) => ({
                id: adminArea.id.toString(),
                label: adminArea.canonical_name,
            })),
            source_types: options.source_types.map((sourceType) => ({
                id: sourceType.id.toString(),
                code: sourceType.code,
                label: sourceType.name,
            })),
            publish_statuses: options.publish_statuses.map((status) => ({
                id: status.id.toString(),
                code: status.code,
                label: status.name,
            })),
        };
    }

    async createPlace(body: CreatePlaceBody) {
        const categoryId = body.categoryId;

        const names = normalizePlaceNames({
            myanmarName: body.myanmarName,
            englishName: body.englishName,
        });

        const primaryName = derivePrimaryName(names);
        const displayName = deriveDisplayName(names);

        if (!names.myanmarName && !names.englishName) {
            throw new PlaceValidationError("myanmarName or englishName is required");
        }

        const hasCategory = await this.placesRepo.hasCategory(categoryId);

        if (!hasCategory) {
            throw new PlaceValidationError("category_id is invalid");
        }

        const adminAreaId = body.adminAreaId ?? null;

        if (adminAreaId !== null) {
            const hasAdminArea = await this.placesRepo.hasActiveAdminArea(adminAreaId);

            if (!hasAdminArea) {
                throw new PlaceValidationError("admin_area_id is invalid");
            }
        }

        let resolvedSourceTypeId = body.sourceTypeId ?? undefined;

        if (resolvedSourceTypeId === null || resolvedSourceTypeId === undefined) {
            resolvedSourceTypeId = (await this.placesRepo.getSourceTypeIdByCode("manual")) ?? undefined;
        }

        if (!resolvedSourceTypeId) {
            throw new PlaceValidationError("manual source_type_id was not found");
        }

        const hasSourceType = await this.placesRepo.hasSourceType(resolvedSourceTypeId);

        if (!hasSourceType) {
            throw new PlaceValidationError("source_type_id is invalid");
        }

        let publishStatusId = body.publishStatusId ?? null;

        if (publishStatusId === undefined || publishStatusId === null) {
            publishStatusId =
                (await this.placesRepo.getPublishStatusIdByCode("published")) ??
                (await this.placesRepo.getPublishStatusIdByCode("draft")) ??
                null;
        }

        if (publishStatusId !== null) {
            const hasPublishStatus = await this.placesRepo.hasPublishStatus(publishStatusId);

            if (!hasPublishStatus) {
                throw new PlaceValidationError("publish_status_id is invalid");
            }
        }

        const createdPlace = await this.placesRepo.createPlace({
            myanmarName: names.myanmarName,
            englishName: names.englishName,
            primary_name: primaryName,
            display_name: displayName,
            category_id: categoryId,
            admin_area_id: adminAreaId,
            lat: body.lat,
            lng: body.lng,
            plus_code: body.plusCode ?? null,
            importance_score: body.importanceScore ?? 0,
            popularity_score: body.popularityScore ?? 0,
            confidence_score: body.confidenceScore ?? 50,
            is_public: body.isPublic ?? true,
            is_verified: body.isVerified ?? false,
            source_type_id: resolvedSourceTypeId,
            publish_status_id: publishStatusId,
        });

        if (!createdPlace) {
            throw new PlaceValidationError("Failed to create place");
        }

        return this.serializePlaceDetail(createdPlace);
    }

    async updatePlace(publicId: string, body: UpdatePlaceBody) {
        const patch = mapUpdateBodyToRepo(body);

        if (patch.category_id === null) {
            throw new PlaceValidationError("category_id cannot be null");
        }

        if (patch.source_type_id === null) {
            throw new PlaceValidationError("source_type_id cannot be null");
        }

        if (patch.category_id !== undefined) {
            const hasCategory = await this.placesRepo.hasCategory(patch.category_id);

            if (!hasCategory) {
                throw new PlaceValidationError("category_id is invalid");
            }
        }

        if (patch.admin_area_id !== undefined && patch.admin_area_id !== null) {
            const hasAdminArea = await this.placesRepo.hasActiveAdminArea(patch.admin_area_id);

            if (!hasAdminArea) {
                throw new PlaceValidationError("admin_area_id is invalid");
            }
        }

        if (patch.source_type_id !== undefined) {
            const hasSourceType = await this.placesRepo.hasSourceType(patch.source_type_id);

            if (!hasSourceType) {
                throw new PlaceValidationError("source_type_id is invalid");
            }
        }

        if (patch.publish_status_id !== undefined && patch.publish_status_id !== null) {
            const hasPublishStatus = await this.placesRepo.hasPublishStatus(patch.publish_status_id);

            if (!hasPublishStatus) {
                throw new PlaceValidationError("publish_status_id is invalid");
            }
        }

        try {
            const updatedPlace = await this.placesRepo.updatePlace(publicId, patch);

            if (!updatedPlace) {
                throw new PlaceNotFoundError();
            }

            return this.serializePlaceDetail(updatedPlace);
        } catch (error) {
            if (error instanceof Error && error.message === "PLACE_NAMES_REQUIRED") {
                throw new PlaceValidationError("myanmarName or englishName is required");
            }

            throw error;
        }
    }

    async deletePlace(publicId: string) {
        const deletedPlace = await this.placesRepo.deletePlace(publicId);

        if (!deletedPlace) {
            throw new PlaceNotFoundError();
        }

        return {
            success: true,
            public_id: deletedPlace.public_id,
        };
    }
}

function normalizePlaceNames(input: { myanmarName?: string; englishName?: string }) {
    return {
        myanmarName: normalizeNonEmpty(input.myanmarName),
        englishName: normalizeNonEmpty(input.englishName),
    };
}

function normalizeNonEmpty(value: string | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function mapUpdateBodyToRepo(body: UpdatePlaceBody): UpdatePlaceInput {
    const patch: UpdatePlaceInput = {};

    if (body.myanmarName !== undefined) {
        patch.myanmarName = body.myanmarName;
    }

    if (body.englishName !== undefined) {
        patch.englishName = body.englishName;
    }

    if (body.categoryId !== undefined) {
        patch.category_id = body.categoryId;
    }

    if (body.adminAreaId !== undefined) {
        patch.admin_area_id = body.adminAreaId;
    }

    if (body.lat !== undefined) {
        patch.lat = body.lat;
    }

    if (body.lng !== undefined) {
        patch.lng = body.lng;
    }

    if (body.plusCode !== undefined) {
        patch.plus_code = body.plusCode;
    }

    if (body.importanceScore !== undefined) {
        patch.importance_score = body.importanceScore;
    }

    if (body.popularityScore !== undefined) {
        patch.popularity_score = body.popularityScore;
    }

    if (body.confidenceScore !== undefined) {
        patch.confidence_score = body.confidenceScore;
    }

    if (body.isPublic !== undefined) {
        patch.is_public = body.isPublic;
    }

    if (body.isVerified !== undefined) {
        patch.is_verified = body.isVerified;
    }

    if (body.sourceTypeId !== undefined) {
        patch.source_type_id = body.sourceTypeId;
    }

    if (body.publishStatusId !== undefined) {
        patch.publish_status_id = body.publishStatusId;
    }

    return patch;
}
