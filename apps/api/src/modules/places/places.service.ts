import { PlacesRepository, type PlaceDetailRow, type PlaceRow } from "./places.repo.js";
import type { UpdatePlaceInput } from "./places.repo.js";

type ListPlacesInput = {
    limit: number;
    offset: number;
    q?: string;
    is_public?: boolean;
    is_verified?: boolean;
};

type CreatePlaceInput = UpdatePlaceInput & {
    lat: number;
    lng: number;
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
            display_name: place.display_name,
            category_id: place.category_id.toString(),
            category_name: place.category_name,
            admin_area_id: place.admin_area_id?.toString() ?? null,
            admin_area_name: place.admin_area_name,
            lat: place.lat,
            lng: place.lng,
            is_public: place.is_public,
            is_verified: place.is_verified,
            names: place.names,
            myanmarName: place.myanmar_name,
            englishName: place.english_name,
        };
    }

    private serializePlaceDetail(place: PlaceDetailRow) {
        return {
            ...this.serializePlace(place),
            plus_code: place.plus_code,
            importance_score: place.importance_score,
            popularity_score: place.popularity_score,
            confidence_score: place.confidence_score,
            is_public: place.is_public,
            is_verified: place.is_verified,
            source_type_id: place.source_type_id.toString(),
            publish_status_id: place.publish_status_id?.toString() ?? null,
            current_version_id: place.current_version_id?.toString() ?? null,
            deleted_at: place.deleted_at,
        };
    }

    async listPlaces(input: ListPlacesInput) {
        const places = await this.placesRepo.listPlaces({
            limit: input.limit,
            offset: input.offset,
            q: input.q,
            is_public: input.is_public,
            is_verified: input.is_verified,
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

    async createPlace(input: CreatePlaceInput) {
        const { updated_at: _ignoredUpdatedAt, ...safeInput } = input as CreatePlaceInput & {
            updated_at?: unknown;
        };

        const categoryId = safeInput.category_id ?? safeInput.categoryId;
        const adminAreaId = safeInput.admin_area_id ?? safeInput.adminAreaId;
        const isPublic = safeInput.is_public ?? safeInput.isPublic ?? true;
        const isVerified = safeInput.is_verified ?? safeInput.isVerified ?? false;
        const names = normalizePlaceNames(safeInput);
        const primaryName = names.englishName || names.myanmarName || "Unnamed Place";
        const displayName = deriveDisplayNameForService(names) ?? "Unnamed Place";

        if (!categoryId) {
            throw new PlaceValidationError("category_id is invalid");
        }

        const hasCategory = await this.placesRepo.hasCategory(categoryId);

        if (!hasCategory) {
            throw new PlaceValidationError("category_id is invalid");
        }

        if (adminAreaId !== undefined && adminAreaId !== null) {
            const hasAdminArea = await this.placesRepo.hasActiveAdminArea(adminAreaId);

            if (!hasAdminArea) {
                throw new PlaceValidationError("admin_area_id is invalid");
            }
        }

        let resolvedSourceTypeId = safeInput.source_type_id ?? undefined;

        if (resolvedSourceTypeId === null || resolvedSourceTypeId === undefined) {
            resolvedSourceTypeId = await this.placesRepo.getSourceTypeIdByCode("manual") ?? undefined;
        }

        if (!resolvedSourceTypeId) {
            throw new PlaceValidationError("manual source_type_id was not found");
        }

        const hasSourceType = await this.placesRepo.hasSourceType(resolvedSourceTypeId);

        if (!hasSourceType) {
            throw new PlaceValidationError("source_type_id is invalid");
        }

        if (safeInput.publish_status_id !== undefined && safeInput.publish_status_id !== null) {
            const hasPublishStatus = await this.placesRepo.hasPublishStatus(safeInput.publish_status_id);

            if (!hasPublishStatus) {
                throw new PlaceValidationError("publish_status_id is invalid");
            }
        }

        const createdPlace = await this.placesRepo.createPlace({
            ...safeInput,
            myanmarName: names.myanmarName,
            englishName: names.englishName,
            primary_name: primaryName,
            display_name: displayName,
            category_id: categoryId,
            admin_area_id: adminAreaId,
            is_public: isPublic,
            is_verified: isVerified,
            source_type_id: resolvedSourceTypeId,
        });

        if (!createdPlace) {
            throw new PlaceValidationError("Failed to create place");
        }

        return this.serializePlaceDetail(createdPlace);
    }

    async updatePlace(publicId: string, input: UpdatePlaceInput) {
        const { updated_at: _ignoredUpdatedAt, ...safeInput } = input as UpdatePlaceInput & {
            updated_at?: unknown;
        };

        const normalizedInput = {
            ...safeInput,
            category_id: safeInput.category_id ?? safeInput.categoryId,
            admin_area_id: safeInput.admin_area_id ?? safeInput.adminAreaId,
            is_public: safeInput.is_public ?? safeInput.isPublic,
            is_verified: safeInput.is_verified ?? safeInput.isVerified,
        };

        if (normalizedInput.category_id === null) {
            throw new PlaceValidationError("category_id cannot be null");
        }

        if (normalizedInput.source_type_id === null) {
            throw new PlaceValidationError("source_type_id cannot be null");
        }

        const updatedPlace = await this.placesRepo.updatePlace(publicId, normalizedInput);

        if (!updatedPlace) {
            throw new PlaceNotFoundError();
        }

        return this.serializePlaceDetail(updatedPlace);
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

function normalizePlaceNames(input: {
    myanmarName?: string;
    englishName?: string;
    primary_name?: string;
    isPublic?: boolean;
    isVerified?: boolean;
}) {
    return {
        myanmarName: normalizeNonEmpty(input.myanmarName),
        englishName: normalizeNonEmpty(input.englishName ?? input.primary_name),
    };
}

function normalizeNonEmpty(value: string | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function deriveDisplayNameForService(names: { myanmarName?: string; englishName?: string }) {
    if (names.myanmarName && names.englishName) {
        return `${names.myanmarName} · ${names.englishName}`;
    }

    return names.myanmarName || names.englishName;
}
