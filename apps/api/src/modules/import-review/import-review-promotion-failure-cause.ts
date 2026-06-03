/**
 * Extract structured failure metadata from promotion errors (Prisma / Postgres / guards).
 */

export type PromotionFailureCause = {
    message: string;
    prisma_code?: string | null;
    sqlstate?: string | null;
    constraint?: string | null;
    /** Full technical text for admin/dev only — not shown in default UI. */
    raw_message?: string | null;
};

const CONSTRAINT_RE = /constraint "([^"]+)"/i;

function firstReadableLine(text: string): string {
    const line = text
        .split(/\r?\n/)
        .map((part) => part.trim())
        .find((part) => part.length > 0);
    return line ?? text.trim();
}

function extractConstraintFromMessage(message: string | undefined): string | null {
    if (!message) {
        return null;
    }
    const match = CONSTRAINT_RE.exec(message);
    return match?.[1] ?? null;
}

function isPrismaLikeError(err: object): err is {
    code?: string;
    message?: string;
    meta?: Record<string, unknown>;
} {
    return typeof (err as { code?: unknown }).code === "string";
}

/** Parse unknown thrown values into promotion failure cause fields. */
export function extractPromotionFailureCause(err: unknown): PromotionFailureCause {
    if (err instanceof Error && isPrismaLikeError(err as object)) {
        const prismaErr = err as Error & { code?: string; meta?: Record<string, unknown> };
        const meta = prismaErr.meta;
        const sqlstate =
            typeof meta?.code === "string"
                ? meta.code
                : typeof meta?.sqlState === "string"
                  ? meta.sqlState
                  : null;
        const metaMessage = typeof meta?.message === "string" ? meta.message : prismaErr.message;
        return {
            message: firstReadableLine(metaMessage ?? prismaErr.message),
            prisma_code: prismaErr.code ?? null,
            sqlstate,
            constraint: extractConstraintFromMessage(metaMessage ?? prismaErr.message),
            raw_message: prismaErr.message,
        };
    }

    if (err && typeof err === "object" && isPrismaLikeError(err)) {
        const meta = err.meta;
        const sqlstate = typeof meta?.code === "string" ? meta.code : null;
        const metaMessage = typeof meta?.message === "string" ? meta.message : undefined;
        const message =
            typeof err.message === "string"
                ? err.message
                : metaMessage ?? JSON.stringify(err);
        return {
            message: firstReadableLine(metaMessage ?? message),
            prisma_code: err.code ?? null,
            sqlstate,
            constraint: extractConstraintFromMessage(metaMessage ?? message),
            raw_message: message,
        };
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
        message: firstReadableLine(message),
        constraint: extractConstraintFromMessage(message),
        raw_message: message,
    };
}
