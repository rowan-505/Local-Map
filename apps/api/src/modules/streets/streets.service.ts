import type { JwtUser } from "../../plugins/auth.js";
import {
    deriveStreetCanonicalName,
    StreetCrudValidationError,
    StreetsRepository,
    type NearestStreetPointRow,
    type StreetGeometryCrossingRow,
    type StreetGeometryDuplicateRow,
    type StreetMutationContext,
    type UpdateStreetInput,
} from "./streets.repo.js";
import type {
    CreateStreetBody,
    NearestStreetPointQuery,
    SplitStreetBody,
    StreetIdentifierRef,
    StreetsListQuery,
    UpdateStreetBody,
    ValidateStreetGeometryBody,
    ValidateStreetGeometryExcludeRef,
} from "./streets.schema.js";

export type NearestStreetPointResponse = {
    /** Public UUID identifying the snapped street (`core.core_streets.public_id`). */
    street_id: string;
    nearest: { lng: number; lat: number };
    distance_m: number;
    street_name: string | null;
    road_class: string | null;
} | null;

export type StreetGeometryConnectionResponse = {
    streetId: string;
    nearest: { lng: number; lat: number };
    distanceM: number;
    streetName: string | null;
    roadClass: string | null;
} | null;

export type StreetGeometryCrossingHit = {
    streetId: string;
    streetName: string | null;
    roadClass: string | null;
};

export type StreetGeometryDuplicateHit = StreetGeometryCrossingHit & {
    kind: "overlap" | "near_duplicate";
};

export type ValidateStreetGeometryResponse = {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    startConnection: StreetGeometryConnectionResponse;
    endConnection: StreetGeometryConnectionResponse;
    crossings: StreetGeometryCrossingHit[];
    duplicates: StreetGeometryDuplicateHit[];
};

export type StreetLineStringGeometry = {
    type: "LineString";
    coordinates: number[][];
};

export type SplitStreetResponse = {
    originalStreetId: string;
    newStreets: StreetResponse[];
    /** @deprecated Kept for older dashboard clients. */
    streets: StreetResponse[];
};

