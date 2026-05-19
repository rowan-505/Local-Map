"use client";

/**
 * Best-effort JWT payload peek for UX only. The API remains the authorization boundary for import_review.
 */

function base64UrlToJson(raw: string): unknown {
    try {
        const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (raw.length % 4)) % 4);
        const json = decodeURIComponent(
            [...atob(padded)].map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`).join("")
        );
        return JSON.parse(json) as unknown;
    } catch {
        return null;
    }
}

export function rolesFromJwtAccessToken(token: string | null): string[] {
    if (!token?.trim()) {
        return [];
    }
    const parts = token.split(".");
    if (parts.length < 2 || !parts[1]) {
        return [];
    }
    const parsed = base64UrlToJson(parts[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return [];
    }
    const roles = (parsed as { roles?: unknown }).roles;
    if (!Array.isArray(roles)) {
        return [];
    }
    return roles.filter((r): r is string => typeof r === "string" && r.trim() !== "");
}
