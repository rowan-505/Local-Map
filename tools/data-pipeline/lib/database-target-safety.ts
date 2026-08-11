/**
 * Database target safety for Node pipeline scripts.
 *
 * Canonical env names:
 *   LOCAL_DATABASE_URL
 *   SUPABASE_READ_DATABASE_URL
 *   SUPABASE_WRITE_DATABASE_URL
 *
 * Never resolve production writes from generic DATABASE_URL.
 */

export type DbTarget = "local" | "production";
export type DbTargetRole = "local" | "read" | "write";

export type ResolvedDbTarget = {
    target: DbTarget;
    role: DbTargetRole;
    url: string;
    label: string;
    projectRef: string | null;
    fingerprint: string;
    maskedUrl: string;
};

export const DEFAULT_PRODUCTION_PROJECT_REF = "locghyuranqaqsnbxflc";

export function maskDatabaseUrl(url: string): string {
    return url.replace(/^(postgres(?:ql)?:\/\/[^:/@]+):[^@]*@/i, "$1:***@");
}

export function urlFingerprint(url: string): string {
    const u = new URL(url);
    const user = decodeURIComponent(u.username || "");
    const host = (u.hostname || "").toLowerCase();
    const port = u.port || "5432";
    const db = (u.pathname || "/").replace(/^\//, "") || "postgres";
    return `${user}@${host}:${port}/${db}`;
}

export function extractProjectRef(url: string): string | null {
    const u = new URL(url);
    const user = decodeURIComponent(u.username || "");
    const mUser = /^postgres\.([a-z0-9]+)$/i.exec(user);
    if (mUser) return mUser[1]!.toLowerCase();
    const host = (u.hostname || "").toLowerCase();
    const mHost = /(?:^|\.)([a-z0-9]{20})\.supabase\.(?:co|com)$/.exec(host);
    return mHost?.[1] ?? null;
}

function env(name: string): string | undefined {
    const v = process.env[name]?.trim();
    return v || undefined;
}

export function refuseDatabaseUrlAsWriteSource(): void {
    const databaseUrl = env("DATABASE_URL");
    if (!databaseUrl) return;
    const writeUrl = env("SUPABASE_WRITE_DATABASE_URL");
    const legacyUrl = env("SUPABASE_DATABASE_URL");
    if (!writeUrl && !legacyUrl) {
        throw new Error(
            "DATABASE_URL is set but neither SUPABASE_WRITE_DATABASE_URL nor legacy SUPABASE_DATABASE_URL is set. " +
                "Refuse using DATABASE_URL as production write target."
        );
    }
}

export function resolveDbTarget(options: {
    target: DbTarget;
    role?: DbTargetRole;
    expectedProjectRef?: string;
}): ResolvedDbTarget {
    const target = options.target;
    const role: DbTargetRole =
        options.role ?? (target === "local" ? "local" : "write");
    const expectedRef =
        options.expectedProjectRef ??
        env("DB_TARGET_PRODUCTION_PROJECT_REF") ??
        DEFAULT_PRODUCTION_PROJECT_REF;

    let url: string | undefined;
    let label: string;

    if (target === "local") {
        url = env("LOCAL_DATABASE_URL");
        label = "local (LOCAL_DATABASE_URL)";
        if (!url) throw new Error("--target local requires LOCAL_DATABASE_URL");
    } else if (role === "read") {
        url = env("SUPABASE_READ_DATABASE_URL") ?? env("SUPABASE_DATABASE_URL");
        label = env("SUPABASE_READ_DATABASE_URL")
            ? "production-read (SUPABASE_READ_DATABASE_URL)"
            : "production-read (legacy SUPABASE_DATABASE_URL)";
        if (!url) {
            throw new Error(
                "production read requires SUPABASE_READ_DATABASE_URL (or legacy SUPABASE_DATABASE_URL)"
            );
        }
    } else {
        refuseDatabaseUrlAsWriteSource();
        url = env("SUPABASE_WRITE_DATABASE_URL") ?? env("SUPABASE_DATABASE_URL");
        label = env("SUPABASE_WRITE_DATABASE_URL")
            ? "production-write (SUPABASE_WRITE_DATABASE_URL)"
            : "production-write (legacy SUPABASE_DATABASE_URL)";
        if (!url) {
            throw new Error(
                "production write requires SUPABASE_WRITE_DATABASE_URL " +
                    "(legacy SUPABASE_DATABASE_URL allowed; DATABASE_URL refused)"
            );
        }
        const readUrl = env("SUPABASE_READ_DATABASE_URL");
        if (
            readUrl &&
            url === readUrl &&
            process.env.SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL !== "true"
        ) {
            throw new Error(
                "production write URL equals SUPABASE_READ_DATABASE_URL; refusing"
            );
        }
    }

    const localUrl = env("LOCAL_DATABASE_URL");
    if (localUrl && target === "production") {
        if (urlFingerprint(localUrl) === urlFingerprint(url)) {
            throw new Error(
                `LOCAL_DATABASE_URL and production URL fingerprints are identical (${urlFingerprint(url)}); refusing`
            );
        }
    }

    const projectRef = extractProjectRef(url);
    if (target === "production") {
        if (url.includes("localhost") || url.includes("127.0.0.1")) {
            throw new Error("production target URL points at localhost; refusing");
        }
        if (!url.includes(expectedRef) && projectRef !== expectedRef) {
            throw new Error(
                `production identity mismatch: expected project_ref=${expectedRef}, got ${maskDatabaseUrl(url)}`
            );
        }
    }

    return {
        target,
        role,
        url,
        label,
        projectRef: projectRef ?? (target === "production" ? expectedRef : null),
        fingerprint: urlFingerprint(url),
        maskedUrl: maskDatabaseUrl(url),
    };
}

export function printResolvedDbTarget(resolved: ResolvedDbTarget): void {
    console.log("=== database target identity ===");
    console.log(`target=${resolved.target}`);
    console.log(`target_label=${resolved.label}`);
    console.log(`target_role=${resolved.role}`);
    console.log(`database_url=${resolved.maskedUrl}`);
    if (resolved.projectRef) {
        console.log(`production_project_ref=${resolved.projectRef}`);
    }
    console.log(`production_url_fingerprint=${resolved.fingerprint}`);
    console.log("================================");
}

export function requireProductionWriteConfirmation(options: {
    mode: "dry_run" | "apply";
    confirmationExpected: string;
    confirmationGot?: string;
}): void {
    if (options.mode !== "apply") return;
    if (options.confirmationGot !== options.confirmationExpected) {
        throw new Error(
            `production apply refused: confirmation must be exactly "${options.confirmationExpected}" ` +
                `(got "${options.confirmationGot ?? "<empty>"}")`
        );
    }
}
