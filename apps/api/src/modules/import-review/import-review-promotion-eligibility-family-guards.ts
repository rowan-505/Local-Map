import { Prisma } from "@prisma/client";

import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    duplicateCoreExternalIdSql as duplicateCoreExternalIdSqlSafe,
    missingRequiredGeometrySql as missingRequiredGeometrySqlSafe,
    missingRequiredTypeCategoryClassSql as missingRequiredTypeCategoryClassSqlSafe,
} from "./import-review-promotion-eligibility-sql-helpers.js";
import {
    roadClassMissingWithoutFallbackSql,
    roadDuplicateCoreExternalIdSql,
} from "./import-review-road-promotion-policy.js";

export {
    roadDuplicateCoreExternalIdSql,
    roadClassMissingWithoutFallbackSql,
} from "./import-review-road-promotion-policy.js";

/** Column-safe duplicate external id check for eligibility details overlay. */
export function duplicateCoreExternalIdSql(
    config: ImportReviewPublishFamilyConfig,
    alias: string,
    columns: ReadonlySet<string>
): Prisma.Sql {
    if (config.entityFamily === "roads") {
        return roadDuplicateCoreExternalIdSql(alias);
    }
    return duplicateCoreExternalIdSqlSafe(config.coreTargetTable, alias, columns);
}

export function missingRequiredGeometrySql(
    config: ImportReviewPublishFamilyConfig,
    alias: string,
    columns: ReadonlySet<string>
): Prisma.Sql {
    return missingRequiredGeometrySqlSafe(config.entityFamily, alias, columns);
}

export function missingRequiredTypeCategoryClassSql(
    config: ImportReviewPublishFamilyConfig,
    alias: string,
    columns: ReadonlySet<string>
): Prisma.Sql {
    if (config.entityFamily === "roads") {
        return roadClassMissingWithoutFallbackSql(alias);
    }
    return missingRequiredTypeCategoryClassSqlSafe(config.entityFamily, alias, columns);
}
