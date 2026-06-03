import { Prisma } from "@prisma/client";

export type PrismaRawQueryErrorDetails = {
    prisma_code: string;
    sqlstate: string | null;
    database_message: string | null;
    constraint_name: string | null;
    table_name: string | null;
    column_name: string | null;
};

/** Extract PostgreSQL details from Prisma raw-query failures (P2010). */
export function extractPrismaRawQueryErrorDetails(error: unknown): PrismaRawQueryErrorDetails | null {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2010") {
        return null;
    }
    const meta = error.meta as { code?: string; message?: string } | undefined;
    const databaseMessage =
        typeof meta?.message === "string" && meta.message.trim() !== "" ? meta.message.trim() : null;
    const sqlstate = typeof meta?.code === "string" && meta.code.trim() !== "" ? meta.code.trim() : null;
    const parsed = databaseMessage ? parsePostgresErrorMessage(databaseMessage) : {};
    return {
        prisma_code: error.code,
        sqlstate,
        database_message: databaseMessage,
        constraint_name: parsed.constraint_name ?? null,
        table_name: parsed.table_name ?? null,
        column_name: parsed.column_name ?? null,
    };
}

function parsePostgresErrorMessage(message: string): {
    constraint_name?: string;
    table_name?: string;
    column_name?: string;
} {
    const lower = message.toLowerCase();
    const out: {
        constraint_name?: string;
        table_name?: string;
        column_name?: string;
    } = {};

    const missingColumn = /column "([^"]+)" does not exist/i.exec(message);
    if (missingColumn) {
        out.column_name = missingColumn[1];
    }

    const checkConstraint =
        /violates check constraint "([^"]+)"/i.exec(message) ??
        /check constraint "([^"]+)"/i.exec(message);
    if (checkConstraint) {
        out.constraint_name = checkConstraint[1];
    }

    const relation =
        /relation "([^"]+)"/i.exec(message) ?? /for relation "([^"]+)"/i.exec(message);
    if (relation) {
        out.table_name = relation[1];
    }

    if (!out.column_name && lower.includes("does not exist") && /column/i.test(message)) {
        const loose = /column ([^\s]+) does not exist/i.exec(message);
        if (loose) {
            out.column_name = loose[1].replace(/^"|"$/g, "");
        }
    }

    return out;
}
