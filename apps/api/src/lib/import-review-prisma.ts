import { PrismaClient } from "@prisma/client";

import { prisma } from "./prisma.js";
import { applyPrismaConnectionLimit } from "./prisma.js";

const g = globalThis as typeof globalThis & {
    importReviewPrisma?: PrismaClient;
    /** True when IMPORT_REVIEW_DATABASE_URL is set and Prisma manages a distinct pool from `DATABASE_URL`. */
    importReviewPrismaIsDedicated?: boolean;
};

function resolveImportReviewDatabaseUrlBase(): string {
    const override = process.env.IMPORT_REVIEW_DATABASE_URL?.trim();
    const main = process.env.DATABASE_URL?.trim();

    const base = override ?? main;
    if (!base) {
        throw new Error(
            "Import review requires DATABASE_URL (or IMPORT_REVIEW_DATABASE_URL) to be set — expected Supabase Postgres."
        );
    }
    return base;
}

/** Connection string backing import_review.* queries (`IMPORT_REVIEW_DATABASE_URL` overrides `DATABASE_URL`). */
export function getImportReviewDatabaseUrlWithLimit(): string {
    return applyPrismaConnectionLimit(resolveImportReviewDatabaseUrlBase())!;
}

/**
 * Shared PrismaClient when DATABASE_URL resolves to the same target as import-review queries;
 * otherwise a dedicated pool for IMPORT_REVIEW_DATABASE_URL.
 */
export function getImportReviewPrisma(): PrismaClient {
    if (g.importReviewPrisma) {
        return g.importReviewPrisma;
    }

    const dedicatedOverride = !!process.env.IMPORT_REVIEW_DATABASE_URL?.trim();
    if (!dedicatedOverride) {
        g.importReviewPrisma = prisma;
        g.importReviewPrismaIsDedicated = false;
        return prisma;
    }

    const url = applyPrismaConnectionLimit(process.env.IMPORT_REVIEW_DATABASE_URL!.trim())!;
    const client = new PrismaClient({
        datasources: {
            db: { url },
        },
    });

    g.importReviewPrisma = client;
    g.importReviewPrismaIsDedicated = true;
    return client;
}

/** Disconnect dedicated import-review Prisma pools only — shared `DATABASE_URL` client is disconnected via `prisma.$disconnect`. */
export async function disconnectImportReviewPrisma(): Promise<void> {
    if (!g.importReviewPrismaIsDedicated || !g.importReviewPrisma) {
        return;
    }

    await g.importReviewPrisma.$disconnect();
    g.importReviewPrisma = undefined;
    g.importReviewPrismaIsDedicated = false;
}
