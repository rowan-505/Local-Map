export type YbsDirectionId = 0 | 1;

export type CanonicalYbsVariantIdentity = {
    directionId: YbsDirectionId;
    directionName: "D0" | "D1";
    variantCode: string;
};

/** YBS is intentionally identified by both transport mode and canonical route-code prefix. */
export function isCanonicalYbsRoute(mode: string, routeCode: string): boolean {
    return mode === "bus" && routeCode.startsWith("YBS-");
}

/**
 * Returns the neutral canonical identity for a YBS direction id. D0/D1 do not
 * imply inbound, outbound, or any geographic meaning.
 */
export function canonicalYbsVariantIdentity(
    routeCode: string,
    directionId: number | null | undefined,
): CanonicalYbsVariantIdentity | null {
    if (directionId !== 0 && directionId !== 1) {
        return null;
    }

    const directionName = `D${directionId}` as const;
    return {
        directionId,
        directionName,
        variantCode: `${routeCode}-${directionName}`,
    };
}
