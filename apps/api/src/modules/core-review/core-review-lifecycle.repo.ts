import { Prisma, type PrismaClient } from "@prisma/client";

import {
    getCoreReviewLifecycleConfig,
    type CoreReviewLifecycleConfig,
} from "./core-review-lifecycle.config.js";
import { coreReviewListStatusClause } from "./core-review-list-status.js";
import type { CoreReviewEntitySlug } from "./core-review.types.js";

export class CoreReviewLifecycleRepository {
    constructor(private readonly prisma: PrismaClient) {}

    private idWhere(config: CoreReviewLifecycleConfig, id: string, alias?: string): Prisma.Sql {
        const prefix = alias ? `${alias}.` : "";
        if (config.idKind === "public_id") {
            return Prisma.sql`${Prisma.raw(`${prefix}public_id`)} = CAST(${id} AS uuid)`;
        }
        if (!/^\d+$/.test(id)) {
            throw new Error("INVALID_NUMERIC_ID");
        }
        return Prisma.sql`${Prisma.raw(`${prefix}id`)} = ${BigInt(id)}`;
    }

    async recordExists(slug: CoreReviewEntitySlug, id: string): Promise<boolean> {
        const config = getCoreReviewLifecycleConfig(slug);
        try {
            const rows = await this.prisma.$queryRaw<{ ok: number }[]>(Prisma.sql`
                SELECT 1 AS ok
                FROM ${Prisma.raw(config.table)}
                WHERE ${this.idWhere(config, id)}
                LIMIT 1
            `);
            return rows.length > 0;
        } catch (error) {
            if (error instanceof Error && error.message === "INVALID_NUMERIC_ID") {
                return false;
            }
            throw error;
        }
    }

    async isActiveRecord(slug: CoreReviewEntitySlug, id: string): Promise<boolean | null> {
        const config = getCoreReviewLifecycleConfig(slug);
        try {
            const rows = await this.prisma.$queryRaw<{ active: boolean }[]>(Prisma.sql`
                SELECT (
                    ${coreReviewListStatusClause("r", "active", config)}
                ) AS active
                FROM ${Prisma.raw(config.table)} AS r
                WHERE ${this.idWhere(config, id, "r")}
                LIMIT 1
            `);
            return rows[0]?.active ?? null;
        } catch (error) {
            if (error instanceof Error && error.message === "INVALID_NUMERIC_ID") {
                return null;
            }
            throw error;
        }
    }

    async softDeleteGeneric(slug: CoreReviewEntitySlug, id: string): Promise<boolean> {
        const config = getCoreReviewLifecycleConfig(slug);
        const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];

        if (config.hasDeletedAt) {
            sets.push(Prisma.sql`deleted_at = now()`);
        }
        if (config.hasIsActive) {
            sets.push(Prisma.sql`is_active = false`);
        }
        if (config.softDeleteExtraSets?.length) {
            sets.push(...config.softDeleteExtraSets);
        }

        const activeClause = coreReviewListStatusClause("t", "active", config);

        const updated = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE ${Prisma.raw(config.table)} AS t
            SET ${Prisma.join(sets, ", ")}
            WHERE ${this.idWhere(config, id, "t")}
              AND (${activeClause})
        `);

        return Number(updated) > 0;
    }

    async restoreGeneric(slug: CoreReviewEntitySlug, id: string): Promise<boolean> {
        const config = getCoreReviewLifecycleConfig(slug);
        const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];

        if (config.hasDeletedAt) {
            sets.push(Prisma.sql`deleted_at = null`);
        }
        if (config.hasIsActive) {
            sets.push(Prisma.sql`is_active = true`);
        }
        if (config.restoreExtraSets?.length) {
            sets.push(...config.restoreExtraSets);
        }

        const deletedClause = coreReviewListStatusClause("t", "deleted", config);

        const updated = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE ${Prisma.raw(config.table)} AS t
            SET ${Prisma.join(sets, ", ")}
            WHERE ${this.idWhere(config, id, "t")}
              AND (${deletedClause})
        `);

        return Number(updated) > 0;
    }
}
