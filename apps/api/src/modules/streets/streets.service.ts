import type { JwtUser } from "../../plugins/auth.js";
import {
    EntityAdminAreaService,
    EntityAdminAreaValidationError,
} from "../entity-admin-area/entity-admin-area.service.js";
import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import {
    effectiveVerificationStatusFromRow,
    isVerifiedFromVerificationStatus,
    pickCoreReviewVerificationWrite,
    resolveCoreReviewVerificationWrite,
} from "../core-review/core-review-verification-write.js";
import {
    deriveStreetCanonicalName,
    StreetCrudValidationError,
    StreetsRepository,
    type NearestStreetPointRow,
    type StreetGeometryCrossingRow,
    type StreetGeometryDuplicateRow,
    type StreetGeometryJson,
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
    StreetsNearbyQuery,
    ValidateStreetGeometryBody,
    ValidateStreetGeometryExcludeRef,
} from "./streets.schema.js";
import {
    legacyIsOnewayFromTravelDirection,
    normalizeStreetTravelDirection,
    resolveStreetTravelDirectionWrite,
    type StreetTravelDirection,
} from "./streets-direction.js";
import {
    assertRoadTownshipAdminArea,
    StreetAdminAreaValidationError,
} from "./street-admin-area.js";
import { refreshStreetGroupSearchForStreet } from "../search/unified-search-sync.js";
import { UnifiedSearchSyncRepository } from "../search/unified-search-sync.repo.js";

type StreetsServiceOptions = {
    prisma?: import("@prisma/client").PrismaClient;
};

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

const STREET_TOPOLOGY_CHECK_TIMEOUT_MS = 3000;
const STREET_TOPOLOGY_SEARCH_RADIUS_METERS = 200;
const STREET_TOPOLOGY_TIMEOUT_WARNING = "Topology checks could not be completed";

type ValidateStreetGeometryLogContext = {
    requestId?: string;
    log?: {
        info: (obj: Record<string, unknown>, msg?: string) => void;
        warn: (obj: Record<string, unknown>, msg?: string) => void;
    };
};

class StreetTopologyCheckTimeoutError extends Error {
    constructor() {
        super("street_topology_check_timeout");
        this.name = "StreetTopologyCheckTimeoutError";
    }
}

function withStreetTopologyTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new StreetTopologyCheckTimeoutError());
        }, timeoutMs);

        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error: unknown) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

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
    travel_direction: StreetTravelDirection;
    is_oneway: boolean;
    bridge: boolean;
    tunnel: boolean;
    manual_override: boolean;
    edit_status: string;
    routing_status: string;
    deleted_at: Date | string | null;
    last_edited_at: Date | string | null;
    is_active: boolean;
    verification_status: string;
    is_verified: boolean;
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

export type StreetNearbyMapResponse = {
    public_id: string;
    canonical_name: string;
    myanmarName: string | null;
    englishName: string | null;
    road_class: string | null;
    is_active: boolean;
    deleted_at: Date | string | null;
    geometry: StreetLineStringGeometry | StreetGeometryJson | null;
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
    readonly code?: string;

    constructor(message: string, code?: string) {
        super(message);
        this.name = "StreetValidationError";
        this.code = code;
    }
}

export class StreetsService {
    constructor(
        private readonly streetsRepo: StreetsRepository,
        private readonly entityAdminArea: EntityAdminAreaService,
        private readonly entityAdminAreaRepo: EntityAdminAreaRepository,
        private readonly options: StreetsServiceOptions = {},
    ) {}

    private scheduleStreetGroupSearchSync(streetPublicId: string): void {
        const prisma = this.options.prisma;
        if (!prisma) {
            return;
        }
        void (async () => {
            const repo = new UnifiedSearchSyncRepository(prisma);
            const streetId = await repo.lookupStreetId(streetPublicId);
            if (streetId) {
                await refreshStreetGroupSearchForStreet(prisma, streetId);
            }
        })();
    }

