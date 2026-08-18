import type { JwtUser } from "../../plugins/auth.js";
import type { ValidationIssue } from "../../lib/core-review/ref-validation.js";
import {
    assertActiveTownshipAdminArea as assertActiveTownshipAdminAreaId,
    resolveTownshipAdminAreaWhenOmitted,
} from "./entity-admin-area-update.js";
import { EntityAdminAreaValidationError } from "./entity-admin-area.errors.js";
import {
    canOverrideEntityAdminAreaGeometryMismatch,
    ENTITY_ADMIN_AREA_TARGET_LEVEL,
} from "./entity-admin-area.constants.js";
import { isRoadTownshipAdminLevel } from "../admin-areas/admin-areas.road-township-level.js";
import { isRoadEntityAdminAreaKind } from "./entity-admin-area-kind.js";
import {
    buildEntityAdminAreaInferCacheKey,
    getCachedEntityAdminAreaInferResult,
    setCachedEntityAdminAreaInferResult,
} from "./entity-admin-area.infer-cache.js";
import {
    buildRoadTownshipInferMessage,
    mapCommonParentResponse,
    mapFallbackReason,
    mapIntersectingTownshipsResponse,
    mapRecommendedTownshipResponse,
    resolveRoadTownshipRecommendationMode,
    type RoadTownshipRecommendationMode,
} from "./entity-admin-area.road-infer-message.js";
import type { RoadTownshipDebugReason, RoadTownshipRecommendationResult } from "./entity-admin-area.road-township-recommend.js";
import {
    EntityAdminAreaRepository,
    type EntityAdminAreaKind,
    type EntityAdminAreaSummaryRow,
} from "./entity-admin-area.repo.js";

export type EntityAdminAreaInferInput = {
    kind: EntityAdminAreaKind;
    lat?: number;
    lng?: number;
    geometry?: { type: string; coordinates: unknown };
    /** Road edit audit: stored admin_area_id from DB (optional). */
    current_admin_area_id?: string;
    /** Road edit audit logging only. */
    entity_public_id?: string;
};

export type RoadAdminAreaInferStatus =
    | "valid_existing"
    | "recommendation_found"
    | "no_match"
    | "invalid_geometry";

export type CurrentAdminAreaStatus =
    | "valid_township"
    | "null"
    | "missing"
    | "inactive"
    | "non_township";

export type RoadInferCurrentAdminArea = {
    id: string | null;
    name: string | null;
    level_code: string | null;
    is_active: boolean | null;
};

export type RoadInferRecommendedTownship = {
    id: string;
    name_mm: string | null;
    name_en: string | null;
    canonical_name: string | null;
};

export type RoadInferIntersectingTownship = {
    id: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_code: string;
    overlap_m: number;
    overlap_pct: number | null;
};

export type RoadInferCommonParentAdminArea = {
    id: string;
    canonical_name: string;
    admin_level_code: string;
    name_mm: string | null;
    name_en: string | null;
};

export type EntityAdminAreaInferResult = {
    admin_area_id: string | null;
    canonical_name: string | null;
    admin_level_code: string | null;
    name_mm: string | null;
    name_en: string | null;
    geometry_contains: boolean;
    /** Road/street and land area infer audit — present when kind is street/road or land_area. */
    status?: RoadAdminAreaInferStatus;
    message?: string | null;
    currentAdminArea?: RoadInferCurrentAdminArea | null;
    recommendedTownship?: RoadInferRecommendedTownship | null;
    recommendationMode?: RoadTownshipRecommendationMode | null;
    intersectingTownships?: RoadInferIntersectingTownship[];
    commonParentAdminArea?: RoadInferCommonParentAdminArea | null;
    debugReason?: RoadTownshipDebugReason | null;
    fallbackReason?: "point_fallback" | "nearest_township" | null;
    nearestTownshipDistanceM?: number | null;
};

function emptyEntityAdminAreaInferResult(): EntityAdminAreaInferResult {
    return {
        admin_area_id: null,
        canonical_name: null,
        admin_level_code: null,
        name_mm: null,
        name_en: null,
        geometry_contains: false,
    };
}

export type EntityAdminAreaValidateManualInput = EntityAdminAreaInferInput & {
    admin_area_id: string;
};

