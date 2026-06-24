export type MinimalAddressInput = {
    nearbyName?: string | null;
    township?: string | null;
    district?: string | null;
    regionState?: string | null;
    country?: string | null;
};

function clean(value: string | null | undefined): string {
    return typeof value === "string" ? value.trim() : "";
}

/** Strip the "Near " prefix so a nearby name can be compared against admin parts. */
function comparableValue(part: string): string {
    return part.replace(/^Near\s+/i, "").trim().toLowerCase();
}

/**
 * Compose a single human-readable address line from a clicked point's nearby
 * landmark and admin hierarchy. Never includes plus codes or coordinates.
 */
export function composeMinimalAddressLine(input: MinimalAddressInput): string {
    const parts: string[] = [];

    const nearby = clean(input.nearbyName);
    if (nearby) {
        parts.push(`Near ${nearby}`);
    }

    const township = clean(input.township);
    if (township) {
        parts.push(township);
    }

    const district = clean(input.district);
    if (district) {
        parts.push(district);
    }

    const regionState = clean(input.regionState);
    if (regionState) {
        parts.push(regionState);
    }

    const country = clean(input.country) || "Myanmar";
    parts.push(country);

    const deduped: string[] = [];
    for (const part of parts) {
        const prev = deduped[deduped.length - 1];
        if (prev && comparableValue(prev) === comparableValue(part)) {
            continue;
        }
        deduped.push(part);
    }

    return deduped.join(", ");
}