    private serializeStreet(street: Awaited<ReturnType<StreetsRepository["getStreetByPublicId"]>>) {
        if (!street) {
            throw new StreetNotFoundError();
        }

        const verificationStatus = effectiveVerificationStatusFromRow(street);

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
            travel_direction: street.travel_direction,
            is_oneway: legacyIsOnewayFromTravelDirection(street.travel_direction),
            bridge: street.bridge,
            tunnel: street.tunnel,
            manual_override: street.manual_override,
            edit_status: street.edit_status,
            routing_status: street.routing_status,
            deleted_at: street.deleted_at,
            last_edited_at: street.last_edited_at,
            is_active: street.is_active,
            verification_status: verificationStatus,
            is_verified: isVerifiedFromVerificationStatus(verificationStatus),
            created_at: street.created_at,
            updated_at: street.updated_at,
            geometry: street.geometry as StreetLineStringGeometry | null,
            names: street.names,
            name_mm: street.myanmar_name,
            name_en: street.english_name,
            fallback_name: street.canonical_name,
            myanmarName: street.myanmar_name,
            englishName: street.english_name,
        };
    }

    async listStreets(query: StreetsListQuery): Promise<StreetResponse[]> {
        const streets = await this.streetsRepo.listStreets({
            limit: query.limit,
            offset: query.offset,
            q: query.q,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
            include_deleted: query.include_deleted,
        });

        return streets.map((street) => this.serializeStreet(street));
    }

    /** Viewport-bounded streets for map editor context overlays (no list COUNT or admin joins). */
    async listNearbyStreets(query: StreetsNearbyQuery): Promise<StreetNearbyMapResponse[]> {
        const [minLng, minLat, maxLng, maxLat] = query.bbox;
        const rows = await this.streetsRepo.listStreetsInMapBbox({
            minLng,
            minLat,
            maxLng,
            maxLat,
            limit: query.limit,
        });

        return rows.map((row) => ({
            public_id: row.public_id,
            canonical_name: row.canonical_name,
            myanmarName: row.myanmar_name,
            englishName: row.english_name,
            road_class: row.road_class,
            is_active: row.is_active,
            deleted_at: row.deleted_at,
            geometry: row.geometry as StreetLineStringGeometry | null,
        }));
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
    async validateStreetGeometry(
        body: ValidateStreetGeometryBody,
        context: ValidateStreetGeometryLogContext = {},
    ): Promise<ValidateStreetGeometryResponse> {
        const startedAt = Date.now();
        const vertexCount = body.geometry.coordinates.length;
        const geometryType = body.geometry.type;
        const requestId = context.requestId ?? "unknown";

        context.log?.info(
            {
                requestId,
                geometryType,
                vertexCount,
            },
            "streets.validate-geometry.start",
        );

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
            const blockingCodes = new Set([
                "invalid_geometry",
                "geometry_not_valid",
                "geometry_must_be_linestring",
            ]);
            const messageByCode: Record<string, string> = {
                invalid_geometry: "Geometry could not be parsed as a GeoJSON LineString",
                geometry_not_valid: "Geometry is not valid",
                geometry_must_be_linestring: "Geometry must be a LineString",
                geometry_srid_must_be_4326: "Geometry SRID must be 4326 (WGS 84)",
                geometry_length_must_exceed_2_meters: "Centerline length must be greater than 2 meters",
            };

            const durationMs = Date.now() - startedAt;
            context.log?.info(
                {
                    requestId,
                    geometryType,
                    vertexCount,
                    durationMs,
                    blocking: blockingCodes.has(code),
                    reason: code,
                },
                "streets.validate-geometry.complete",
            );

            if (blockingCodes.has(code)) {
                return {
                    ...baseline,
                    errors: [messageByCode[code] ?? "Invalid geometry"],
                };
            }

            return {
                isValid: true,
                errors: [],
                warnings: [messageByCode[code] ?? "Invalid geometry"],
                startConnection: null,
                endConnection: null,
                crossings: [],
                duplicates: [],
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
            [startRow, endRow, crossingRows, duplicateRows] = await withStreetTopologyTimeout(
                Promise.all([
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
                        searchRadiusMeters: STREET_TOPOLOGY_SEARCH_RADIUS_METERS,
                    }),
                    this.streetsRepo.listStreetGeometryOverlapDuplicates({
                        geometry: body.geometry,
                        excludePublicId,
                        excludeInternalId,
                        searchRadiusMeters: STREET_TOPOLOGY_SEARCH_RADIUS_METERS,
                    }),
                ]),
                STREET_TOPOLOGY_CHECK_TIMEOUT_MS,
            );
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            const timedOut = error instanceof StreetTopologyCheckTimeoutError;

            context.log?.warn(
                {
                    requestId,
                    geometryType,
                    vertexCount,
                    durationMs,
                    timedOut,
                },
                "streets.validate-geometry.topology-incomplete",
            );

            return {
                isValid: true,
                errors: [],
                warnings: [STREET_TOPOLOGY_TIMEOUT_WARNING],
                startConnection: null,
                endConnection: null,
                crossings: [],
                duplicates: [],
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

        const durationMs = Date.now() - startedAt;
        context.log?.info(
            {
                requestId,
                geometryType,
                vertexCount,
                durationMs,
                warningCount: warnings.length,
                crossingCount: crossings.length,
                duplicateCount: duplicates.length,
            },
            "streets.validate-geometry.complete",
        );

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

    private mapStreetAdminAreaError(error: unknown): never {
        if (error instanceof StreetAdminAreaValidationError) {
            throw new StreetValidationError(error.message, error.code);
        }
        if (error instanceof EntityAdminAreaValidationError) {
            throw new StreetValidationError(error.message);
        }
        throw error;
    }

    private async inferStreetTownshipId(
        geometry: StreetLineStringGeometry | undefined,
    ): Promise<bigint | null> {
        if (!geometry) {
            return null;
        }
        const inferred = await this.entityAdminArea.infer({
            kind: "street",
            geometry,
        });
        if (!inferred.admin_area_id) {
            return null;
        }
        return BigInt(inferred.admin_area_id);
    }

    /**
     * Road edit save: preserve existing township when admin_area is omitted; clear legacy
     * non-township assignments to null; accept explicit township only via manual override.
     */
    private async resolveRoadAdminAreaForUpdate(args: {
        existingAdminAreaId: bigint | null;
        geometry: StreetLineStringGeometry | undefined;
        requestedAdmin: bigint | null | undefined;
        requestedAdminInBody: boolean;
        manualOverride: boolean;
        explicitClearAdminArea: boolean;
        user: JwtUser;
    }): Promise<{ admin_area_id: bigint | null | undefined; manual_override?: boolean }> {
        if (!args.requestedAdminInBody) {
            if (args.explicitClearAdminArea) {
                return { admin_area_id: null, manual_override: true };
            }
            if (args.existingAdminAreaId === null) {
                return { admin_area_id: undefined };
            }
            if (await this.entityAdminAreaRepo.isTownshipAdminArea(args.existingAdminAreaId)) {
                return { admin_area_id: undefined };
            }
            return { admin_area_id: null };
        }

        if (args.requestedAdmin === null || args.requestedAdmin === undefined) {
            if (args.explicitClearAdminArea) {
                return { admin_area_id: null, manual_override: true };
            }
            return { admin_area_id: undefined };
        }

        await assertRoadTownshipAdminArea(this.entityAdminAreaRepo, args.requestedAdmin);

        if (!args.manualOverride) {
            return { admin_area_id: undefined };
        }

        const resolved = await this.resolveRoadAdminAreaForWrite({
            geometry: args.geometry,
            requestedAdmin: args.requestedAdmin,
            user: args.user,
        });
        if (!resolved) {
            return { admin_area_id: undefined };
        }
        return {
            admin_area_id: resolved.admin_area_id,
            manual_override: true,
        };
    }

    private async resolveRoadAdminAreaForWrite(args: {
        geometry: StreetLineStringGeometry | undefined;
        requestedAdmin: bigint | null | undefined;
        user: JwtUser;
        /** When true, omitted admin_area_id is inferred from geometry (create). */
        autoWhenOmitted?: boolean;
    }): Promise<{ admin_area_id: bigint | null; manual_override: boolean } | null> {
        if (args.requestedAdmin === undefined && !args.autoWhenOmitted) {
            return null;
        }

        try {
            const resolved = await this.entityAdminArea.resolveForWrite({
                kind: "street",
                geometry: args.geometry,
                requested_admin_area_id: args.requestedAdmin,
                user: args.user,
                path: "admin_area_id",
            });
            await assertRoadTownshipAdminArea(this.entityAdminAreaRepo, resolved.admin_area_id);
            return resolved;
        } catch (error) {
            this.mapStreetAdminAreaError(error);
        }
    }

    async createStreet(body: CreateStreetBody, _user: JwtUser): Promise<StreetResponse> {
        if (!body.geometry) {
            throw new StreetValidationError("geometry is required");
        }
        if (body.geometry.type !== "LineString") {
            throw new StreetValidationError("geometry must be a GeoJSON LineString in WGS 84 (EPSG:4326)");
        }

        const requestedAdmin = body.admin_area_id ?? body.adminAreaId;
        const sourceTypeId =
            body.source_type_id ?? body.sourceTypeId ?? (await this.streetsRepo.getSourceTypeIdByCode("manual"));
        const names = normalizeStreetNames(body);

        let adminAreaId: bigint | null;
        let manualOverride = false;
        try {
            const resolved = await this.resolveRoadAdminAreaForWrite({
                geometry: body.geometry,
                requestedAdmin,
                user: _user,
                autoWhenOmitted: true,
            });
            if (!resolved) {
                throw new StreetValidationError("Road admin_area_id could not be resolved");
            }
            adminAreaId = resolved.admin_area_id;
            manualOverride = resolved.manual_override;
        } catch (error) {
            if (error instanceof StreetValidationError) {
                throw error;
            }
            this.mapStreetAdminAreaError(error);
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

            const verification = resolveCoreReviewVerificationWrite(
                body as unknown as Record<string, unknown>,
            );
            const requestedTravelDirection =
                body.travel_direction !== undefined
                    ? body.travel_direction
                    : body.travelDirection;
            const travelDirection = resolveStreetTravelDirectionWrite({
                travel_direction: normalizeStreetTravelDirection(
                    requestedTravelDirection,
                ),
                is_oneway: body.is_oneway,
            }) ?? null;

            const street = await this.streetsRepo.createStreet({
                myanmarName: names.myanmarName,
                englishName: names.englishName,
                canonical_name: deriveStreetCanonicalName(names),
                admin_area_id: adminAreaId,
                manual_override: manualOverride,
                source_type_id: sourceTypeId,
                road_class_id: body.road_class_id,
                travel_direction: travelDirection,
                surface: body.surface ?? null,
                bridge: body.bridge,
                tunnel: body.tunnel,
                geometry: body.geometry,
                is_active: body.is_active,
                verification_status: verification.verificationStatus,
            });

            if (!street) {
                throw new StreetValidationError("Street could not be created");
            }

            this.scheduleStreetGroupSearchSync(street.public_id);

            return this.serializeStreet(street);
        } catch (error) {
            if (error instanceof StreetCrudValidationError) {
                throw new StreetValidationError(error.message);
            }
            throw error;
        }
    }

    async updateStreet(publicId: string, body: UpdateStreetBody, user: JwtUser): Promise<StreetResponse> {
        const requestedAdmin = body.admin_area_id ?? body.adminAreaId;
        const requestedAdminInBody = body.admin_area_id !== undefined || body.adminAreaId !== undefined;
        const manualOverride = Boolean(body.admin_area_manual_override ?? body.adminAreaManualOverride);
        const explicitClearAdminArea = Boolean(
            body.explicit_clear_admin_area ?? body.explicitClearAdminArea,
        );
        const roadClassId = body.road_class_id ?? body.roadClassId;
        const requestedTravelDirection =
            body.travel_direction !== undefined
                ? body.travel_direction
                : body.travelDirection;
        const travelDirection = resolveStreetTravelDirectionWrite({
            travel_direction: normalizeStreetTravelDirection(
                requestedTravelDirection,
            ),
            is_oneway: body.is_oneway ?? body.isOneway,
        });

        const existing = await this.streetsRepo.getStreetByPublicId(publicId);
        if (!existing) {
            throw new StreetNotFoundError();
        }

        const existingAdminAreaId =
            existing.admin_area_id !== null && existing.admin_area_id !== undefined
                ? BigInt(existing.admin_area_id)
                : null;

        const geometry =
            body.geometry ??
            (existing.geometry as StreetLineStringGeometry | null) ??
            undefined;

        let adminAreaId: bigint | null | undefined;
        let manualOverrideFlag: boolean | undefined;
        try {
            const resolved = await this.resolveRoadAdminAreaForUpdate({
                existingAdminAreaId,
                geometry,
                requestedAdmin,
                requestedAdminInBody,
                manualOverride,
                explicitClearAdminArea,
                user,
            });
            adminAreaId = resolved.admin_area_id;
            manualOverrideFlag = resolved.manual_override;
        } catch (error) {
            if (error instanceof StreetValidationError) {
                throw error;
            }
            this.mapStreetAdminAreaError(error);
        }

        const input: UpdateStreetInput = {
            myanmarName: body.myanmarName,
            englishName: body.englishName,
            geometry: body.geometry,
            road_class_id: roadClassId,
            travel_direction: travelDirection,
            surface: body.surface,
            bridge: body.bridge,
            tunnel: body.tunnel,
        };

        if (adminAreaId !== undefined) {
            input.admin_area_id = adminAreaId;
        }
        if (manualOverrideFlag !== undefined) {
            input.manual_override = manualOverrideFlag;
        }

        const pickedVerification = pickCoreReviewVerificationWrite(body as unknown as Record<string, unknown>);
        if (pickedVerification) {
            input.verification_status = pickedVerification.verificationStatus;
        }

        try {
            const street = await this.streetsRepo.updateStreet(
                publicId,
                input,
                mutationContext(user, body.edit_reason),
                { existing },
            );

            if (!street) {
                throw new StreetNotFoundError();
            }

            this.scheduleStreetGroupSearchSync(street.public_id);

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

            this.scheduleStreetGroupSearchSync(street.public_id);

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

            this.scheduleStreetGroupSearchSync(result.originalStreetId);
            this.scheduleStreetGroupSearchSync(result.newStreets[0].public_id);
            this.scheduleStreetGroupSearchSync(result.newStreets[1].public_id);

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
