/** Myanmar script block — used to classify name_mm vs name_en fallbacks. */
export const MYANMAR_SCRIPT_RE = /[\u1000-\u109F]/;

/** OSM / pipeline classification keys — never treated as reviewer-facing names. */
export const IMPORT_REVIEW_CLASSIFICATION_FIELD_KEYS = [
    "class_code",
    "waterway",
    "water",
    "landuse",
    "natural",
    "amenity",
    "leisure",
    "crop",
    "military",
    "aeroway",
    "barrier",
    "barrier_type",
    "building",
    "highway",
    "route_type",
    "road_class",
    "admin_level",
    "external_id",
] as const;

/**
 * Controlled landuse / OSM category slugs — never feature display names.
 * Matches ref.ref_landuse_classes leaf/parent codes and common import class_code values.
 */
export const IMPORT_REVIEW_LANDUSE_CLASS_CODES = [
    "residential",
    "industrial",
    "commercial",
    "retail",
    "farmland",
    "paddy",
    "orchard",
    "aquaculture",
    "farmyard",
    "education",
    "healthcare",
    "religious",
    "cemetery",
    "military",
    "transport",
    "construction",
    "park",
    "recreation_ground",
    "forest",
    "grassland",
    "grass",
    "vacant",
    "other",
    "wood",
] as const;

const LANDUSE_CLASS_CODE_SET = new Set<string>(IMPORT_REVIEW_LANDUSE_CLASS_CODES);

export function isKnownLanduseClassCode(value: unknown): boolean {
    const s = trimString(value);
    return s !== null && LANDUSE_CLASS_CODE_SET.has(s.toLowerCase());
}

const MYANMAR_NAME_TAG_KEYS = ["name:my", "name:mm", "name:my-MM"] as const;

const ENGLISH_NAME_TAG_KEYS = ["name:en"] as const;

const LATIN_FALLBACK_NAME_TAG_KEYS = ["name:my-Latn", "official_name", "alt_name"] as const;

const CHILD_NAME_CANDIDATE_ARRAY_KEYS = [
    "place_name_candidates",
    "road_name_candidates",
    "bus_stop_name_candidates",
    "names",
    "name_candidates",
] as const;

export function isMyanmarScript(text: string): boolean {
    return MYANMAR_SCRIPT_RE.test(text);
}

export function trimString(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const s = String(value).trim();
    return s.length > 0 ? s : null;
}

export function normPick(data: unknown, key: string): unknown {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return undefined;
    }
    const o = data as Record<string, unknown>;
    if (key in o) {
        return o[key];
    }
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel in o) {
        return o[camel];
    }
    return undefined;
}

function normTagPick(data: unknown, tagKey: string): string | null {
    const tags = normPick(data, "tags");
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
        return trimString((tags as Record<string, unknown>)[tagKey]);
    }
    return null;
}

/** OSM / pipeline refs stored in name columns — not reviewer-facing labels. */
export function looksLikeExternalRef(value: string): boolean {
    const s = value.trim();
    if (s.length === 0) {
        return false;
    }
    if (/^osm:/i.test(s)) {
        return true;
    }
    if (/^(node|way|relation)\/\d+$/i.test(s)) {
        return true;
    }
    return false;
}

export type ImportReviewNameCandidate = {
    review_overrides?: unknown;
    canonical_name?: string | null;
    normalized_data?: unknown;
    external_id?: string | null;
    class_code?: string | null;
    /** Legacy import_review.name column — may echo class_code; never use as label when blocked. */
    name?: string | null;
    name_local?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
};

export type ImportReviewDerivedNames = {
    name_mm: string | null;
    name_en: string | null;
    /** tags.name (or equivalent) when language/script is unclear — not a class/category slug. */
    name_und: string | null;
};

/** @deprecated Prefer ImportReviewNameCandidate */
export type ImportReviewNameSourceRow = ImportReviewNameCandidate;

function asOverrideRecord(review_overrides: unknown): Record<string, unknown> {
    if (review_overrides && typeof review_overrides === "object" && !Array.isArray(review_overrides)) {
        return review_overrides as Record<string, unknown>;
    }
    return {};
}

function addClassificationValue(blocked: Set<string>, value: unknown): void {
    const s = trimString(value);
    if (s) {
        blocked.add(s.toLowerCase());
    }
}

