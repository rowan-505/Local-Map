import { createHash, randomBytes } from "node:crypto";

/** Refresh tokens live in app_auth.auth_sessions; default validity window. */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/** Short-lived access token lifetime (passed to reply.jwtSign expiresIn). */
export const ACCESS_TOKEN_TTL = "15m";

/**
 * Generates a high-entropy opaque refresh token (URL-safe). The raw value is
 * returned to the client once; only its hash is persisted.
 */
export function generateRefreshToken(): string {
    return randomBytes(32).toString("base64url");
}

/**
 * Deterministic SHA-256 hash for storage and lookup. Refresh tokens are random
 * and high-entropy, so a fast cryptographic hash (not a slow KDF) is correct:
 * it keeps lookups O(1) while ensuring the DB never stores the usable token.
 */
export function hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
    return new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
