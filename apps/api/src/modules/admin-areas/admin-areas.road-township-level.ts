import { Prisma } from "@prisma/client";

import {
    ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES,
    ENTITY_ADMIN_AREA_TARGET_LEVEL,
} from "../entity-admin-area/entity-admin-area.constants.js";

/** Mirrors EntityAdminAreaRepository.isTownshipAdminArea eligibility for road picker search. */
export function isRoadTownshipAdminLevel(
    adminLevelCode: string,
    adminLevelName: string | null | undefined,
): boolean {
    const code = adminLevelCode.trim().toLowerCase();
    if (ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES.has(code)) {
        return false;
    }
    const levelName = adminLevelName?.trim().toLowerCase() ?? "";
    return (
        code === ENTITY_ADMIN_AREA_TARGET_LEVEL ||
        code === "town" ||
        levelName === ENTITY_ADMIN_AREA_TARGET_LEVEL
    );
}

const forbiddenAdminLevelCodesSql = Prisma.join(
    Array.from(ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES).map((code) => Prisma.sql`${code}`),
);

/** Active road manual-override picker: townships only; excludes ward/village/district/state/country, etc. */
export const roadTownshipAdminLevelWhereSql = Prisma.sql`
    lower(btrim(al.code)) NOT IN (${forbiddenAdminLevelCodesSql})
    AND (
        lower(btrim(al.code)) IN ('township', 'town')
        OR lower(btrim(al.name)) = ${ENTITY_ADMIN_AREA_TARGET_LEVEL}
    )
`;
