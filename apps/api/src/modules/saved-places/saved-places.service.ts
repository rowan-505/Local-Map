import { Prisma } from "@prisma/client";

import { SavedPlacesRepository, type SavedPlaceRow } from "./saved-places.repo.js";
import type { CreateSavedPlaceBody } from "./saved-places.schema.js";

export class SavedPlacesError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "SavedPlacesError";
    }
}

export type SavedPlaceResponse = {
    id: string;
    entity_type: "place" | "map_point";
    entity_id: string | null;
    display_name: string | null;
    custom_name: string | null;
    category: { code: string; name: string } | null;
    address_line: string | null;
    plus_code: string | null;
    latitude: number | null;
    longitude: number | null;
    admin_area_id: string | null;
    created_at: string;
};

export class SavedPlacesService {
    constructor(private readonly savedPlacesRepo: SavedPlacesRepository) {}

    async list(userPublicId: string): Promise<SavedPlaceResponse[]> {
        const userId = await this.resolveUserId(userPublicId);
        const rows = await this.savedPlacesRepo.listForUser(userId);
        return rows.map(toSavedPlaceResponse);
    }

    async create(
        userPublicId: string,
        body: CreateSavedPlaceBody
    ): Promise<SavedPlaceResponse> {
        const userId = await this.resolveUserId(userPublicId);

        const savedId =
            body.entityType === "place"
                ? await this.createPlace(userId, BigInt(body.entityId))
                : await this.createMapPoint(userId, body);

        const item = await this.savedPlacesRepo.findSavedItem(userId, savedId);
        if (!item) {
            // Should not happen (just inserted); surface as a server error if it does.
            throw new SavedPlacesError("Saved item could not be loaded", 500);
        }

        return toSavedPlaceResponse(item);
    }

    private async createPlace(userId: bigint, placeId: bigint): Promise<bigint> {
        const place = await this.savedPlacesRepo.findSaveablePlace(placeId);
        if (!place) {
            throw new SavedPlacesError("Place not found or not saveable", 404);
        }

        try {
            return await this.savedPlacesRepo.insertSavedPlace({
                userId,
                placeId: place.id,
                adminAreaId: place.admin_area_id,
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new SavedPlacesError("Place is already saved", 409);
            }
            throw error;
        }
    }

    private async createMapPoint(
        userId: bigint,
        body: Extract<CreateSavedPlaceBody, { entityType: "map_point" }>
    ): Promise<bigint> {
        // Zod already range-checks lat/lng; this is a defensive guard.
        if (
            body.latitude < -90 ||
            body.latitude > 90 ||
            body.longitude < -180 ||
            body.longitude > 180
        ) {
            throw new SavedPlacesError("Invalid coordinates", 400);
        }

        return this.savedPlacesRepo.insertSavedMapPoint({
            userId,
            customName: body.customName?.trim() || null,
            latitude: body.latitude,
            longitude: body.longitude,
            addressLine: body.addressLine?.trim() || null,
            plusCode: body.plusCode?.trim() || null,
            adminAreaId: body.adminAreaId !== undefined ? BigInt(body.adminAreaId) : null,
        });
    }

    async delete(userPublicId: string, savedId: bigint): Promise<void> {
        const userId = await this.resolveUserId(userPublicId);
        const removed = await this.savedPlacesRepo.deleteOwnedSavedPlace(userId, savedId);

        if (removed === 0) {
            throw new SavedPlacesError("Saved place not found", 404);
        }
    }

    private async resolveUserId(userPublicId: string): Promise<bigint> {
        const userId = await this.savedPlacesRepo.findUserIdByPublicId(userPublicId);

        if (userId === null) {
            throw new SavedPlacesError("User not found", 401);
        }

        return userId;
    }
}

function toSavedPlaceResponse(row: SavedPlaceRow): SavedPlaceResponse {
    return {
        id: row.saved_id.toString(),
        entity_type: row.entity_type === "map_point" ? "map_point" : "place",
        entity_id: row.entity_id !== null ? row.entity_id.toString() : null,
        display_name: row.display_name,
        custom_name: row.custom_name,
        category:
            row.category_code && row.category_name
                ? { code: row.category_code, name: row.category_name }
                : null,
        address_line: row.address_line,
        plus_code: row.plus_code,
        latitude: row.latitude !== null ? Number(row.latitude) : null,
        longitude: row.longitude !== null ? Number(row.longitude) : null,
        admin_area_id: row.admin_area_id !== null ? row.admin_area_id.toString() : null,
        created_at: row.created_at.toISOString(),
    };
}
