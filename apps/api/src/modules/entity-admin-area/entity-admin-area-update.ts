import type { ValidationIssue } from "../../lib/core-review/ref-validation.js";
import { ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES, ENTITY_ADMIN_AREA_TARGET_LEVEL } from "./entity-admin-area.constants.js";
import type { EntityAdminAreaRepository } from "./entity-admin-area.repo.js";
import { EntityAdminAreaValidationError } from "./entity-admin-area.errors.js";

export const TOWNSHIP_ADMIN_AREA_MUST_BE_TOWNSHIP_CODE = "ADMIN_AREA_MUST_BE_TOWNSHIP";

export type TownshipAdminAreaOmittedUpdateResult = {
    /** undefined = preserve existing DB value; null = clear legacy non-township */
    admin_area_id: bigint | null | undefined;
};

function formatNonTownshipMessage(adminLevelCode: string): string {
    const level = adminLevelCode.trim().toLowerCase() || "unknown";
    if (ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES.has(level)) {
        return `admin_area_id must be a ${ENTITY_ADMIN_AREA_TARGET_LEVEL}-level admin area or null; received ${level}-level admin area.`;
    }
    return `admin_area_id must be a ${ENTITY_ADMIN_AREA_TARGET_LEVEL}-level admin area or null; received "${adminLevelCode}" admin area.`;
}

/**
 * Entity update when admin_area_id is omitted from the request body:
 * preserve existing township or null; clear legacy non-township to null.
 */
export async function resolveTownshipAdminAreaWhenOmitted(
    repo: EntityAdminAreaRepository,
    existingAdminAreaId: bigint | null,
): Promise<TownshipAdminAreaOmittedUpdateResult> {
    if (existingAdminAreaId === null) {
        return { admin_area_id: undefined };
    }
    if (await repo.isTownshipAdminArea(existingAdminAreaId)) {
        return { admin_area_id: undefined };
    }
    return { admin_area_id: null };
}

/** Validates that an explicit admin_area_id is an active township. */
export async function assertActiveTownshipAdminArea(
    repo: EntityAdminAreaRepository,
    adminAreaId: bigint,
    path = "admin_area_id",
): Promise<void> {
    const summary = await repo.getActiveAdminAreaSummary(adminAreaId);
    if (!summary) {
        const issues: ValidationIssue[] = [
            { path, message: "admin_area_id is invalid or inactive" },
        ];
        throw new EntityAdminAreaValidationError(issues.map((i) => i.message).join("; "), issues);
    }

    if (!(await repo.isTownshipAdminArea(adminAreaId))) {
        const issues: ValidationIssue[] = [
            {
                path,
                message: formatNonTownshipMessage(summary.admin_level_code),
                code: TOWNSHIP_ADMIN_AREA_MUST_BE_TOWNSHIP_CODE,
            },
        ];
        throw new EntityAdminAreaValidationError(issues.map((i) => i.message).join("; "), issues);
    }
}
