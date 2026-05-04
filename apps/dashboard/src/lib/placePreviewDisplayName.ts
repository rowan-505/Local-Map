export type PlacePreviewNameFields = {
    myanmarName?: string | null;
    englishName?: string | null;
    /** API may expose these instead of camelCase fields — Myanmar-first preference is unchanged */
    nameMm?: string | null;
    nameEn?: string | null;
    primary_name?: string;
    primaryName?: string;
    display_name?: string;
    displayName?: string;
};

function nonEmpty(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();

    return trimmed.length ? trimmed : null;
}

/** Single dashboard preview label: display → Myanmar → English → primary → fallback */
export function placePreviewDisplayName(place: PlacePreviewNameFields): string {
    const display = nonEmpty(place.display_name ?? place.displayName);
    if (display) {
        return display;
    }

    const mm = nonEmpty(place.myanmarName ?? place.nameMm);
    if (mm) {
        return mm;
    }

    const en = nonEmpty(place.englishName ?? place.nameEn);
    if (en) {
        return en;
    }

    const primary = nonEmpty(place.primary_name ?? place.primaryName);
    if (primary) {
        return primary;
    }

    return "Unnamed place";
}
