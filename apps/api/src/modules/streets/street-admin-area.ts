import {
    ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES,
    ENTITY_ADMIN_AREA_TARGET_LEVEL,
} from "../entity-admin-area/entity-admin-area.constants.js";
import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";

export const ROAD_ADMIN_AREA_MUST_BE_TOWNSHIP_CODE = "ROAD_ADMIN_AREA_MUST_BE_TOWNSHIP";

export class StreetAdminAreaValidationError extends Error {
    readonly path = "admin_area_id";
    readonly code?: string;

    constructor(message: string, code?: string) {
        super(message);
        this.name = "StreetAdminAreaValidationError";
        this.code = code;
    }
}

function formatForbiddenLevelMessage(adminLevelCode: string): string {
    const level = adminLevelCode.trim().toLowerCase() || "unknown";
    if (ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES.has(level)) {
        return `Road admin_area_id must be a ${ENTITY_ADMIN_AREA_TARGET_LEVEL}-level admin area or null; received ${level}-level admin area.`;
    }
    return `Road admin_area_id must be a ${ENTITY_ADMIN_AREA_TARGET_LEVEL}-level admin area or null; received "${adminLevelCode}" admin area.`;
}

/**
 * Roads may persist only null or an active township (town) admin_area_id.
 * Does not apply to places, buildings, or other entities.
 */
export async function assertRoadTownshipAdminArea(
    repo: EntityAdminAreaRepository,
    adminAreaId: bigint | null | undefined,
): Promise<void> {
    if (adminAreaId === undefined || adminAreaId === null) {
        return;
    }

    const summary = await repo.getActiveAdminAreaSummary(adminAreaId);
    if (!summary) {
        throw new StreetAdminAreaValidationError("Road admin_area_id is invalid or inactive.");
    }

    if (!(await repo.isTownshipAdminArea(adminAreaId))) {
        throw new StreetAdminAreaValidationError(
            formatForbiddenLevelMessage(summary.admin_level_code),
            ROAD_ADMIN_AREA_MUST_BE_TOWNSHIP_CODE,
        );
    }
}
