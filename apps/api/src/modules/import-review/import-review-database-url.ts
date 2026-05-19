import type { PrismaClient } from "@prisma/client";

export type ParsedImportReviewDbTarget = {
    host: string;
    port: string;
    database: string;
    user: string;
    sslmode: string;
};

export function getImportReviewDatabaseEnvSource(): "IMPORT_REVIEW_DATABASE_URL" | "DATABASE_URL" {
    return process.env.IMPORT_REVIEW_DATABASE_URL?.trim()
        ? "IMPORT_REVIEW_DATABASE_URL"
        : "DATABASE_URL";
}

/** Untrimmed-connection-string base (`IMPORT_REVIEW_DATABASE_URL` wins over `DATABASE_URL`). */
export function getImportReviewDatabaseUrlBase(): string {
    const override = process.env.IMPORT_REVIEW_DATABASE_URL?.trim();
    const main = process.env.DATABASE_URL?.trim();
    const base = override ?? main ?? "";
    if (!base) {
        throw new Error(
            "Import review requires DATABASE_URL (or IMPORT_REVIEW_DATABASE_URL) set to Supabase Postgres."
        );
    }
    return base;
}

/** Parse Postgres URL with password stripped from output — intended for structured logs only. */
export function parsePostgresUrlSanitized(urlStr: string): ParsedImportReviewDbTarget | null {
    const trimmed = urlStr.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const normalized = trimmed.replace(/^postgres(ql)?:/i, "http:");
        const u = new URL(normalized);

        let dbSegment = u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname;
        dbSegment = dbSegment.split("/")[0] ?? "";
        if (dbSegment.includes("?")) {
            dbSegment = dbSegment.split("?")[0] ?? "";
        }

        return {
            host: u.hostname || "(unknown)",
            port: u.port || "5432",
            database: decodeURIComponent(dbSegment || "(unknown)"),
            user: decodeURIComponent(u.username || "(unknown)"),
            sslmode: u.searchParams.get("sslmode") ?? "(default)",
        };
    } catch {
        return null;
    }
}

export function throwIfImportReviewProductionLocalhostMismatch(): void {
    const url = parsePostgresUrlSanitized(getImportReviewDatabaseUrlBase());
    if (!url || process.env.NODE_ENV !== "production") {
        return;
    }

    const h = url.host.toLowerCase();
    const isLocal =
        h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost") || h === "::1";

    if (isLocal) {
        throw new Error(
            "Import review SAFETY_BLOCK: DATABASE_URL/import-review host is localhost while NODE_ENV=production. Point import review at Supabase."
        );
    }
}

/** Fails startup when migration 024 (`import_review` schema) is missing. */
export async function verifyImportReviewSchemaOrThrow(prismaClient: PrismaClient): Promise<void> {
    const rows = await prismaClient.$queryRaw<{ ns: bigint | null }[]>`
        SELECT CAST(to_regnamespace('import_review') AS BIGINT) AS ns
    `;
    const ns = rows[0]?.ns ?? null;
    const ok = ns != null && ns !== BigInt(0);

    if (!ok) {
        throw new Error(
            "Supabase import_review schema not found. Run the Supabase import_review migration first."
        );
    }
}

/** Dev diagnostics: log recent batches when resolving source_snapshot_version fails. */
export async function logImportReviewBatchResolveHintsDev(
    prismaClient: PrismaClient,
    requested: string
): Promise<void> {
    if (process.env.NODE_ENV === "production") {
        return;
    }

    try {
        const batches = await prismaClient.$queryRaw<
            {
                id: bigint;
                source_snapshot_version: string;
                uploaded_at: Date;
            }[]
        >`
            SELECT id, source_snapshot_version, uploaded_at
            FROM import_review.review_batches
            ORDER BY uploaded_at DESC
            LIMIT 8
        `;

        // eslint-disable-next-line no-console
        console.warn(
            JSON.stringify({
                event: "import_review.snapshot_resolve_miss",
                requestedSourceSnapshotVersion: requested,
                latestBatches: batches.map((b) => ({
                    id: String(b.id),
                    source_snapshot_version: b.source_snapshot_version,
                    uploaded_at: b.uploaded_at.toISOString(),
                })),
            })
        );
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
            JSON.stringify({
                event: "import_review.snapshot_resolve_miss_diagnostics_failed",
                requestedSourceSnapshotVersion: requested,
                message: err instanceof Error ? err.message : String(err),
            })
        );
    }
}
