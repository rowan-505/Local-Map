import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/** Number of decimal digits in a generated OTP code. */
const OTP_DIGITS = 6;

/**
 * Generates a cryptographically random 6-digit numeric code (zero-padded).
 * Uses crypto.randomInt for uniform, unbiased selection.
 */
export function generateOtpCode(): string {
    const max = 10 ** OTP_DIGITS;
    return randomInt(0, max)
        .toString()
        .padStart(OTP_DIGITS, "0");
}

/**
 * HMAC-SHA256 of the OTP code, keyed by a server secret. Only this hash is ever
 * persisted; the raw code never touches the database or logs.
 */
export function hashOtp(code: string, secret: string): string {
    return createHmac("sha256", secret).update(code).digest("hex");
}

/** Constant-time comparison of two hex digests. Returns false on length mismatch. */
export function safeCompareHex(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, "hex");
    const bufferB = Buffer.from(b, "hex");

    if (bufferA.length === 0 || bufferA.length !== bufferB.length) {
        return false;
    }

    return timingSafeEqual(bufferA, bufferB);
}
