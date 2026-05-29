import { Prisma } from "@prisma/client";

export function shouldHidePromotedCandidates(
    includePromoted: boolean | undefined,
    promotionStatusFilter: string | undefined
): boolean {
    return includePromoted !== true && !promotionStatusFilter?.trim();
}

export function hidePromotedCandidatesSql(
    alias: string,
    cols: Set<string>,
    includePromoted: boolean | undefined,
    promotionStatusFilter: string | undefined
): Prisma.Sql | null {
    if (!shouldHidePromotedCandidates(includePromoted, promotionStatusFilter)) {
        return null;
    }
    if (!cols.has("promotion_status")) {
        return null;
    }
    return Prisma.sql`${Prisma.raw(`${alias}.promotion_status`)} IS DISTINCT FROM 'promoted'`;
}