export type EntityAdminAreaValidateManualResult = {
    valid: boolean;
    geometry_contains: boolean;
    inferred_admin_area_id: string | null;
    admin_level_code: string | null;
    message: string | null;
    can_save_without_override: boolean;
};

export type EntityAdminAreaResolveInput = EntityAdminAreaInferInput & {
    /** When set (including null), client requests this id; undefined = auto from geometry only. */
    requested_admin_area_id?: bigint | null;
    user: JwtUser;
    path?: string;
};

export type EntityAdminAreaResolveResult = {
    admin_area_id: bigint | null;
    manual_override: boolean;
};

export { EntityAdminAreaValidationError } from "./entity-admin-area.errors.js";

export class EntityAdminAreaService {
    constructor(private readonly repo: EntityAdminAreaRepository) {}

    async infer(input: EntityAdminAreaInferInput): Promise<EntityAdminAreaInferResult> {
        const cacheKey = buildEntityAdminAreaInferCacheKey(input);
        const cached = getCachedEntityAdminAreaInferResult(cacheKey);
        if (cached) {
            return cached;
        }

        let result: EntityAdminAreaInferResult;

        if (isRoadEntityAdminAreaKind(input.kind)) {
            result = await this.inferRoadTownship(input);
        } else if (input.kind === "land_area") {
            result = await this.inferLandAreaTownship(input);
        } else if (input.kind === "bus_stop") {
            result = await this.inferBusStopTownship(input);
        } else {
            const inferredId = await this.inferId(input);
            const summary = inferredId !== null ? await this.repo.getActiveAdminAreaSummary(inferredId) : null;
            const geometryContains = inferredId !== null && summary !== null;

            result = {
                admin_area_id: inferredId !== null ? inferredId.toString() : null,
                canonical_name: summary?.canonical_name ?? null,
                admin_level_code: summary?.admin_level_code ?? null,
                name_mm: null,
                name_en: null,
                geometry_contains: geometryContains,
            };
        }

        setCachedEntityAdminAreaInferResult(cacheKey, result);
        return result;
    }

    private isValidRoadLineGeometry(
        geometry: EntityAdminAreaInferInput["geometry"],
    ): geometry is NonNullable<EntityAdminAreaInferInput["geometry"]> {
        if (!geometry) {
            return false;
        }
        if (geometry.type === "LineString") {
            const coords = geometry.coordinates;
            return Array.isArray(coords) && coords.length >= 2;
        }
        if (geometry.type === "MultiLineString") {
            const lines = geometry.coordinates;
            return (
                Array.isArray(lines) &&
                lines.some((line) => Array.isArray(line) && line.length >= 2)
            );
        }
        return false;
    }

    private isValidLandAreaPolygonGeometry(
        geometry: EntityAdminAreaInferInput["geometry"],
    ): geometry is NonNullable<EntityAdminAreaInferInput["geometry"]> {
        if (!geometry) {
            return false;
        }
        if (geometry.type === "Polygon") {
            const rings = geometry.coordinates;
            if (!Array.isArray(rings) || rings.length === 0) {
                return false;
            }
            const outer = rings[0];
            return Array.isArray(outer) && outer.length >= 4;
        }
        if (geometry.type === "MultiPolygon") {
            const polys = geometry.coordinates;
            return (
                Array.isArray(polys) &&
                polys.some(
                    (poly) =>
                        Array.isArray(poly) &&
                        poly.length > 0 &&
                        Array.isArray(poly[0]) &&
                        poly[0].length >= 4,
                )
            );
        }
        return false;
    }

    private async inferLandAreaTownship(input: EntityAdminAreaInferInput): Promise<EntityAdminAreaInferResult> {
        const geometryValid = this.isValidLandAreaPolygonGeometry(input.geometry);

        if (!geometryValid) {
            return this.buildLandAreaInferAuditResult({
                input,
                inferredId: null,
                inferredSummary: null,
                geometryIntersects: false,
                clientGeometryInvalid: true,
            });
        }

        let inferredId: bigint | null = null;
        let inferredSummary: EntityAdminAreaSummaryRow | null = null;
        let geometryIntersects = false;

        try {
            inferredId = await this.repo.inferAdminAreaIdForPolygonGeoJson(
                JSON.stringify(input.geometry),
            );
            if (inferredId !== null) {
                inferredSummary = await this.repo.getActiveAdminAreaSummary(inferredId);
                geometryIntersects =
                    inferredSummary !== null &&
                    (await this.geometryMatches(input, inferredId));
            }
        } catch {
            return this.buildLandAreaInferAuditResult({
                input,
                inferredId: null,
                inferredSummary: null,
                geometryIntersects: false,
                clientGeometryInvalid: false,
                debugReason: "query_error",
            });
        }

        return this.buildLandAreaInferAuditResult({
            input,
            inferredId,
            inferredSummary,
            geometryIntersects,
            clientGeometryInvalid: false,
            debugReason: inferredId === null ? "outside_all_townships" : null,
        });
    }

