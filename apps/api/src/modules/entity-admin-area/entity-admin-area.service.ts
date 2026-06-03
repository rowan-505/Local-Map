import type { JwtUser } from "../../plugins/auth.js";
import type { ValidationIssue } from "../../lib/core-review/ref-validation.js";
import {
    canOverrideEntityAdminAreaGeometryMismatch,
    ENTITY_ADMIN_AREA_TARGET_LEVEL,
} from "./entity-admin-area.constants.js";
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
};

export type EntityAdminAreaInferResult = {
    admin_area_id: string | null;
    canonical_name: string | null;
    admin_level_code: string | null;
    geometry_contains: boolean;
};

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

export class EntityAdminAreaValidationError extends Error {
    readonly issues: ValidationIssue[];

    constructor(message: string, issues: ValidationIssue[]) {
        super(message);
        this.name = "EntityAdminAreaValidationError";
        this.issues = issues;
    }
}

export class EntityAdminAreaService {
    constructor(private readonly repo: EntityAdminAreaRepository) {}

    async infer(input: EntityAdminAreaInferInput): Promise<EntityAdminAreaInferResult> {
        const inferredId = await this.inferId(input);
        const summary = inferredId !== null ? await this.repo.getActiveAdminAreaSummary(inferredId) : null;
        const geometryContains = inferredId !== null && summary !== null;

        return {
            admin_area_id: inferredId !== null ? inferredId.toString() : null,
            canonical_name: summary?.canonical_name ?? null,
            admin_level_code: summary?.admin_level_code ?? null,
            geometry_contains: geometryContains,
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

        if (!input.geometry) {
            return null;
        }

        const geojsonText = JSON.stringify(input.geometry);
        if (input.kind === "street") {
            return this.repo.inferAdminAreaIdForLineGeoJson(geojsonText);
        }
        return this.repo.inferAdminAreaIdForPolygonGeoJson(geojsonText);
    }

    private async geometryMatches(input: EntityAdminAreaInferInput, adminAreaId: bigint): Promise<boolean> {
        if (input.kind === "place") {
            if (input.lat === undefined || input.lng === undefined) {
                return false;
            }
            return this.repo.geometryMatchesTownshipAdminArea(adminAreaId, "place", {
                lng: input.lng,
                lat: input.lat,
            });
        }

        if (!input.geometry) {
            return false;
        }

        const geojsonText = JSON.stringify(input.geometry);
        return this.repo.geometryMatchesTownshipAdminArea(
            adminAreaId,
            input.kind === "street" ? "street" : "building",
            { geojsonText }
        );
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
