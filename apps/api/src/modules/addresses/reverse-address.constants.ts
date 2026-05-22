/** Max distance (m) for exact core address match (point or entrance). */
export const REVERSE_EXACT_ADDRESS_MAX_M = 30;

/** Prefer streets within this distance (m) for high-confidence street match. */
export const REVERSE_STREET_CLOSE_M = 100;

/** Max distance (m) for street-area fallback. */
export const REVERSE_STREET_MAX_M = 300;

/** Max distance (m) for nearby place POI. */
export const REVERSE_PLACE_MAX_M = 150;

/** Max distance (m) for nearest village locality hint (centroid). */
export const REVERSE_VILLAGE_HINT_MAX_M = 3000;

export const REVERSE_CANDIDATE_LIMIT = 8;

export const OFFICIAL_BOUNDARY_STATUSES = new Set(["official", "surveyed"]);

export const LOCALITY_HINT_BOUNDARY_STATUSES = new Set(["approximate", "settlement_extent"]);

export function isLocalityHintAdmin(boundaryStatus: string | null, addressUsage: string | null): boolean {
    const usage = (addressUsage ?? "").trim().toLowerCase();
    const status = (boundaryStatus ?? "").trim().toLowerCase();
    return (
        usage === "locality_hint" &&
        (LOCALITY_HINT_BOUNDARY_STATUSES.has(status) || status === "approximate" || status === "settlement_extent")
    );
}

export function isOfficialAdmin(boundaryStatus: string | null, addressUsage: string | null): boolean {
    const usage = (addressUsage ?? "").trim().toLowerCase();
    const status = (boundaryStatus ?? "").trim().toLowerCase();
    if (usage === "locality_hint" || usage === "search_only" || usage === "disabled") {
        return false;
    }
    if (LOCALITY_HINT_BOUNDARY_STATUSES.has(status)) {
        return false;
    }
    return usage === "official" && OFFICIAL_BOUNDARY_STATUSES.has(status);
}
