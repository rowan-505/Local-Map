import { StreetsRepository } from "./streets.repo.js";
import type { UpdateStreetInput } from "./streets.repo.js";

type StreetGeometry =
    | {
          type: "LineString";
          coordinates: number[][];
      }
    | {
          type: "MultiLineString";
          coordinates: number[][][];
      }
    | null;

type StreetResponse = {
    public_id: string;
    canonical_name: string;
    admin_area_id: string | null;
    admin_area_name: string | null;
    source_type_id?: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    geometry: StreetGeometry;
};

export class StreetNotFoundError extends Error {
    constructor(message = "Street not found") {
        super(message);
        this.name = "StreetNotFoundError";
    }
}

export class StreetValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StreetValidationError";
    }
}

export class StreetsService {
    constructor(private readonly streetsRepo: StreetsRepository) {}

    async listStreets(limit: number): Promise<StreetResponse[]> {
        const streets = await this.streetsRepo.listStreets({ limit });
        return streets.map((street) => ({
            public_id: street.public_id,
            canonical_name: street.canonical_name,
            admin_area_id: street.admin_area_id,
            admin_area_name: street.admin_area_name,
            is_active: street.is_active,
            created_at: street.created_at,
            updated_at: street.updated_at,
            geometry: street.geometry as StreetGeometry,
        }));
    }

    async getStreetByPublicId(publicId: string): Promise<StreetResponse> {
        const street = await this.streetsRepo.getStreetByPublicId(publicId);

        if (!street) {
            throw new StreetNotFoundError();
        }

        return {
            public_id: street.public_id,
            canonical_name: street.canonical_name,
            admin_area_id: street.admin_area_id,
            admin_area_name: street.admin_area_name,
            source_type_id: street.source_type_id,
            is_active: street.is_active,
            created_at: street.created_at,
            updated_at: street.updated_at,
            geometry: street.geometry as StreetGeometry,
        };
    }

    async updateStreet(publicId: string, input: UpdateStreetInput): Promise<StreetResponse> {
        const { updated_at: _ignoredUpdatedAt, ...safeInput } = input as UpdateStreetInput & {
            updated_at?: unknown;
        };

        if (safeInput.admin_area_id !== undefined && safeInput.admin_area_id !== null) {
            const hasAdminArea = await this.streetsRepo.hasActiveAdminArea(safeInput.admin_area_id);

            if (!hasAdminArea) {
                throw new StreetValidationError("admin_area_id is invalid");
            }
        }

        const street = await this.streetsRepo.updateStreet(publicId, safeInput);

        if (!street) {
            throw new StreetNotFoundError();
        }

        return {
            public_id: street.public_id,
            canonical_name: street.canonical_name,
            admin_area_id: street.admin_area_id,
            admin_area_name: street.admin_area_name,
            source_type_id: street.source_type_id,
            is_active: street.is_active,
            created_at: street.created_at,
            updated_at: street.updated_at,
            geometry: street.geometry as StreetGeometry,
        };
    }
}
