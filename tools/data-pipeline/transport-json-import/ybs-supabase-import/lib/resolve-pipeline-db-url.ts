/**
 * Shared YBS pipeline database URL resolution.
 *
 * See docs/database-target-safety.md for canonical env names, --target rules,
 * and why bare DATABASE_URL must not be a silent production write target.
 */

import {
    resolveDbTarget,
    type DbTarget,
    type DbTargetRole,
} from "../../../lib/database-target-safety.js";

export type PipelineDbTarget = DbTarget;

function env(name: string): string | undefined {
    const v = process.env[name]?.trim();
    return v || undefined;
}

/**
 * Preferred API: resolve via explicit --target local|production.
 * Defaults role to local for local target, write for production.
 */
export function resolvePipelineDatabaseUrl(options: {
    target: PipelineDbTarget;
    role?: DbTargetRole;
    explicit?: string;
}): string {
    if (options.explicit?.trim()) return options.explicit.trim();
    const role: DbTargetRole =
        options.role ?? (options.target === "local" ? "local" : "write");
    return resolveDbTarget({ target: options.target, role }).url;
}

/**
 * Legacy resolution without --target.
 *
 * Order: explicit → LOCAL_DATABASE_URL → SUPABASE_READ_DATABASE_URL →
 * SUPABASE_WRITE_DATABASE_URL → SUPABASE_DATABASE_URL →
 * SUPABASE_DIRECT_DATABASE_URL → SUPABASE_DB_URL → DIRECT_URL.
 *
 * Never silently uses bare DATABASE_URL unless PIPELINE_ALLOW_DATABASE_URL=true.
 * Prefer resolvePipelineDatabaseUrl({ target }) for writes.
 */
export function resolveLegacyPipelineDatabaseUrl(options?: {
    explicit?: string;
    /** When true (e.g. --execute / --apply), prefer write-oriented envs after local/read. */
    forWrite?: boolean;
}): string | undefined {
    if (options?.explicit?.trim()) return options.explicit.trim();

    const local = env("LOCAL_DATABASE_URL");
    const read = env("SUPABASE_READ_DATABASE_URL");
    const write = env("SUPABASE_WRITE_DATABASE_URL");
    const legacy =
        env("SUPABASE_DATABASE_URL") ??
        env("SUPABASE_DIRECT_DATABASE_URL") ??
        env("SUPABASE_DB_URL") ??
        env("DIRECT_URL");

    if (options?.forWrite) {
        const writeFirst = write ?? local ?? read ?? legacy;
        if (writeFirst) return writeFirst;
    } else {
        const named = local ?? read ?? write ?? legacy;
        if (named) return named;
    }

    const databaseUrl = env("DATABASE_URL");
    if (databaseUrl) {
        if (process.env.PIPELINE_ALLOW_DATABASE_URL === "true") {
            return databaseUrl;
        }
        throw new Error(
            "DATABASE_URL alone is refused as a YBS pipeline database target. " +
                "Set LOCAL_DATABASE_URL, SUPABASE_READ_DATABASE_URL, or SUPABASE_WRITE_DATABASE_URL " +
                "(legacy SUPABASE_DATABASE_URL / SUPABASE_DIRECT_DATABASE_URL / SUPABASE_DB_URL allowed), " +
                "and pass --target local|production for write-capable scripts " +
                "(use resolvePipelineDatabaseUrl). " +
                "Set PIPELINE_ALLOW_DATABASE_URL=true only for emergency override.",
        );
    }

    return undefined;
}

/** Throw with a clear message when no safe URL is configured. */
export function requirePipelineDatabaseUrl(options?: {
    explicit?: string;
    target?: PipelineDbTarget;
    role?: DbTargetRole;
    forWrite?: boolean;
}): string {
    if (options?.target) {
        return resolvePipelineDatabaseUrl({
            target: options.target,
            role:
                options.role ??
                (options.target === "local"
                    ? "local"
                    : options.forWrite === false
                      ? "read"
                      : "write"),
            explicit: options.explicit,
        });
    }

    const url = resolveLegacyPipelineDatabaseUrl({
        explicit: options?.explicit,
        forWrite: options?.forWrite,
    });
    if (!url) {
        throw new Error(
            "Missing database URL. Set LOCAL_DATABASE_URL, SUPABASE_READ_DATABASE_URL, " +
                "or SUPABASE_WRITE_DATABASE_URL (legacy SUPABASE_DATABASE_URL / SUPABASE_DIRECT_DATABASE_URL / SUPABASE_DB_URL allowed). " +
                "For writes, prefer --target local|production. Bare DATABASE_URL is refused.",
        );
    }
    return url;
}
