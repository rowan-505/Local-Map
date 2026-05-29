import { Prisma } from "@prisma/client";

import {
    getImportTransportFamilyConfig,
    qualifiedImportTransportTable,
    type ImportTransportFamily,
} from "./import-transport.config.js";
import { IMPORT_TRANSPORT_FAMILY_ENTITY_KIND } from "./import-transport-validation.types.js";

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

export function isApprovedNotPromotedSql(alias: string): Prisma.Sql {
    return Prisma.sql`
        ${col(alias, "review_status")} = 'approved'
        AND COALESCE(${col(alias, "promotion_status")}, '') NOT IN ('promoted', 'batched')
        AND COALESCE(${col(alias, "review_status")}, '') <> 'promoted'
    `;
}

export function isBlockedValidationSql(alias: string): Prisma.Sql {
    return Prisma.sql`${col(alias, "validation_status")} IN ('blocked', 'not_validated')`;
}

export function isWarningEligibleSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "validation_status")} = 'warning'
        AND NULLIF(BTRIM(COALESCE(${col(alias, "review_note")}, '')), '') IS NOT NULL
    )`;
}

export function isValidEligibleSql(alias: string): Prisma.Sql {
    return Prisma.sql`${col(alias, "validation_status")} = 'valid'`;
}

export function isPromotionEligibleSql(alias: string, includeWarnings: boolean): Prisma.Sql {
    if (includeWarnings) {
        return Prisma.sql`(
            ${isValidEligibleSql(alias)}
            OR ${isWarningEligibleSql(alias)}
        )`;
    }
    return isValidEligibleSql(alias);
}

export function isAlreadyPromotedSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "promotion_status")} = 'promoted'
        OR ${col(alias, "review_status")} = 'promoted'
    )`;
}

export function isAlreadyBatchedSql(alias: string): Prisma.Sql {
    return Prisma.sql`${col(alias, "promotion_status")} = 'batched'`;
}

export function notInActivePromotionItemSql(
    family: ImportTransportFamily,
    alias: string,
    importBatchId: bigint
): Prisma.Sql {
    const entityKind = IMPORT_TRANSPORT_FAMILY_ENTITY_KIND[family];
    return Prisma.sql`NOT EXISTS (
        SELECT 1
        FROM import_transport.promotion_items AS pi
        INNER JOIN import_transport.promotion_batches AS pb ON pb.id = pi.promotion_batch_id
        WHERE pi.entity_kind = ${entityKind}
          AND pi.raw_entity_id = ${col(alias, "id")}
          AND pb.import_batch_id = ${importBatchId}
          AND pb.promotion_status IN ('draft', 'not_ready', 'ready', 'validating', 'promoting')
          AND pi.promotion_status NOT IN ('skipped', 'failed')
    )`;
}

export function buildReadyEligibleWhereSql(
    family: ImportTransportFamily,
    importBatchId: bigint,
    includeWarnings: boolean
): Prisma.Sql {
    const cfg = getImportTransportFamilyConfig(family);
    const alias = cfg.alias;
    return Prisma.sql`
        ${col(alias, "import_batch_id")} = ${importBatchId}
        AND ${isApprovedNotPromotedSql(alias)}
        AND NOT ${isBlockedValidationSql(alias)}
        AND ${isPromotionEligibleSql(alias, includeWarnings)}
        AND ${notInActivePromotionItemSql(family, alias, importBatchId)}
    `;
}

export function familyFromClause(family: ImportTransportFamily): string {
    return qualifiedImportTransportTable(family);
}

export function familyAlias(family: ImportTransportFamily): string {
    return getImportTransportFamilyConfig(family).alias;
}
