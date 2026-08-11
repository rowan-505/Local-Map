/** Canonical Myanmar/Burmese language code for name tables. */
export const MYANMAR_LANGUAGE_CODE = "my" as const;

/** Myanmar language codes accepted when reading legacy/imported rows. */
export const MYANMAR_LANGUAGE_CODES = [MYANMAR_LANGUAGE_CODE] as const;

export const ENGLISH_LANGUAGE_CODE = "en" as const;

export const UNKNOWN_LANGUAGE_CODE = "und" as const;

export function trimName(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

/** Map label fallback: mm → en → legacy column value. */
export function deriveCoalescedDisplayName(args: {
    name_mm: string | null | undefined;
    name_en: string | null | undefined;
    fallback_name: string | null | undefined;
}): string | null {
    return trimName(args.name_mm) ?? trimName(args.name_en) ?? trimName(args.fallback_name);
}

type BuildingDisplayNameCandidate = {
    name: string;
    nameType: string;
    isPrimary: boolean;
    searchWeight?: number;
};

/**
 * Display-name priority for building names table rows:
 * official primary → local primary → imported primary → alternate → any.
 */
export function deriveBuildingDisplayNameFromPriority(
    names: BuildingDisplayNameCandidate[]
): string | null {
    const order = (n: BuildingDisplayNameCandidate): number => {
        if (n.nameType === "official" && n.isPrimary) return 0;
        if (n.nameType === "local" && n.isPrimary) return 1;
        if (n.nameType === "imported" && n.isPrimary) return 2;
        if (n.nameType === "alternate") return 3;
        return 4;
    };
    const sorted = [...names].sort(
        (a, b) =>
            order(a) - order(b) || (b.searchWeight ?? 0) - (a.searchWeight ?? 0)
    );
    return trimName(sorted[0]?.name);
}