type StreetResponse = {
    public_id: string;
    canonical_name: string;
    admin_area_id: string | null;
    admin_area_name: string | null;
    source_type_id?: string;
    road_class_id: string | null;
    road_class: string | null;
    road_class_name: string | null;
    surface: string | null;
    is_oneway: boolean;
    bridge: boolean;
    tunnel: boolean;
    manual_override: boolean;
    edit_status: string;
    routing_status: string;
    deleted_at: Date | string | null;
    last_edited_at: Date | string | null;
    is_active: boolean;
    created_at: Date | string;
    updated_at: Date | string;
    geometry: StreetLineStringGeometry | null;
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

function tryParseEditorBigint(user: JwtUser): bigint | undefined {
    const raw = user.id?.trim();
    if (raw && /^\d+$/.test(raw)) {
        return BigInt(raw);
    }
    return undefined;
}

function mutationContext(user: JwtUser, editReason?: string): StreetMutationContext {
    return {
        editorId: tryParseEditorBigint(user),
        editReason: editReason?.trim(),
    };
}

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
            road_class_id: street.road_class_id,
            road_class: street.road_class,
            road_class_name: street.road_class_name,
            surface: street.surface,
            is_oneway: street.is_oneway,
            bridge: street.bridge,
            tunnel: street.tunnel,
            manual_override: street.manual_override,
            edit_status: street.edit_status,
            routing_status: street.routing_status,
            deleted_at: street.deleted_at,
            last_edited_at: street.last_edited_at,
            is_active: street.is_active,
            created_at: street.created_at,
            updated_at: street.updated_at,
            geometry: street.geometry as StreetLineStringGeometry | null,
            names: street.names,
            myanmarName: street.myanmar_name,
            englishName: street.english_name,
        };
    }

    async listStreets(query: StreetsListQuery): Promise<StreetResponse[]> {
        const streets = await this.streetsRepo.listStreets({
            limit: query.limit,
            q: query.q,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
            include_deleted: query.include_deleted,
        });

        return streets.map((street) => this.serializeStreet(street));
    }

    async getStreetByPublicId(publicId: string): Promise<StreetResponse> {
        const street = await this.streetsRepo.getStreetByPublicId(publicId);

        if (!street) {
            throw new StreetNotFoundError();
        }

        return this.serializeStreet(street);
    }

    async listRoadClasses(): Promise<{ id: string; code: string; name: string; rank: number }[]> {
        return this.streetsRepo.listPublicRoadClasses();
    }

    /** Read-only nearest point on street centerlines (dashboard snapping; does not touch routing). */
    async getNearestStreetPoint(query: NearestStreetPointQuery): Promise<NearestStreetPointResponse> {
        const row = await this.streetsRepo.findNearestStreetPoint({
            lat: query.lat,
            lng: query.lng,
            radiusMeters: query.radiusMeters,
            excludePublicId: query.excludePublicId,
        });

        if (!row) {
            return null;
        }

        return {
            street_id: row.street_id,
            nearest: {
                lng: Number(row.nearest_lng),
                lat: Number(row.nearest_lat),
            },
            distance_m: Number(row.distance_m),
            street_name: row.street_name,
            road_class: row.road_class,
        };
    }

    /**
     * Dashboard-only geometry checks (connectivity, crosses/overlap, near-duplicates).
     * `isValid` is false only when geometry fails basic rules; topology issues are warnings and detail arrays.
     */
    async validateStreetGeometry(body: ValidateStreetGeometryBody): Promise<ValidateStreetGeometryResponse> {
        const baseline: ValidateStreetGeometryResponse = {
            isValid: false,
            errors: [],
            warnings: [],
            startConnection: null,
            endConnection: null,
            crossings: [],
            duplicates: [],
        };

        const validity = await this.streetsRepo.getStreetCenterlineValidity(body.geometry);

        if (!validity.ok) {
            const code = validity.reason ?? "invalid_geometry";
            const messageByCode: Record<string, string> = {
                invalid_geometry: "Geometry could not be parsed as a GeoJSON LineString",
                geometry_not_valid: "Geometry is not valid",
                geometry_must_be_linestring: "Geometry must be a LineString",
                geometry_srid_must_be_4326: "Geometry SRID must be 4326 (WGS 84)",
                geometry_length_must_exceed_2_meters: "Centerline length must be greater than 2 meters",
            };

            return {
                ...baseline,
                errors: [messageByCode[code] ?? "Invalid geometry"],
            };
        }

        const coords = body.geometry.coordinates;
        const start = coords[0];
        const end = coords[coords.length - 1];
        const { excludePublicId, excludeInternalId } = this.resolveValidateExcludeRef(body.excludeStreetRef);

        const toleranceMeters = body.toleranceMeters;

        let startRow: NearestStreetPointRow | null;
        let endRow: NearestStreetPointRow | null;
        let crossingRows: StreetGeometryCrossingRow[];
        let duplicateRows: StreetGeometryDuplicateRow[];

        try {
            [startRow, endRow, crossingRows, duplicateRows] = await Promise.all([
                this.streetsRepo.findNearestStreetPoint({
                    lat: start[1],
                    lng: start[0],
                    radiusMeters: toleranceMeters,
                    excludePublicId,
                    excludeInternalStreetId: excludeInternalId,
                }),
                this.streetsRepo.findNearestStreetPoint({
                    lat: end[1],
                    lng: end[0],
                    radiusMeters: toleranceMeters,
                    excludePublicId,
                    excludeInternalStreetId: excludeInternalId,
                }),
                this.streetsRepo.listStreetGeometryCrossings({
                    geometry: body.geometry,
                    excludePublicId,
                    excludeInternalId,
                }),
                this.streetsRepo.listStreetGeometryOverlapDuplicates({
                    geometry: body.geometry,
                    excludePublicId,
                    excludeInternalId,
                }),
            ]);
        } catch {
            return {
                ...baseline,
                isValid: false,
                errors: ["Topology checks could not be completed. Please try again."],
            };
        }

        const warnings: string[] = [];

        if (!startRow) {
            warnings.push("Start point is disconnected from nearby streets.");
        }

        if (!endRow) {
            warnings.push("End point is disconnected from nearby streets.");
        }

        const crossings = crossingRows.map(
            (r): StreetGeometryCrossingHit => ({
                streetId: r.street_id,
                streetName: r.street_name,
                roadClass: r.road_class,
            }),
        );

        if (crossings.length === 1) {
            warnings.push("Street crosses another street. Consider splitting.");
        }

        if (crossings.length > 1) {
            warnings.push(
                `Street crosses another street. Consider splitting. (${crossings.length} crossings.)`,
            );
        }

        const duplicates = duplicateRows.map(
            (r): StreetGeometryDuplicateHit => ({
                streetId: r.street_id,
                streetName: r.street_name,
                roadClass: r.road_class,
                kind: r.kind === "overlap" ? "overlap" : "near_duplicate",
            }),
        );

        if (duplicates.length > 0) {
            warnings.push("Similar road already exists nearby.");
        }

        return {
            isValid: true,
            errors: [],
            warnings,
            startConnection: this.serializeValidateGeometryConnection(startRow),
            endConnection: this.serializeValidateGeometryConnection(endRow),
            crossings,
            duplicates,
        };
    }

    private resolveValidateExcludeRef(ref: ValidateStreetGeometryExcludeRef | undefined): {
        excludePublicId?: string;
        excludeInternalId?: bigint;
    } {
        if (!ref) {
            return {};
        }

        return "internalId" in ref
            ? { excludeInternalId: ref.internalId }
            : { excludePublicId: ref.publicId };
    }

    private serializeValidateGeometryConnection(row: NearestStreetPointRow | null): StreetGeometryConnectionResponse {
        if (!row) {
            return null;
        }

        return {
            streetId: row.street_id,
            nearest: {
                lng: Number(row.nearest_lng),
                lat: Number(row.nearest_lat),
            },
            distanceM: Number(row.distance_m),
            streetName: row.street_name,
            roadClass: row.road_class,
        };
    }

    async createStreet(body: CreateStreetBody, _user: JwtUser): Promise<StreetResponse> {
        if (!body.geometry) {
            throw new StreetValidationError("geometry is required");
        }
        if (body.geometry.type !== "LineString") {
            throw new StreetValidationError("geometry must be a GeoJSON LineString in WGS 84 (EPSG:4326)");
        }

        const adminAreaId = body.admin_area_id ?? body.adminAreaId;
        const sourceTypeId =
            body.source_type_id ?? body.sourceTypeId ?? (await this.streetsRepo.getSourceTypeIdByCode("manual"));
        const names = normalizeStreetNames(body);

        if (adminAreaId !== undefined && adminAreaId !== null) {
            const hasAdminArea = await this.streetsRepo.hasActiveAdminArea(adminAreaId);

            if (!hasAdminArea) {
                throw new StreetValidationError("admin_area_id is invalid or inactive");
            }
        }

        if (!sourceTypeId) {
            throw new StreetValidationError("manual source_type_id was not found");
        }

        const hasSourceType = await this.streetsRepo.hasSourceType(sourceTypeId);

        if (!hasSourceType) {
            throw new StreetValidationError("source_type_id is invalid");
        }

        const hasRoadClass = await this.streetsRepo.hasRoadClass(body.road_class_id);

        if (!hasRoadClass) {
            throw new StreetValidationError("road_class_id not found");
        }

        try {
            await this.streetsRepo.assertValidCenterline(body.geometry);

            const street = await this.streetsRepo.createStreet({
                myanmarName: names.myanmarName,
                englishName: names.englishName,
                canonical_name: deriveStreetCanonicalName(names),
                admin_area_id: adminAreaId,
                source_type_id: sourceTypeId,
                road_class_id: body.road_class_id,
                is_oneway: body.is_oneway,
                surface: body.surface ?? null,
                bridge: body.bridge,
                tunnel: body.tunnel,
                geometry: body.geometry,
                is_active: body.is_active,
            });

            if (!street) {
                throw new StreetValidationError("Street could not be created");
            }

            return this.serializeStreet(street);
        } catch (error) {
            if (error instanceof StreetCrudValidationError) {
                throw new StreetValidationError(error.message);
            }
            throw error;
        }
    }

    async updateStreet(publicId: string, body: UpdateStreetBody, user: JwtUser): Promise<StreetResponse> {
        const adminAreaId = body.admin_area_id ?? body.adminAreaId;
        const roadClassId = body.road_class_id ?? body.roadClassId;
        const isOneway = body.is_oneway ?? body.isOneway;

        if (adminAreaId !== undefined && adminAreaId !== null) {
            const hasAdminArea = await this.streetsRepo.hasActiveAdminArea(adminAreaId);

            if (!hasAdminArea) {
                throw new StreetValidationError("admin_area_id is invalid or inactive");
            }
        }

        const input: UpdateStreetInput = {
            myanmarName: body.myanmarName,
            englishName: body.englishName,
            geometry: body.geometry,
            road_class_id: roadClassId,
            is_oneway: isOneway,
            surface: body.surface,
            admin_area_id: adminAreaId,
            bridge: body.bridge,
            tunnel: body.tunnel,
        };

        try {
            const street = await this.streetsRepo.updateStreet(publicId, input, mutationContext(user, body.edit_reason));

            if (!street) {
                throw new StreetNotFoundError();
            }

            return this.serializeStreet(street);
        } catch (error) {
            if (error instanceof StreetCrudValidationError) {
                throw new StreetValidationError(error.message);
            }
            throw error;
        }
    }

    async softDeleteStreet(publicId: string, user: JwtUser, editReason?: string): Promise<StreetResponse> {
        try {
            const street = await this.streetsRepo.softDeleteStreet(publicId, mutationContext(user, editReason));

            if (!street) {
                throw new StreetNotFoundError();
            }

            return this.serializeStreet(street);
        } catch (error) {
            if (error instanceof StreetCrudValidationError) {
                throw new StreetValidationError(error.message);
            }
            throw error;
        }
    }

    /** Split street at the closest projection of `point` onto stored LineString; returns two successor records. */
    async splitStreet(streetId: StreetIdentifierRef, body: SplitStreetBody, user: JwtUser): Promise<SplitStreetResponse> {
        try {
            const result = await this.streetsRepo.splitStreetAtPoint(
                streetId,
                body.point.lng,
                body.point.lat,
                mutationContext(user, body.editReason),
            );

            if (!result) {
                throw new StreetNotFoundError();
            }

            const streets = [
                this.serializeStreet(result.newStreets[0]),
                this.serializeStreet(result.newStreets[1]),
            ];

            return {
                originalStreetId: result.originalStreetId,
                newStreets: streets,
                streets,
            };
        } catch (error) {
            if (error instanceof StreetCrudValidationError) {
                throw new StreetValidationError(error.message);
            }
            throw error;
        }
    }
}

function normalizeStreetNames(input: { myanmarName?: string; englishName?: string }) {
    return {
        myanmarName: normalizeNonEmpty(input.myanmarName),
        englishName: normalizeNonEmpty(input.englishName),
    };
}

function normalizeNonEmpty(value: string | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