    private async buildLandAreaInferAuditResult(args: {
        input: EntityAdminAreaInferInput;
        inferredId: bigint | null;
        inferredSummary: EntityAdminAreaSummaryRow | null;
        geometryIntersects: boolean;
        clientGeometryInvalid: boolean;
        debugReason?: RoadTownshipDebugReason | null;
    }): Promise<EntityAdminAreaInferResult> {
        const current = await this.classifyCurrentRoadAdminArea(
            args.input.current_admin_area_id ?? null,
        );

        const recommendedTownship =
            args.inferredSummary !== null && args.inferredId !== null
                ? mapRecommendedTownshipResponse({
                      id: args.inferredId,
                      canonical_name: args.inferredSummary.canonical_name,
                      name_mm: null,
                      name_en: null,
                      admin_level_code: args.inferredSummary.admin_level_code,
                      overlap_m: 0,
                      overlap_pct: null,
                  })
                : null;

        const storedTownshipId = current.currentAdminArea.id?.trim() || null;
        const recommendedTownshipId = recommendedTownship?.id?.trim() || null;
        const debugReason = args.clientGeometryInvalid
            ? "invalid_geometry"
            : (args.debugReason ?? null);

        const status = this.resolveRoadInferStatus({
            currentStatus: current.current_admin_area_status,
            storedTownshipId,
            recommendedTownshipId,
            hasRecommendation: recommendedTownship !== null,
            debugReason,
            clientGeometryInvalid: args.clientGeometryInvalid,
        });

        const message =
            status === "valid_existing"
                ? current.currentAdminArea.name
                    ? `Current township is valid: ${current.currentAdminArea.name}.`
                    : "Current township is valid."
                : status === "invalid_geometry"
                  ? "Land area polygon geometry is missing or invalid."
                  : recommendedTownship?.canonical_name
                    ? `Recommended township: ${recommendedTownship.canonical_name}.`
                    : "No township match for this land area polygon.";

        const base: EntityAdminAreaInferResult = {
            ...emptyEntityAdminAreaInferResult(),
            status,
            message,
            currentAdminArea: current.currentAdminArea,
            recommendedTownship,
            recommendationMode: recommendedTownship ? "single_overlap" : null,
            intersectingTownships: [],
            commonParentAdminArea: null,
            debugReason,
            fallbackReason: null,
            nearestTownshipDistanceM: null,
        };

        if (!recommendedTownship) {
            return base;
        }

        return {
            ...base,
            admin_area_id: recommendedTownship.id,
            canonical_name: recommendedTownship.canonical_name,
            admin_level_code: args.inferredSummary?.admin_level_code ?? "township",
            name_mm: recommendedTownship.name_mm,
            name_en: recommendedTownship.name_en,
            geometry_contains: args.geometryIntersects,
        };
    }

