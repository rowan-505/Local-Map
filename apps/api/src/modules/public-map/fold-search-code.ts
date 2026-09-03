/**
 * Collapse hyphen/underscore/space so YBS-37, YBS 37, and ybs_37 compare equal.
 * Does not invent a bare numeric alias (37).
 */
export function foldSearchCode(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase().replace(/[-_\s]+/g, "");
}

/** Bare route-number intent. One-character queries remain governed by the short-query guard. */
export function isNumericTransportQuery(value: string | null | undefined): boolean {
    return /^\d{2,}$/.test((value ?? "").trim());
}

/** Canonical route documents eligible for the numeric route-number boost. */
export function isTransportRouteEntityType(value: string | null | undefined): boolean {
    const normalized = (value ?? "").trim().toLowerCase();
    return normalized === "transport_route" || normalized === "bus_route";
}

/**
 * Match a bare numeric query to the final, delimiter-bounded part of a route code.
 * Thus `13` matches `YBS-13` and `13`, but not `YBS-113`, `213`, or `130`.
 */
export function isExactNumericTransportRouteCode(
    query: string,
    entityType: string | null | undefined,
    code: string | null | undefined,
): boolean {
    if (!isNumericTransportQuery(query) || !isTransportRouteEntityType(entityType)) {
        return false;
    }

    const normalizedCode = (code ?? "").trim().toLowerCase();
    if (!normalizedCode) return false;
    const routeNumber = normalizedCode.split(/[-_\s]+/).at(-1);
    return routeNumber === query.trim();
}
