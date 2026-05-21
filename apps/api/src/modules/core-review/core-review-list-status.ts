import { Prisma } from "@prisma/client";

import type { CoreReviewListQueryParsed } from "./core-review.schema.js";

export type CoreReviewListStatus = "active" | "deleted" | "all";

export type CoreReviewListStatusOptions = {
    hasDeletedAt: boolean;
    hasIsActive: boolean;
};

export function resolveCoreReviewListStatus(query: CoreReviewListQueryParsed): CoreReviewListStatus {
    if (query.status !== undefined) {
        return query.status;
    }
    if (query.includeDeleted === true) {
        return "all";
    }
    return "active";
}

/** WHERE fragment for list queries (combine with AND). */
export function coreReviewListStatusClause(
    alias: string,
    status: CoreReviewListStatus,
    options: CoreReviewListStatusOptions
): Prisma.Sql {
    if (status === "all") {
        return Prisma.sql`TRUE`;
    }

    const col = (column: string) => Prisma.sql`${Prisma.raw(alias)}.${Prisma.raw(column)}`;

    if (status === "active") {
        const parts: Prisma.Sql[] = [];
        if (options.hasDeletedAt) {
            parts.push(Prisma.sql`${col("deleted_at")} IS NULL`);
        }
        if (options.hasIsActive) {
            parts.push(Prisma.sql`${col("is_active")} IS TRUE`);
        }
        if (parts.length === 0) {
            return Prisma.sql`TRUE`;
        }
        return Prisma.join(parts, " AND ");
    }

    if (options.hasDeletedAt && options.hasIsActive) {
        return Prisma.sql`(${col("deleted_at")} IS NOT NULL OR ${col("is_active")} IS FALSE)`;
    }
    if (options.hasDeletedAt) {
        return Prisma.sql`${col("deleted_at")} IS NOT NULL`;
    }
    if (options.hasIsActive) {
        return Prisma.sql`${col("is_active")} IS FALSE`;
    }

    return Prisma.sql`FALSE`;
}
