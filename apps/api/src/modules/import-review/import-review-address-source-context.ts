const SOURCE_TYPE_TAG_KEYS = [
    "amenity",
    "shop",
    "tourism",
    "leisure",
    "office",
    "public_transport",
    "highway",
    "religion",
    "building",
] as const;

const SOURCE_CATEGORY_TAG_KEYS = ["amenity", "shop", "tourism", "religion", "denomination"] as const;

const RAW_RELEVANT_TAG_KEYS = [
    "name",
    "name:en",
    "name:my",
    "name:mm",
    ...SOURCE_TYPE_TAG_KEYS,
    ...SOURCE_CATEGORY_TAG_KEYS,
    "phone",
    "email",
    "opening_hours",
    "operator",
    "brand",
    "website",
] as const;

export type AddressSourceContext = {
    source_name: string | null;
    source_name_en: string | null;
    source_name_my: string | null;
    source_type_hint: string | null;
    source_category_hint: string | null;
    phone: string | null;
    email: string | null;
    opening_hours: string | null;
    raw_relevant_tags: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** OSM tags may live on source_tags, normalized_data.tags, or source_refs.tags. */
function extractTagsObject(src: unknown): Record<string, unknown> | null {
    if (!isRecord(src)) {
        return null;
    }
    if (isRecord(src.tags)) {
        return src.tags;
    }
    return src;
}

/**
 * Merges tag layers; later layers override earlier for non-empty string values.
 * Typical order: normalized_data → source_refs → source_tags.
 */
export function mergeAddressSourceTagLayers(...layers: unknown[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const layer of layers) {
        const tags = extractTagsObject(layer);
        if (tags === null) {
            continue;
        }
        for (const [key, value] of Object.entries(tags)) {
            if (typeof value === "string") {
                const trimmed = value.trim();
                if (trimmed !== "") {
                    merged[key] = trimmed;
                }
            } else if (!(key in merged) && value !== null && value !== undefined) {
                merged[key] = value;
            }
        }
    }
    return merged;
}

export function deriveAddressSourceContextFromCandidate(row: {
    source_tags?: unknown;
    normalized_data?: unknown;
    source_refs?: unknown;
}): AddressSourceContext {
    return deriveAddressSourceContext(
        mergeAddressSourceTagLayers(row.normalized_data, row.source_refs, row.source_tags)
    );
}

function tagString(tags: Record<string, unknown>, key: string): string | null {
    const raw = tags[key];
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed === "" ? null : trimmed;
}

export function deriveAddressSourceContext(sourceTags: unknown): AddressSourceContext {
    const tags = isRecord(sourceTags) ? sourceTags : {};

    let source_type_hint: string | null = null;
    for (const key of SOURCE_TYPE_TAG_KEYS) {
        const value = tagString(tags, key);
        if (value !== null) {
            source_type_hint = value;
            break;
        }
    }

    const categoryParts: string[] = [];
    for (const key of SOURCE_CATEGORY_TAG_KEYS) {
        const value = tagString(tags, key);
        if (value !== null) {
            categoryParts.push(`${key}=${value}`);
        }
    }

    const raw_relevant_tags: Record<string, string> = {};
    for (const key of RAW_RELEVANT_TAG_KEYS) {
        const value = tagString(tags, key);
        if (value !== null) {
            raw_relevant_tags[key] = value;
        }
    }

    return {
        source_name: tagString(tags, "name"),
        source_name_en: tagString(tags, "name:en"),
        source_name_my: tagString(tags, "name:my") ?? tagString(tags, "name:mm"),
        source_type_hint,
        source_category_hint: categoryParts.length > 0 ? categoryParts.join("; ") : null,
        phone: tagString(tags, "phone"),
        email: tagString(tags, "email"),
        opening_hours: tagString(tags, "opening_hours"),
        raw_relevant_tags,
    };
}

/** Name texts for place match ranking. */
export function sourceContextNameTexts(ctx: AddressSourceContext): string[] {
    return [ctx.source_name, ctx.source_name_en, ctx.source_name_my].filter(
        (v): v is string => typeof v === "string" && v.trim() !== ""
    );
}
