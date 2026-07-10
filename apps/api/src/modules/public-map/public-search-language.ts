import { Prisma } from "@prisma/client";

export const PUBLIC_SEARCH_LANGS = ["my", "en", "und"] as const;

export type PublicSearchLang = (typeof PUBLIC_SEARCH_LANGS)[number];

export type PublicSearchLocalizedNames = {
    displayName?: string | null;
    primaryNameMy?: string | null;
    primaryNameEn?: string | null;
    primaryNameUnd?: string | null;
};

function trimName(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Normalize optional `lang` query values; unknown values become null (index default). */
export function normalizePublicSearchLang(
    value: string | null | undefined,
): PublicSearchLang | null {
    if (value == null) return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "my" || normalized === "en" || normalized === "und") {
        return normalized;
    }
    return null;
}

/**
 * Resolve the user-facing display name without inventing translations.
 * Fallback order (always includes requested language first when set):
 *   requested primary → Myanmar → English → undetermined → indexed display_name
 */
export function resolvePublicSearchDisplayName(
    lang: PublicSearchLang | null | undefined,
    names: PublicSearchLocalizedNames,
): string | null {
    const displayName = trimName(names.displayName);
    const primaryMy = trimName(names.primaryNameMy);
    const primaryEn = trimName(names.primaryNameEn);
    const primaryUnd = trimName(names.primaryNameUnd);

    const requested =
        lang === "my" ? primaryMy : lang === "en" ? primaryEn : lang === "und" ? primaryUnd : null;

    return (
        requested ??
        primaryMy ??
        primaryEn ??
        primaryUnd ??
        displayName
    );
}

/** SQL expression for localized display names (response only — not used for cursor sort keys). */
export function buildPublicSearchLocalizedDisplayNameSql(
    lang: PublicSearchLang | null,
): Prisma.Sql {
    const trim = (column: string) =>
        Prisma.raw(`nullif(btrim(coalesce(${column}, '')), '')`);

    const primaryMy = trim("d.primary_name_my");
    const primaryEn = trim("d.primary_name_en");
    const primaryUnd = trim("d.primary_name_und");
    const displayName = trim("d.display_name");

    if (lang === "my") {
        return Prisma.sql`coalesce(${primaryMy}, ${primaryEn}, ${primaryUnd}, ${displayName})`;
    }
    if (lang === "en") {
        return Prisma.sql`coalesce(${primaryEn}, ${primaryMy}, ${primaryUnd}, ${displayName})`;
    }
    if (lang === "und") {
        return Prisma.sql`coalesce(${primaryUnd}, ${primaryMy}, ${primaryEn}, ${displayName})`;
    }

    return Prisma.sql`coalesce(${primaryMy}, ${primaryEn}, ${primaryUnd}, ${displayName})`;
}

/** Prefer matched aliases in the requested language when text relevance is tied. */
export function buildPublicSearchMatchedNameLanguageOrderSql(
    lang: PublicSearchLang | null,
): Prisma.Sql {
    if (lang === "my") {
        return Prisma.sql`CASE WHEN n.language_code = 'my' THEN 0 WHEN n.language_code = 'en' THEN 1 WHEN n.language_code = 'und' THEN 2 ELSE 3 END`;
    }
    if (lang === "en") {
        return Prisma.sql`CASE WHEN n.language_code = 'en' THEN 0 WHEN n.language_code = 'my' THEN 1 WHEN n.language_code = 'und' THEN 2 ELSE 3 END`;
    }
    if (lang === "und") {
        return Prisma.sql`CASE WHEN n.language_code = 'und' THEN 0 WHEN n.language_code = 'my' THEN 1 WHEN n.language_code = 'en' THEN 2 ELSE 3 END`;
    }
    return Prisma.sql`CASE WHEN n.language_code = 'my' THEN 0 WHEN n.language_code = 'en' THEN 1 WHEN n.language_code = 'und' THEN 2 ELSE 3 END`;
}
