import type { ValidationIssue } from "../../lib/core-review/ref-validation.js";

/** Build a user-facing validation headline from structured issues. */
export function validationMessageFromIssues(issues: ValidationIssue[], fallback = "Validation failed"): string {
    if (issues.length === 0) {
        return fallback;
    }
    if (issues.length === 1) {
        const issue = issues[0]!;
        return issue.path ? `${issue.path}: ${issue.message}` : issue.message;
    }
    return `${fallback}: ${issues.map((i) => (i.path ? `${i.path} — ${i.message}` : i.message)).join("; ")}`;
}

/** Derive a URL-safe slug from a canonical admin area name. */
export function slugFromCanonicalName(name: string): string {
    const base = name
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return base || `admin-area-${Date.now()}`;
}

export function pickTrimmedAlias(
    body: Record<string, unknown>,
    camel: string,
    snake: string,
): string | undefined {
    const raw = body[camel] ?? body[snake];
    if (raw === undefined || raw === null) {
        return undefined;
    }
    const trimmed = String(raw).trim();
    return trimmed === "" ? undefined : trimmed;
}

function extractPrismaRawQueryMeta(error: unknown): { code?: string; message?: string } | null {
    if (!error || typeof error !== "object") {
        return null;
    }
    const prisma = error as { code?: string; meta?: { code?: string; message?: string } };
    if (prisma.code === "P2010" && prisma.meta) {
        return { code: prisma.meta.code, message: prisma.meta.message };
    }
    return null;
}

/** Strip secrets from dev-only database error text before returning to clients. */
export function sanitizeDevWriteErrorMessage(message: string): string {
    return message
        .replace(/postgresql:\/\/[^\s'"]+/gi, "[database-url]")
        .replace(/password=[^\s&'"]+/gi, "password=[redacted]")
        .slice(0, 500);
}

/** Map common Postgres / Prisma write failures to client-safe 400 responses. */
export function mapDatabaseWriteError(error: unknown): { message: string; issues: ValidationIssue[] } | null {
    const prismaMeta = extractPrismaRawQueryMeta(error);
    const message = prismaMeta?.message ?? (error instanceof Error ? error.message : String(error ?? ""));
    const fullMessage = error instanceof Error ? error.message : String(error ?? "");
    const lower = message.toLowerCase();
    const pgCode = prismaMeta?.code;

    if (pgCode === "23502" || /\b23502\b/.test(fullMessage)) {
        const column =
            /null value in column "([^"]+)"/i.exec(message)?.[1] ??
            /null value in column "([^"]+)"/i.exec(fullMessage)?.[1];
        if (column) {
            return {
                message: `${column} is required`,
                issues: [{ path: column, message: "Required" }],
            };
        }
        if (/failing row contains \(\d+, null, null,/i.test(message)) {
            return {
                message:
                    "Dashboard-created landuse requires nullable source_staging_id and external_id (apply migration 036_core_map_features_nullable_dashboard.sql).",
                issues: [
                    {
                        path: "source_staging_id",
                        message: "NOT NULL constraint — apply database migration 036",
                    },
                    {
                        path: "external_id",
                        message: "NOT NULL constraint — apply database migration 036",
                    },
                ],
            };
        }
    }

    if (/null value in column "([^"]+)"/i.test(message)) {
        const column = /null value in column "([^"]+)"/i.exec(message)?.[1] ?? "field";
        return {
            message: `${column} is required`,
            issues: [{ path: column, message: "Required" }],
        };
    }

    if (/violates check constraint/i.test(lower)) {
        if (/canonical_name/i.test(message)) {
            return {
                message: "canonical_name is required",
                issues: [{ path: "canonicalName", message: "Must not be empty" }],
            };
        }
        if (/slug/i.test(message)) {
            return {
                message: "slug is required",
                issues: [{ path: "slug", message: "Must not be empty" }],
            };
        }
        if (/class_code/i.test(message)) {
            return {
                message: "class_code is required",
                issues: [{ path: "classCode", message: "Must not be empty" }],
            };
        }
        return {
            message: "One or more fields failed database validation",
            issues: [{ path: "payload", message: "Check required fields and geometry" }],
        };
    }

    if (/violates foreign key constraint/i.test(lower)) {
        return {
            message: "A referenced field is invalid",
            issues: [{ path: "references", message: "Foreign key validation failed" }],
        };
    }

    return null;
}