    private resolveBusStopPoint(
        input: EntityAdminAreaInferInput,
    ): { lat: number; lng: number } | null {
        if (input.lat !== undefined && input.lng !== undefined) {
            return { lat: input.lat, lng: input.lng };
        }
        if (!input.geometry || input.geometry.type !== "Point") {
            return null;
        }
        const coords = input.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) {
            return null;
        }
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
        }
        return { lat, lng };
    }

    private async inferBusStopTownship(input: EntityAdminAreaInferInput): Promise<EntityAdminAreaInferResult> {
        const pt = this.resolveBusStopPoint(input);

        if (!pt) {
            return this.buildBusStopInferAuditResult({
                input,
                inferredId: null,
                inferredSummary: null,
                geometryContains: false,
                clientGeometryInvalid: true,
            });
        }

        let inferredId: bigint | null = null;
        let inferredSummary: EntityAdminAreaSummaryRow | null = null;
        let geometryContains = false;

        try {
            inferredId = await this.repo.inferAdminAreaIdForPoint(pt.lng, pt.lat);
            if (inferredId !== null) {
                inferredSummary = await this.repo.getActiveAdminAreaSummary(inferredId);
                geometryContains =
                    inferredSummary !== null &&
                    (await this.geometryMatches(
                        { ...input, lat: pt.lat, lng: pt.lng },
                        inferredId,
                    ));
            }
        } catch {
            return this.buildBusStopInferAuditResult({
                input,
                inferredId: null,
                inferredSummary: null,
                geometryContains: false,
                clientGeometryInvalid: false,
                debugReason: "query_error",
            });
        }

        return this.buildBusStopInferAuditResult({
            input,
            inferredId,
            inferredSummary,
            geometryContains,
            clientGeometryInvalid: false,
            debugReason: inferredId === null ? "outside_all_townships" : null,
        });
    }

    private async buildBusStopInferAuditResult(args: {
        input: EntityAdminAreaInferInput;
        inferredId: bigint | null;
        inferredSummary: EntityAdminAreaSummaryRow | null;
        geometryContains: boolean;
        clientGeometryInvalid: boolean;
        debugReason?: RoadTownshipDebugReason | null;
    }): Promise<EntityAdminAreaInferResult> {
        const current = await this.classifyCurrentRoadAdminArea(
            args.input.current_admin_area_id ?? null,
        );

        const recommendedTownship =
            args.inferredSummary !== null && args.inferredId !== null
                ? mapRecommendedTownshipResponse({
                      id: args.inferredId,
                      canonical_name: args.inferredSummary.canonical_name,
                      name_mm: null,
                      name_en: null,
                      admin_level_code: args.inferredSummary.admin_level_code,
                      overlap_m: 0,
                      overlap_pct: null,
                  })
                : null;

        const storedTownshipId = current.currentAdminArea.id?.trim() || null;
        const recommendedTownshipId = recommendedTownship?.id?.trim() || null;
        const debugReason = args.clientGeometryInvalid
            ? "invalid_geometry"
            : (args.debugReason ?? null);

        const status = this.resolveRoadInferStatus({
            currentStatus: current.current_admin_area_status,
            storedTownshipId,
            recommendedTownshipId,
            hasRecommendation: recommendedTownship !== null,
            debugReason,
            clientGeometryInvalid: args.clientGeometryInvalid,
        });

        const message =
            status === "valid_existing"
                ? current.currentAdminArea.name
                    ? `Current township is valid: ${current.currentAdminArea.name}.`
                    : "Current township is valid."
                : status === "invalid_geometry"
                  ? "Bus stop point geometry is missing or invalid."
                  : recommendedTownship?.canonical_name
                    ? `Recommended township: ${recommendedTownship.canonical_name}.`
                    : "No township match for this bus stop location.";

        const base: EntityAdminAreaInferResult = {
            ...emptyEntityAdminAreaInferResult(),
            status,
            message,
            currentAdminArea: current.currentAdminArea,
            recommendedTownship,
            recommendationMode: recommendedTownship ? "single_overlap" : null,
            intersectingTownships: [],
            commonParentAdminArea: null,
            debugReason,
            fallbackReason: null,
            nearestTownshipDistanceM: null,
        };

        if (!recommendedTownship) {
            return base;
        }

        return {
            ...base,
            admin_area_id: recommendedTownship.id,
            canonical_name: recommendedTownship.canonical_name,
            admin_level_code: args.inferredSummary?.admin_level_code ?? "township",
            name_mm: recommendedTownship.name_mm,
            name_en: recommendedTownship.name_en,
            geometry_contains: args.geometryContains,
        };
    }

    private async inferRoadTownship(input: EntityAdminAreaInferInput): Promise<EntityAdminAreaInferResult> {
        const geometryValid = this.isValidRoadLineGeometry(input.geometry);

        if (!geometryValid) {
            return this.buildRoadInferAuditResult({
                input,
                recommendation: null,
                clientGeometryInvalid: true,
            });
        }

        const recommendation = await this.repo.recommendRoadTownshipFromGeoJson(
            JSON.stringify(input.geometry),
        );
        return this.buildRoadInferAuditResult({
            input,
            recommendation,
            clientGeometryInvalid: false,
        });
    }

    private async classifyCurrentRoadAdminArea(currentAdminAreaId: string | null | undefined): Promise<{
        current_admin_area_status: CurrentAdminAreaStatus;
        currentAdminArea: RoadInferCurrentAdminArea;
    }> {
        const trimmed = currentAdminAreaId?.trim() ?? "";
        if (!trimmed) {
            return {
                current_admin_area_status: "null",
                currentAdminArea: {
                    id: null,
                    name: null,
                    level_code: null,
                    is_active: null,
                },
            };
        }

        let id: bigint;
        try {
            id = BigInt(trimmed);
        } catch {
            return {
                current_admin_area_status: "missing",
                currentAdminArea: {
                    id: trimmed,
                    name: null,
                    level_code: null,
                    is_active: null,
                },
            };
        }

        const row = await this.repo.getAdminAreaSummaryAnyStatus(id);
        if (!row) {
            return {
                current_admin_area_status: "missing",
                currentAdminArea: {
                    id: trimmed,
                    name: null,
                    level_code: null,
                    is_active: null,
                },
            };
        }

        const isActive = row.is_active && row.deleted_at === null;
        if (!isActive) {
            return {
                current_admin_area_status: "inactive",
                currentAdminArea: {
                    id: trimmed,
                    name: row.canonical_name,
                    level_code: row.admin_level_code,
                    is_active: false,
                },
            };
        }

        if (!isRoadTownshipAdminLevel(row.admin_level_code, row.admin_level_name)) {
            return {
                current_admin_area_status: "non_township",
                currentAdminArea: {
                    id: trimmed,
                    name: row.canonical_name,
                    level_code: row.admin_level_code,
                    is_active: true,
                },
            };
        }

        return {
            current_admin_area_status: "valid_township",
            currentAdminArea: {
                id: trimmed,
                name: row.canonical_name,
                level_code: row.admin_level_code,
                is_active: true,
            },
        };
    }

    private resolveRoadInferStatus(args: {
        currentStatus: CurrentAdminAreaStatus;
        storedTownshipId: string | null;
        recommendedTownshipId: string | null;
        hasRecommendation: boolean;
        debugReason: RoadTownshipDebugReason | null;
        clientGeometryInvalid: boolean;
    }): RoadAdminAreaInferStatus {
        if (args.clientGeometryInvalid || args.debugReason === "invalid_geometry") {
            return "invalid_geometry";
        }
        if (args.currentStatus === "valid_township") {
            if (
                args.hasRecommendation &&
                args.storedTownshipId &&
                args.recommendedTownshipId &&
                args.storedTownshipId !== args.recommendedTownshipId
            ) {
                return "recommendation_found";
            }
            return "valid_existing";
        }
        if (args.hasRecommendation) {
            return "recommendation_found";
        }
        return "no_match";
    }

    private async buildRoadInferAuditResult(args: {
        input: EntityAdminAreaInferInput;
        recommendation: RoadTownshipRecommendationResult | null;
        clientGeometryInvalid: boolean;
    }): Promise<EntityAdminAreaInferResult> {
        const current = await this.classifyCurrentRoadAdminArea(
            args.input.current_admin_area_id ?? null,
        );

        const recommendation =
            args.recommendation ??
            ({
                recommended: null,
                matches: [],
                commonParent: null,
                fallback_reason: null,
                distance_m: null,
                nearest_unfiltered_distance_m: null,
                debugReason: args.clientGeometryInvalid ? "invalid_geometry" : "query_error",
                road_length_m: null,
                geometry_intersects: false,
            } satisfies RoadTownshipRecommendationResult);

        const recommendedTownship = mapRecommendedTownshipResponse(recommendation.recommended);
        const recommendationMode = resolveRoadTownshipRecommendationMode(recommendation);
        const debugReason = args.clientGeometryInvalid
            ? "invalid_geometry"
            : recommendation.debugReason;

        const storedTownshipId = current.currentAdminArea.id?.trim() || null;
        const recommendedTownshipId = recommendedTownship?.id?.trim() || null;

        const status = this.resolveRoadInferStatus({
            currentStatus: current.current_admin_area_status,
            storedTownshipId,
            recommendedTownshipId,
            hasRecommendation: recommendedTownship !== null,
            debugReason,
            clientGeometryInvalid: args.clientGeometryInvalid,
        });

        const message =
            status === "valid_existing"
                ? current.currentAdminArea.name
                    ? `Current township is valid: ${current.currentAdminArea.name}.`
                    : "Current township is valid."
                : buildRoadTownshipInferMessage({
                      recommendation,
                      mode: recommendationMode,
                      current: current.currentAdminArea,
                      debugReason: status === "invalid_geometry" ? "invalid_geometry" : debugReason,
                  });

        const base: EntityAdminAreaInferResult = {
            ...emptyEntityAdminAreaInferResult(),
            status,
            message,
            currentAdminArea: current.currentAdminArea,
            recommendedTownship,
            recommendationMode,
            intersectingTownships: mapIntersectingTownshipsResponse(recommendation.matches),
            commonParentAdminArea: mapCommonParentResponse(recommendation.commonParent),
            debugReason: debugReason ?? null,
            fallbackReason: mapFallbackReason(recommendation.fallback_reason),
            nearestTownshipDistanceM:
                recommendation.distance_m ?? recommendation.nearest_unfiltered_distance_m ?? null,
        };

        if (!recommendation.recommended) {
            return base;
        }

        return {
            ...base,
            admin_area_id: recommendedTownship?.id ?? null,
            canonical_name: recommendedTownship?.canonical_name ?? null,
            admin_level_code: recommendation.recommended.admin_level_code,
            name_mm: recommendation.recommended.name_mm,
            name_en: recommendation.recommended.name_en,
            geometry_contains: recommendation.geometry_intersects,
        };
    }

    async validateManual(
        input: EntityAdminAreaValidateManualInput,
        user: JwtUser
    ): Promise<EntityAdminAreaValidateManualResult> {
        const adminAreaId = BigInt(input.admin_area_id.trim());
        const inferred = await this.infer(input);
        const inferredId = inferred.admin_area_id;

        const summary = await this.repo.getActiveAdminAreaSummary(adminAreaId);
        if (!summary) {
            return {
                valid: false,
                geometry_contains: false,
                inferred_admin_area_id: inferredId,
                admin_level_code: null,
                message: "admin_area_id is invalid or inactive",
                can_save_without_override: false,
            };
        }

        const isTownship = await this.repo.isTownshipAdminArea(adminAreaId);
        if (!isTownship) {
            return {
                valid: false,
                geometry_contains: false,
                inferred_admin_area_id: inferredId,
                admin_level_code: summary.admin_level_code,
                message: `admin_area_id must be a ${ENTITY_ADMIN_AREA_TARGET_LEVEL}-level area, not ${summary.admin_level_code}`,
                can_save_without_override: false,
            };
        }

        const geometryContains = await this.geometryMatches(input, adminAreaId);
        if (geometryContains || inferredId === adminAreaId.toString()) {
            return {
                valid: true,
                geometry_contains: geometryContains,
                inferred_admin_area_id: inferredId,
                admin_level_code: summary.admin_level_code,
                message: null,
                can_save_without_override: true,
            };
        }

        const canOverride = canOverrideEntityAdminAreaGeometryMismatch(user.roles);
        return {
            valid: canOverride,
            geometry_contains: false,
            inferred_admin_area_id: inferredId,
            admin_level_code: summary.admin_level_code,
            message:
                "Selected township does not contain or intersect this geometry. Use the calculated township or ask an admin to override.",
            can_save_without_override: canOverride,
        };
    }

    /**
     * Resolves admin_area_id for entity writes: auto from geometry unless client pins a manual township.
     */
    async resolveForWrite(input: EntityAdminAreaResolveInput): Promise<EntityAdminAreaResolveResult> {
        const path = input.path ?? "adminAreaId";
        const inferredId = await this.inferId(input);

        if (input.requested_admin_area_id === undefined) {
            return { admin_area_id: inferredId, manual_override: false };
        }

        const requested = input.requested_admin_area_id;
        if (requested === null) {
            return { admin_area_id: inferredId, manual_override: false };
        }

        const issues = await this.validateRequestedAdminArea(input, requested, inferredId, path);
        if (issues.length > 0) {
            throw new EntityAdminAreaValidationError(
                issues.map((i) => i.message).join("; "),
                issues
            );
        }

        const manual =
            inferredId === null ? true : requested !== inferredId;

        return {
            admin_area_id: requested,
            manual_override: manual,
        };
    }

    private async validateRequestedAdminArea(
        input: EntityAdminAreaResolveInput,
        requested: bigint,
        inferredId: bigint | null,
        path: string
    ): Promise<ValidationIssue[]> {
        const summary = await this.repo.getActiveAdminAreaSummary(requested);
        if (!summary) {
            return [{ path, message: "admin_area_id is invalid or inactive" }];
        }

        if (!(await this.repo.isTownshipAdminArea(requested))) {
            return [
                {
                    path,
                    message: `admin_area_id must be ${ENTITY_ADMIN_AREA_TARGET_LEVEL}-level (not ${summary.admin_level_code})`,
                },
            ];
        }

        if (inferredId !== null && requested === inferredId) {
            return [];
        }

        const geometryContains = await this.geometryMatches(input, requested);
        if (geometryContains) {
            return [];
        }

        if (canOverrideEntityAdminAreaGeometryMismatch(input.user.roles)) {
            return [];
        }

        return [
            {
                path,
                message:
                    "Selected township does not contain or intersect entity geometry. Admin override permission is required.",
            },
        ];
    }

    private async inferId(input: EntityAdminAreaInferInput): Promise<bigint | null> {
        if (input.kind === "place") {
            if (input.lat === undefined || input.lng === undefined) {
                return null;
            }
            return this.repo.inferAdminAreaIdForPoint(input.lng, input.lat);
        }

        if (input.kind === "bus_stop") {
            const pt = this.resolveBusStopPoint(input);
            if (!pt) {
                return null;
            }
            return this.repo.inferAdminAreaIdForPoint(pt.lng, pt.lat);
        }

        if (!input.geometry) {
            return null;
        }

        const geojsonText = JSON.stringify(input.geometry);
        if (input.kind === "street") {
            return this.repo.inferAdminAreaIdForLineGeoJson(geojsonText);
        }
        if (input.kind === "building" || input.kind === "land_area") {
            return this.repo.inferAdminAreaIdForPolygonGeoJson(geojsonText);
        }
        return null;
    }

    private async geometryMatches(input: EntityAdminAreaInferInput, adminAreaId: bigint): Promise<boolean> {
        if (input.kind === "place" || input.kind === "bus_stop") {
            const pt =
                input.kind === "bus_stop"
                    ? this.resolveBusStopPoint(input)
                    : input.lat !== undefined && input.lng !== undefined
                      ? { lat: input.lat, lng: input.lng }
                      : null;
            if (!pt) {
                return false;
            }
            return this.repo.geometryMatchesTownshipAdminArea(adminAreaId, "place", {
                lng: pt.lng,
                lat: pt.lat,
            });
        }

        if (!input.geometry) {
            return false;
        }

        const geojsonText = JSON.stringify(input.geometry);
        const polygonKind =
            input.kind === "land_area" ? "land_area" : input.kind === "building" ? "building" : "street";
        return this.repo.geometryMatchesTownshipAdminArea(adminAreaId, polygonKind, { geojsonText });
    }

    /** Omitted admin_area_id on entity update — preserve township/null, clear legacy non-township. */
    async resolveTownshipAdminAreaForOmittedUpdate(existingAdminAreaId: bigint | null) {
        return resolveTownshipAdminAreaWhenOmitted(this.repo, existingAdminAreaId);
    }

    /** Explicit admin_area_id on entity update — must be an active township. */
    async assertActiveTownshipAdminArea(adminAreaId: bigint, path = "admin_area_id"): Promise<void> {
        return assertActiveTownshipAdminAreaId(this.repo, adminAreaId, path);
    }
}

export function serializeAdminAreaSummary(row: EntityAdminAreaSummaryRow | null) {
    if (!row) {
        return null;
    }
    return {
        id: row.id.toString(),
        canonical_name: row.canonical_name,
        admin_level_code: row.admin_level_code,
        admin_level_name: row.admin_level_name,
    };
}
