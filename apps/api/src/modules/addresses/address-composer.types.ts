/** Bilingual display preference for generated full address strings. */
export type AddressDisplayLanguage = "en" | "my";

/** How to pick display_full_address when preferred language output is empty. */
export type AddressComposerFallbackMode = "any" | "en_first" | "my_first";

/**
 * One structured address line (import_review / core address_components shape).
 * Full address text is composed from these rows — never the other way around.
 */
export type AddressComposerComponent = {
    component_type_code: string;
    component_value: string;
    language_code: string;
    sort_order?: number | null;
    confidence_score?: number | null;
    match_type?: string | null;
    source_tag?: string | null;
    source_admin_area_id?: string | number | bigint | null;
    boundary_status?: string | null;
    address_usage?: string | null;
    is_inferred?: boolean | null;
    is_reviewed?: boolean | null;
    [key: string]: unknown;
};

export type AddressComposerInput = {
    components: readonly AddressComposerComponent[];
    /** Preferred language for display_full_address (falls back to the other line). */
    displayLanguage?: AddressDisplayLanguage;
    fallbackMode?: AddressComposerFallbackMode;
};

export type AddressComponentTypeSummary = {
    en: string | null;
    my: string | null;
    und: string | null;
    /** Value included in the generated English full address line. */
    used_in_en: string | null;
    /** Value included in the generated Myanmar full address line. */
    used_in_my: string | null;
};

export type AddressComposerResult = {
    full_address_en: string | null;
    full_address_my: string | null;
    display_full_address: string | null;
    components_by_type: Record<string, AddressComponentTypeSummary>;
    warnings: string[];
};
