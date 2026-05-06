import type { LinkedBuildingSummaryRow, LinkedPlaceSummaryRow } from "./place-buildings.repo.js";
import { PlaceBuildingsRepository } from "./place-buildings.repo.js";
import type { LinkPlaceBuildingBody, PatchPlaceBuildingBody } from "./place-buildings.schema.js";

export class PlaceBuildingLinkNotFoundError extends Error {
    constructor(message = "Place–building link not found") {
        super(message);
        this.name = "PlaceBuildingLinkNotFoundError";
    }
}

export class PlaceBuildingDuplicateLinkError extends Error {
    constructor(message = "Building is already linked to this place") {
        super(message);
        this.name = "PlaceBuildingDuplicateLinkError";
    }
}

export class PlaceBuildingInactiveBuildingError extends Error {
    constructor(message = "Building not found or inactive") {
        super(message);
        this.name = "PlaceBuildingInactiveBuildingError";
    }
}

export class PlaceBuildingPlaceNotFoundError extends Error {
    constructor(message = "Place not found") {
        super(message);
        this.name = "PlaceBuildingPlaceNotFoundError";
    }
}

export class PlaceBuildingsService {
    constructor(private readonly repo: PlaceBuildingsRepository) {}

    private serializeBuildingLink(row: LinkedBuildingSummaryRow) {
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
            relation_type: row.relation_type,
            is_primary: row.is_primary,
            created_at: row.created_at.toISOString(),
            building: {
                public_id: row.building_public_id,
                name: row.building_name,
                building_type_id: row.building_type_id,
                building_type: buildingType,
                building_type_code: row.building_type_code,
                building_type_name: row.building_type_name,
                building_type_name_mm: row.building_type_name_mm,
                class_code: row.class_code,
                area_m2: row.building_area_m2,
                admin_area:
                    row.building_admin_area_row_id !== null &&
                    row.building_admin_area_row_id !== undefined
                        ? {
                              id: row.building_admin_area_row_id,
                              canonical_name: row.building_admin_area_canonical_name ?? "",
                              slug: row.building_admin_area_slug ?? "",
                          }
                        : null,
            },
        };
    }

    private serializePlaceLink(row: LinkedPlaceSummaryRow) {
        return {
            relation_type: row.relation_type,
            is_primary: row.is_primary,
            created_at: row.created_at.toISOString(),
            place: {
                public_id: row.place_public_id,
                primary_name: row.place_primary_name,
                display_name: row.place_display_name,
                lat: row.place_lat,
                lng: row.place_lng,
                category_name: row.category_name,
            },
        };
    }

    async listBuildingsForPlace(placePublicId: string) {
        const placeInternalId = await this.repo.resolveActivePlaceInternalId(placePublicId);

        if (!placeInternalId) {
            throw new PlaceBuildingPlaceNotFoundError();
        }

        const rows = await this.repo.listBuildingsForPlace(placePublicId);
        return rows.map((r) => this.serializeBuildingLink(r));
    }

    async listPlacesForBuilding(buildingPublicId: string) {
        const buildingInternalId = await this.repo.resolveActiveBuildingInternalId(buildingPublicId);

        if (!buildingInternalId) {
            throw new PlaceBuildingInactiveBuildingError();
        }

        const rows = await this.repo.listPlacesForBuilding(buildingPublicId);
        return rows.map((r) => this.serializePlaceLink(r));
    }

    async linkBuildingToPlace(placePublicId: string, body: LinkPlaceBuildingBody) {
        const placeInternalId = await this.repo.resolveActivePlaceInternalId(placePublicId);

        if (!placeInternalId) {
            throw new PlaceBuildingPlaceNotFoundError();
        }

        const buildingInternalId = await this.repo.resolveActiveBuildingInternalId(body.building_id);

        if (!buildingInternalId) {
            throw new PlaceBuildingInactiveBuildingError();
        }

        const exists = await this.repo.linkExists(placeInternalId, buildingInternalId);

        if (exists) {
            throw new PlaceBuildingDuplicateLinkError();
        }

        const row = await this.repo.insertLink(
            placeInternalId,
            buildingInternalId,
            body.relation_type,
            body.is_primary
        );

        if (!row) {
            throw new PlaceBuildingDuplicateLinkError();
        }

        return {
            place_id: placePublicId,
            ...this.serializeBuildingLink(row),
        };
    }

    async unlink(placePublicId: string, buildingPublicId: string) {
        const placeInternalId = await this.repo.resolveActivePlaceInternalId(placePublicId);

        if (!placeInternalId) {
            throw new PlaceBuildingPlaceNotFoundError();
        }

        const buildingExists = await this.repo.resolveBuildingInternalIdAny(buildingPublicId);

        if (!buildingExists) {
            throw new PlaceBuildingLinkNotFoundError("Building not found");
        }

        const deleted = await this.repo.deleteLink(placePublicId, buildingPublicId);

        if (!deleted) {
            throw new PlaceBuildingLinkNotFoundError();
        }

        return {
            ok: true,
            place_id: placePublicId,
            building_id: buildingPublicId,
        };
    }

    async patchPlaceBuildingLink(
        placePublicId: string,
        buildingPublicId: string,
        body: PatchPlaceBuildingBody
    ) {
        const placeInternalId = await this.repo.resolveActivePlaceInternalId(placePublicId);

        if (!placeInternalId) {
            throw new PlaceBuildingPlaceNotFoundError();
        }

        const row = await this.repo.patchBuildingLinkForPlace(placePublicId, buildingPublicId, {
            relation_type: body.relation_type,
            is_primary: body.is_primary,
        });

        if (!row) {
            throw new PlaceBuildingLinkNotFoundError();
        }

        return {
            place_id: placePublicId,
            ...this.serializeBuildingLink(row),
        };
    }
}
