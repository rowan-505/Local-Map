import { StreetsRepository, deriveStreetCanonicalName } from "./streets.repo.js";
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
    names: {
        id: string;
        name: string;
        language_code: string | null;
        script_code: string | null;
        name_type: string;
        is_primary: boolean;
    }[];
    myanmarName: string | null;
    englishName: string | null;
};

type CreateStreetInput = UpdateStreetInput & {
    source_type_id?: bigint | null;
    sourceTypeId?: bigint | null;
    geometry: StreetGeometry;
    is_active?: boolean;
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

    private serializeStreet(street: Awaited<ReturnType<StreetsRepository["getStreetByPublicId"]>>) {
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
            names: street.names,
            myanmarName: street.myanmar_name,
            englishName: street.english_name,
        };
    }

    async listStreets(limit: number): Promise<StreetResponse[]> {
        const streets = await this.streetsRepo.listStreets({ limit });
        return streets.map((street) => this.serializeStreet(street));
    }

    async getStreetByPublicId(publicId: string): Promise<StreetResponse> {
        const street = await this.streetsRepo.getStreetByPublicId(publicId);

        if (!street) {
            throw new StreetNotFoundError();
        }

        return this.serializeStreet(street);
    }

    async createStreet(input: CreateStreetInput): Promise<StreetResponse> {
        const adminAreaId = input.admin_area_id ?? input.adminAreaId;
        const sourceTypeId =
            input.source_type_id ??
            input.sourceTypeId ??
            (await this.streetsRepo.getSourceTypeIdByCode("manual"));
        const names = normalizeStreetNames(input);

        if (adminAreaId !== undefined && adminAreaId !== null) {
            const hasAdminArea = await this.streetsRepo.hasActiveAdminArea(adminAreaId);

            if (!hasAdminArea) {
                throw new StreetValidationError("admin_area_id is invalid");
            }
        }

        if (!sourceTypeId) {
            throw new StreetValidationError("manual source_type_id was not found");
        }

        const hasSourceType = await this.streetsRepo.hasSourceType(sourceTypeId);

        if (!hasSourceType) {
            throw new StreetValidationError("source_type_id is invalid");
        }

        const street = await this.streetsRepo.createStreet({
            ...input,
            myanmarName: names.myanmarName,
            englishName: names.englishName,
            canonical_name: deriveStreetCanonicalName(names),
            admin_area_id: adminAreaId,
            source_type_id: sourceTypeId,
        });

        return this.serializeStreet(street);
    }

    async updateStreet(publicId: string, input: UpdateStreetInput): Promise<StreetResponse> {
        const { updated_at: _ignoredUpdatedAt, ...safeInput } = input as UpdateStreetInput & {
            updated_at?: unknown;
        };

        const normalizedInput = {
            ...safeInput,
            admin_area_id: safeInput.admin_area_id ?? safeInput.adminAreaId,
        };

        if (normalizedInput.admin_area_id !== undefined && normalizedInput.admin_area_id !== null) {
            const hasAdminArea = await this.streetsRepo.hasActiveAdminArea(normalizedInput.admin_area_id);

            if (!hasAdminArea) {
                throw new StreetValidationError("admin_area_id is invalid");
            }
        }

        const street = await this.streetsRepo.updateStreet(publicId, normalizedInput);

        if (!street) {
            throw new StreetNotFoundError();
        }

        return this.serializeStreet(street);
    }
}

function normalizeStreetNames(input: {
    myanmarName?: string;
    englishName?: string;
    canonical_name?: string;
}) {
    return {
        myanmarName: normalizeNonEmpty(input.myanmarName),
        englishName: normalizeNonEmpty(input.englishName ?? input.canonical_name),
    };
}

function normalizeNonEmpty(value: string | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