/** Collect classification/type values from row columns and normalized_data (incl. tags). */
export function collectImportReviewClassificationValues(candidate: ImportReviewNameCandidate): Set<string> {
    const blocked = new Set<string>();

    for (const code of IMPORT_REVIEW_LANDUSE_CLASS_CODES) {
        blocked.add(code);
    }

    addClassificationValue(blocked, candidate.class_code);
    addClassificationValue(blocked, candidate.external_id);

    if (isKnownLanduseClassCode(candidate.canonical_name)) {
        addClassificationValue(blocked, candidate.canonical_name);
    }
    if (isKnownLanduseClassCode(candidate.name)) {
        addClassificationValue(blocked, candidate.name);
    }
    const classCode = trimString(candidate.class_code)?.toLowerCase();
    if (classCode) {
        const canonical = trimString(candidate.canonical_name)?.toLowerCase();
        const rowName = trimString(candidate.name)?.toLowerCase();
        if (canonical === classCode) {
            addClassificationValue(blocked, candidate.canonical_name);
        }
        if (rowName === classCode) {
            addClassificationValue(blocked, candidate.name);
        }
    }

    const nd = candidate.normalized_data;
    if (nd && typeof nd === "object" && !Array.isArray(nd)) {
        const root = nd as Record<string, unknown>;
        for (const key of IMPORT_REVIEW_CLASSIFICATION_FIELD_KEYS) {
            addClassificationValue(blocked, root[key]);
        }
        const tags = root.tags;
        if (tags && typeof tags === "object" && !Array.isArray(tags)) {
            for (const key of IMPORT_REVIEW_CLASSIFICATION_FIELD_KEYS) {
                addClassificationValue(blocked, (tags as Record<string, unknown>)[key]);
            }
        }
    }

    return blocked;
}

function isBlockedClassificationValue(value: string, blocked: Set<string>): boolean {
    return blocked.has(value.trim().toLowerCase());
}

function isReviewerFacingName(value: unknown, blocked: Set<string>): string | null {
    const s = trimString(value);
    if (!s || looksLikeExternalRef(s) || isBlockedClassificationValue(s, blocked)) {
        return null;
    }
    return s;
}

function firstAccepted(...values: Array<string | null | undefined>): string | null {
    for (const v of values) {
        if (v) {
            return v;
        }
    }
    return null;
}

function acceptMyanmarName(value: unknown, blocked: Set<string>): string | null {
    const s = isReviewerFacingName(value, blocked);
    return s && isMyanmarScript(s) ? s : null;
}

function acceptLatinName(value: unknown, blocked: Set<string>): string | null {
    const s = isReviewerFacingName(value, blocked);
    return s && !isMyanmarScript(s) ? s : null;
}

function pickChildNameByLanguage(
    normalized_data: unknown,
    languageCodes: readonly string[],
    script: "myanmar" | "latin",
    blocked: Set<string>
): string | null {
    for (const key of CHILD_NAME_CANDIDATE_ARRAY_KEYS) {
        const arr = normPick(normalized_data, key);
        if (!Array.isArray(arr)) {
            continue;
        }
        for (const entry of arr) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                continue;
            }
            const row = entry as Record<string, unknown>;
            const lang = trimString(row.language_code ?? row.lang)?.toLowerCase();
            if (!lang || !languageCodes.includes(lang)) {
                continue;
            }
            const name =
                script === "myanmar"
                    ? acceptMyanmarName(row.name, blocked)
                    : acceptLatinName(row.name, blocked);
            if (name) {
                return name;
            }
        }
    }
    return null;
}

function pickMyanmarTagNames(nd: unknown, blocked: Set<string>): string | null {
    for (const key of MYANMAR_NAME_TAG_KEYS) {
        const accepted = acceptMyanmarName(normTagPick(nd, key), blocked);
        if (accepted) {
            return accepted;
        }
    }
    return null;
}

function pickEnglishTagNames(nd: unknown, blocked: Set<string>): string | null {
    for (const key of ENGLISH_NAME_TAG_KEYS) {
        const accepted = acceptLatinName(normTagPick(nd, key), blocked);
        if (accepted) {
            return accepted;
        }
    }
    return null;
}

function pickLatinFallbackTagNames(nd: unknown, blocked: Set<string>): string | null {
    for (const key of LATIN_FALLBACK_NAME_TAG_KEYS) {
        const accepted = acceptLatinName(normTagPick(nd, key), blocked);
        if (accepted) {
            return accepted;
        }
    }
    return null;
}

