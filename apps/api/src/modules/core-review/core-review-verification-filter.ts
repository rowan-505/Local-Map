import { Prisma } from "@prisma/client";
import { z } from "zod";

export const CORE_REVIEW_VERIFICATION_STATUSES = [
    "unverified",
    "verified",
    "needs_fix",
    "questionable",
    "rejected_after_core_review",
] as const;

export type CoreReviewVerificationStatus = (typeof CORE_REVIEW_VERIFICATION_STATUSES)[number];

export function normalizeCoreReviewVerificationStatus(raw: string): CoreReviewVerificationStatus | undefined {
    const value = raw.trim().toLowerCase();
    if (value === "rejected") {
        return "rejected_after_core_review";
    }
    if ((CORE_REVIEW_VERIFICATION_STATUSES as readonly string[]).includes(value)) {
        return value as CoreReviewVerificationStatus;
    }
    return undefined;
}

export const coreReviewVerificationStatusQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    return normalizeCoreReviewVerificationStatus(value);
}, z.enum(CORE_REVIEW_VERIFICATION_STATUSES).optional());

export type CoreReviewVerificationFilterParams = {
    verificationStatus?: CoreReviewVerificationStatus;
};

export function resolveCoreReviewVerificationFilter(query: {
    verificationStatus?: CoreReviewVerificationStatus;
}): CoreReviewVerificationFilterParams | undefined {
    if (!query.verificationStatus) {
        return undefined;
    }
    return { verificationStatus: query.verificationStatus };
}

function effectiveVerificationStatusExpr(alias: string): Prisma.Sql {
    return Prisma.sql`COALESCE(
        NULLIF(${Prisma.raw(alias)}.verification_status, ''),
        CASE WHEN ${Prisma.raw(alias)}.is_verified THEN 'verified' ELSE 'unverified' END
    )`;
}

/** Prefer verification_status; fall back to is_verified for verified/unverified only. */
export function coreReviewVerificationFilterCondition(
    alias: string,
    filter?: CoreReviewVerificationFilterParams
): Prisma.Sql | null {
    const resolved = filter ? resolveCoreReviewVerificationFilter(filter) : undefined;
    if (!resolved?.verificationStatus) {
        return null;
    }

    const status = resolved.verificationStatus;
    if (!status) {
        return null;
    }

    if (status === "verified" || status === "unverified") {
        return Prisma.sql`${effectiveVerificationStatusExpr(alias)} = ${status}`;
    }

    return Prisma.sql`${Prisma.raw(alias)}.verification_status = ${status}`;
}

export function coreReviewVerificationFilterClause(
    alias: string,
    filter?: CoreReviewVerificationFilterParams
): Prisma.Sql {
    const condition = coreReviewVerificationFilterCondition(alias, filter);
    return condition ? Prisma.sql`AND ${condition}` : Prisma.empty;
}
