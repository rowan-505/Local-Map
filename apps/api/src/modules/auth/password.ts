import argon2 from "argon2";
import { compare as bcryptCompare } from "bcryptjs";

/**
 * Argon2id parameters for new password hashes. Tuned for interactive login on
 * typical container memory budgets; raise memoryCost over time as infra allows.
 */
const ARGON2_OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
};

const BCRYPT_HASH_PREFIXES = ["$2a$", "$2b$", "$2y$"];

export type PasswordVerifyResult = {
    /** True when the supplied password matches the stored hash. */
    valid: boolean;
    /**
     * True when the stored hash is a legacy bcrypt hash (or outdated argon2
     * params) and should be rehashed with Argon2id after a successful login.
     */
    needsRehash: boolean;
};

export async function hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
}

function isBcryptHash(hash: string): boolean {
    return BCRYPT_HASH_PREFIXES.some((prefix) => hash.startsWith(prefix));
}

/**
 * Verifies a password against either an Argon2id hash (current) or a legacy
 * bcrypt hash (existing users only). Legacy bcrypt matches are flagged for
 * rehash so the service can transparently upgrade them to Argon2id.
 */
export async function verifyPassword(
    storedHash: string,
    plain: string
): Promise<PasswordVerifyResult> {
    if (isBcryptHash(storedHash)) {
        const valid = await bcryptCompare(plain, storedHash);
        return { valid, needsRehash: valid };
    }

    try {
        const valid = await argon2.verify(storedHash, plain);
        const needsRehash = valid && argon2.needsRehash(storedHash, ARGON2_OPTIONS);
        return { valid, needsRehash };
    } catch {
        // Malformed / unrecognized hash never authenticates.
        return { valid: false, needsRehash: false };
    }
}
