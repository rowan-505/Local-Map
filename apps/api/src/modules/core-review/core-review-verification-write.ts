import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
    CORE_REVIEW_VERIFICATION_STATUSES,
    normalizeCoreReviewVerificationStatus,
    type CoreReviewVerificationStatus,
} from "./core-review-verification-filter.js";

export const coreReviewVerificationStatusWriteSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value !== "string") {
        return value;
    }
    return normalizeCoreReviewVerificationStatus(value) ?? value;
}, z.enum(CORE_REVIEW_VERIFICATION_STATUSES).optional());

export const coreReviewVerificationWriteFields = {
    verificationStatus: coreReviewVerificationStatusWriteSchema,
    verification_status: coreReviewVerificationStatusWriteSchema,
} as const;

function pickVerificationStatusRaw(body: Record<string, unknown>): string | undefined {
    const camel = body.verificationStatus;
    const snake = body.verification_status;
    if (camel !== undefined && camel !== null && camel !== "") {
        return String(camel);
    }
    if (snake !== undefined && snake !== null && snake !== "") {
        return String(snake);
    }
    return undefined;
}

/** Derived compatibility flag — true only when status is verified. */
export function isVerifiedFromVerificationStatus(status: CoreReviewVerificationStatus): boolean {
    return status === "verified";
}

export function resolveCoreReviewVerificationWrite(
    body: Record<string, unknown>,
    options?: { defaultStatus?: CoreReviewVerificationStatus },
): { verificationStatus: CoreReviewVerificationStatus; isVerified: boolean } {
    const raw = pickVerificationStatusRaw(body);
    if (raw !== undefined) {
        const normalized = normalizeCoreReviewVerificationStatus(raw);
        if (!normalized) {
            throw new Error(`Invalid verification_status: ${raw}`);
        }
        return {
            verificationStatus: normalized,
            isVerified: isVerifiedFromVerificationStatus(normalized),
        };
    }

    const verificationStatus = options?.defaultStatus ?? "unverified";
    return {
        verificationStatus,
        isVerified: isVerifiedFromVerificationStatus(verificationStatus),
    };
}

/** Returns undefined when verification_status is omitted on patch bodies. */
export function pickCoreReviewVerificationWrite(
    body: Record<string, unknown>,
): { verificationStatus: CoreReviewVerificationStatus; isVerified: boolean } | undefined {
    if (pickVerificationStatusRaw(body) === undefined) {
        return undefined;
    }
    return resolveCoreReviewVerificationWrite(body);
}

export function appendCoreReviewVerificationSets(sets: Prisma.Sql[], body: Record<string, unknown>): void {
    const picked = pickCoreReviewVerificationWrite(body);
    if (!picked) {
        return;
    }
    sets.push(Prisma.sql`verification_status = ${picked.verificationStatus}`);
}

export function effectiveVerificationStatusFromRow(row: {
    verification_status?: string | null;
    is_verified?: boolean | null;
}): CoreReviewVerificationStatus {
    const normalized = row.verification_status
        ? normalizeCoreReviewVerificationStatus(String(row.verification_status))
        : undefined;
    if (normalized) {
        return normalized;
    }
    return row.is_verified ? "verified" : "unverified";
}