function pickGenericNameTag(nd: unknown, blocked: Set<string>, script: "myanmar" | "latin"): string | null {
    const fromTag = normTagPick(nd, "name");
    return script === "myanmar" ? acceptMyanmarName(fromTag, blocked) : acceptLatinName(fromTag, blocked);
}

function pickStoredExtractedName(
    nd: unknown,
    blocked: Set<string>,
    script: "myanmar" | "latin",
    key: "name_mm" | "name_en"
): string | null {
    const stored = normPick(nd, key);
    return script === "myanmar" ? acceptMyanmarName(stored, blocked) : acceptLatinName(stored, blocked);
}

function pickRawNameCandidate(candidate: ImportReviewNameCandidate): string | null {
    const nd = candidate.normalized_data;
    return firstAccepted(
        normTagPick(nd, "name"),
        trimString(normPick(nd, "name")),
        trimString(candidate.canonical_name),
        trimString(candidate.name)
    );
}

/** Imported Myanmar label from OSM tags / normalized_data (no review_overrides). */
export function deriveImportedNameMm(candidate: ImportReviewNameCandidate): string | null {
    const blocked = collectImportReviewClassificationValues(candidate);
    const nd = candidate.normalized_data;

    return firstAccepted(
        pickStoredExtractedName(nd, blocked, "myanmar", "name_mm"),
        pickMyanmarTagNames(nd, blocked),
        pickGenericNameTag(nd, blocked, "myanmar"),
        acceptMyanmarName(normPick(nd, "name"), blocked),
        acceptMyanmarName(candidate.canonical_name, blocked),
        acceptMyanmarName(candidate.name, blocked),
        pickChildNameByLanguage(nd, ["my", "mm"], "myanmar", blocked)
    );
}

/** Imported English/Latin label from OSM tags / normalized_data (no review_overrides). */
export function deriveImportedNameEn(candidate: ImportReviewNameCandidate): string | null {
    const blocked = collectImportReviewClassificationValues(candidate);
    const nd = candidate.normalized_data;

    return firstAccepted(
        pickStoredExtractedName(nd, blocked, "latin", "name_en"),
        pickEnglishTagNames(nd, blocked),
        pickGenericNameTag(nd, blocked, "latin"),
        acceptLatinName(normPick(nd, "name"), blocked),
        acceptLatinName(candidate.canonical_name, blocked),
        acceptLatinName(candidate.name, blocked),
        pickLatinFallbackTagNames(nd, blocked),
        pickChildNameByLanguage(nd, ["en"], "latin", blocked)
    );
}

/** Preserve tags.name when script/language is unclear and it is not a class/category slug. */
export function deriveImportedNameUnd(
    candidate: ImportReviewNameCandidate,
    resolved?: { name_mm?: string | null; name_en?: string | null }
): string | null {
    const blocked = collectImportReviewClassificationValues(candidate);
    const nd = candidate.normalized_data;

    const stored = trimString(normPick(nd, "name_und"));
    if (stored) {
        return isReviewerFacingName(stored, blocked);
    }

    const fromChild = pickChildNameByLanguage(nd, ["und"], "latin", blocked);
    if (fromChild) {
        return fromChild;
    }
    const fromChildMm = pickChildNameByLanguage(nd, ["und"], "myanmar", blocked);
    if (fromChildMm) {
        return fromChildMm;
    }

    const nameMm = resolved?.name_mm ?? deriveImportedNameMm(candidate);
    const nameEn = resolved?.name_en ?? deriveImportedNameEn(candidate);
    const raw = pickRawNameCandidate(candidate);
    if (!raw) {
        return null;
    }
    if (raw === nameMm || raw === nameEn) {
        return null;
    }
    if (!isReviewerFacingName(raw, blocked)) {
        return null;
    }
    if (acceptMyanmarName(raw, blocked) === raw || acceptLatinName(raw, blocked) === raw) {
        return null;
    }
    return raw;
}

function overrideString(overrides: Record<string, unknown>, key: string): string | null | undefined {
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
        return undefined;
    }
    const v = overrides[key];
    if (v === null || v === undefined) {
        return null;
    }
    return trimString(v);
}

