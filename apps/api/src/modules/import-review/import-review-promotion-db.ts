import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Prisma client or an active transaction client.
 * Callers must only use `$queryRaw`, `$executeRaw`, and model delegates — never `$transaction`.
 */
export type DbExecutor = PrismaClient | Prisma.TransactionClient;

/** @alias DbExecutor — used by import-review promotion family repos. */
export type PromotionDb = DbExecutor;
