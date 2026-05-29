import { Prisma } from "@prisma/client";

import {
    appendCoreReviewVerificationSets,
    resolveCoreReviewVerificationWrite,
} from "./core-review-verification-write.js";
import { pickAlias } from "./core-review-write.schema.js";

export function resolveTransportVerification(
    body: Record<string, unknown>,
    _boolOr?: (value: unknown, fallback: boolean) => boolean,
): {
    isVerified: boolean;
    verificationStatus: string;
} {
    const resolved = resolveCoreReviewVerificationWrite(body);
    return {
        isVerified: resolved.isVerified,
        verificationStatus: resolved.verificationStatus,
    };
}

export function pickTransportConfidenceScore(body: Record<string, unknown>): number | null | undefined {
    if (pickAlias(body, "confidenceScore", "confidence_score") === undefined) {
        return undefined;
    }
    return pickAlias<number | null>(body, "confidenceScore", "confidence_score") ?? null;
}

export function appendTransportVerificationAndConfidenceSets(
    sets: Prisma.Sql[],
    body: Record<string, unknown>,
    _boolOr?: (value: unknown, fallback: boolean) => boolean,
): void {
    appendCoreReviewVerificationSets(sets, body);

    if (pickAlias(body, "confidenceScore", "confidence_score") !== undefined) {
        sets.push(
            Prisma.sql`confidence_score = ${pickAlias<number | null>(body, "confidenceScore", "confidence_score") ?? null}`,
        );
    }
}