/** Effective Myanmar name: review_overrides.name_mm wins, then legacy keys, then imported. */
export function pickEffectiveNameMm(
    overrides: Record<string, unknown>,
    candidate: ImportReviewNameCandidate
): string | null {
    const blocked = collectImportReviewClassificationValues(candidate);

    const direct = overrideString(overrides, "name_mm");
    if (direct !== undefined) {
        return direct === null ? null : isReviewerFacingName(direct, blocked);
    }

    for (const key of ["name_local", "name", "canonical_name"] as const) {
        const v = overrideString(overrides, key);
        if (v === undefined) {
            continue;
        }
        if (v === null) {
            return null;
        }
        const accepted = isReviewerFacingName(v, blocked);
        if (!accepted) {
            continue;
        }
        if (key === "name_local" || isMyanmarScript(accepted)) {
            return accepted;
        }
    }

    return deriveImportedNameMm(candidate);
}

/** Effective English name: review_overrides.name_en wins, then legacy keys, then imported. */
export function pickEffectiveNameEn(
    overrides: Record<string, unknown>,
    candidate: ImportReviewNameCandidate
): string | null {
    const blocked = collectImportReviewClassificationValues(candidate);

    const direct = overrideString(overrides, "name_en");
    if (direct !== undefined) {
        return direct === null ? null : isReviewerFacingName(direct, blocked);
    }

    for (const key of ["name", "canonical_name", "name_local", "primary_name", "display_name"] as const) {
        const v = overrideString(overrides, key);
        if (v === undefined) {
            continue;
        }
        if (v === null) {
            return null;
        }
        const accepted = isReviewerFacingName(v, blocked);
        if (!accepted) {
            continue;
        }
        if (key === "name_local") {
            if (!isMyanmarScript(accepted)) {
                return accepted;
            }
            continue;
        }
        if (!isMyanmarScript(accepted)) {
            return accepted;
        }
    }

    return deriveImportedNameEn(candidate);
}

export function deriveImportReviewNames(candidate: ImportReviewNameCandidate): ImportReviewDerivedNames {
    const overrides = asOverrideRecord(candidate.review_overrides);
    const name_mm = pickEffectiveNameMm(overrides, candidate);
    const name_en = pickEffectiveNameEn(overrides, candidate);
    return {
        name_mm,
        name_en,
        name_und: deriveImportedNameUnd(candidate, { name_mm, name_en }),
    };
}

export function pickEffectiveDisplayName(
    overrides: Record<string, unknown>,
    candidate: ImportReviewNameCandidate
): string | null {
    return pickEffectiveNameEn(overrides, candidate) ?? pickEffectiveNameMm(overrides, candidate);
}

/** Read override draft for name_mm (checks new + legacy override keys). */
export function readOverrideNameMm(
    overrides: Record<string, unknown>,
    candidate: ImportReviewNameCandidate
): string {
    const v = pickEffectiveNameMm(overrides, candidate);
    return v ?? "";
}

/** Read override draft for name_en (checks new + legacy override keys). */
export function readOverrideNameEn(
    overrides: Record<string, unknown>,
    candidate: ImportReviewNameCandidate
): string {
    const v = pickEffectiveNameEn(overrides, candidate);
    return v ?? "";
}

/** Whether review_overrides explicitly sets name_mm (new or legacy). */
export function hasStoredNameMmOverride(overrides: Record<string, unknown>): boolean {
    return (
        Object.prototype.hasOwnProperty.call(overrides, "name_mm") ||
        Object.prototype.hasOwnProperty.call(overrides, "name_local") ||
        (Object.prototype.hasOwnProperty.call(overrides, "name") &&
            isMyanmarScript(trimString(overrides.name) ?? "")) ||
        (Object.prototype.hasOwnProperty.call(overrides, "canonical_name") &&
            isMyanmarScript(trimString(overrides.canonical_name) ?? ""))
    );
}

/** Whether review_overrides explicitly sets name_en (new or legacy). */
export function hasStoredNameEnOverride(overrides: Record<string, unknown>): boolean {
    return (
        Object.prototype.hasOwnProperty.call(overrides, "name_en") ||
        Object.prototype.hasOwnProperty.call(overrides, "name") ||
        Object.prototype.hasOwnProperty.call(overrides, "canonical_name") ||
        Object.prototype.hasOwnProperty.call(overrides, "primary_name") ||
        Object.prototype.hasOwnProperty.call(overrides, "display_name")
    );
}
