/**
 * Flat active building type codes (ref.ref_building_types after migration 061).
 * Detailed OSM / legacy child codes map to these; detail stays in normalized_data/tags.
 */
export const ACTIVE_BUILDING_TYPE_CODES = [
    "residential",
    "commercial",
    "mixed_use",
    "education",
    "healthcare",
    "government_civic",
    "religious",
    "industrial",
    "warehouse_storage",
    "transport",
    "utility_infrastructure",
    "agriculture",
    "recreation",
    "military_restricted",
    "temporary_informal",
    "unknown",
] as const;

export type ActiveBuildingTypeCode = (typeof ACTIVE_BUILDING_TYPE_CODES)[number];

const ACTIVE_SET = new Set<string>(ACTIVE_BUILDING_TYPE_CODES);

/** Legacy ref / import detailed codes → flat active code (aligned with 061 merge map). */
const DETAILED_SOURCE_TO_SIMPLE: Readonly<Record<string, ActiveBuildingTypeCode>> = {
    house: "residential",
    apartment: "residential",
    dormitory: "residential",
    townhouse: "residential",
    villa: "residential",
    office: "commercial",
    retail: "commercial",
    shopping_mall: "commercial",
    supermarket: "commercial",
    market: "commercial",
    hotel: "commercial",
    restaurant_building: "commercial",
    showroom: "commercial",
    school: "education",
    university: "education",
    library: "education",
    training_center: "education",
    hospital: "healthcare",
    clinic: "healthcare",
    pharmacy_building: "healthcare",
    laboratory: "healthcare",
    health_center: "healthcare",
    government_office: "government_civic",
    township_office: "government_civic",
    courthouse: "government_civic",
    police_station: "government_civic",
    fire_station: "government_civic",
    post_office: "government_civic",
    community_center: "government_civic",
    pagoda: "religious",
    monastery: "religious",
    church: "religious",
    mosque: "religious",
    temple: "religious",
    religious_complex: "religious",
    factory: "industrial",
    workshop: "industrial",
    processing_plant: "industrial",
    warehouse: "warehouse_storage",
    bus_terminal: "transport",
    train_station: "transport",
    ferry_terminal: "transport",
    airport_terminal: "transport",
    parking_structure: "transport",
    depot: "transport",
    farm_building: "agriculture",
    barn: "agriculture",
    greenhouse: "agriculture",
    livestock_structure: "agriculture",
    recreation_entertainment: "recreation",
    stadium: "recreation",
    cinema: "recreation",
    gym: "recreation",
    recreation_center: "recreation",
    telecom: "utility_infrastructure",
    water_facility: "utility_infrastructure",
    electrical_substation: "utility_infrastructure",
    sewage_facility: "utility_infrastructure",
    waste_management: "utility_infrastructure",
    military: "military_restricted",
    checkpoint: "military_restricted",
    restricted_facility: "military_restricted",
    mixed_use_lowrise: "mixed_use",
    mixed_use_highrise: "mixed_use",
    integrated_complex: "mixed_use",
    temporary_structure: "temporary_informal",
    kiosk: "temporary_informal",
    market_stall: "temporary_informal",
    informal_structure: "temporary_informal",
    generic_building: "unknown",
    unclassified: "unknown",
};

/**
 * OSM building=* tag values and common synonyms → flat code.
 * Amenity POI types (restaurant, cafe, etc.) map to structural buckets only — not POI categories.
 */
const OSM_BUILDING_TAG_TO_SIMPLE: Readonly<Record<string, ActiveBuildingTypeCode>> = {
    yes: "unknown",
    building: "unknown",
    house: "residential",
    detached: "residential",
    semidetached_house: "residential",
    terrace: "residential",
    apartments: "residential",
    apartment: "residential",
    dormitory: "residential",
    residential: "residential",
    bungalow: "residential",
    cabin: "residential",
    hut: "temporary_informal",
    static_caravan: "temporary_informal",
    commercial: "commercial",
    retail: "commercial",
    office: "commercial",
    hotel: "commercial",
    supermarket: "commercial",
    mall: "commercial",
    kiosk: "temporary_informal",
    restaurant: "commercial",
    cafe: "commercial",
    shop: "commercial",
    warehouse: "warehouse_storage",
    industrial: "industrial",
    manufacture: "industrial",
    farm: "agriculture",
    farm_auxiliary: "agriculture",
    barn: "agriculture",
    greenhouse: "agriculture",
    stable: "agriculture",
    school: "education",
    university: "education",
    college: "education",
    kindergarten: "education",
    hospital: "healthcare",
    clinic: "healthcare",
    church: "religious",
    chapel: "religious",
    mosque: "religious",
    temple: "religious",
    cathedral: "religious",
    monastery: "religious",
    pagoda: "religious",
    train_station: "transport",
    transportation: "transport",
    garage: "transport",
    parking: "transport",
    bus_station: "transport",
    stadium: "recreation",
    sports_hall: "recreation",
    grandstand: "recreation",
    civic: "government_civic",
    public: "government_civic",
    government: "government_civic",
    military: "military_restricted",
    bunker: "military_restricted",
    construction: "unknown",
    ruins: "unknown",
    abandoned: "unknown",
};

export type ClassifiedBuildingTypeCode = {
    /** Flat ref.ref_building_types.code for building_type_id / class_code. */
    code: ActiveBuildingTypeCode;
    /** Lowercased input when it differed from {@link code} (preserve in normalized_data). */
    sourceCode: string | null;
};

function normalizeInput(input: string | null | undefined): string | null {
    const raw = input?.trim().toLowerCase();
    return raw && raw.length > 0 ? raw : null;
}

/** Map legacy/detailed/OSM building labels to an active simple building type code. */
export function classifyBuildingTypeCode(input: string | null | undefined): ClassifiedBuildingTypeCode {
    const source = normalizeInput(input);
    if (!source) {
        return { code: "unknown", sourceCode: null };
    }

    if (ACTIVE_SET.has(source)) {
        return { code: source as ActiveBuildingTypeCode, sourceCode: null };
    }

    const fromDetailed = DETAILED_SOURCE_TO_SIMPLE[source];
    if (fromDetailed) {
        return { code: fromDetailed, sourceCode: source };
    }

    const fromOsm = OSM_BUILDING_TAG_TO_SIMPLE[source];
    if (fromOsm) {
        return { code: fromOsm, sourceCode: source };
    }

    return { code: "unknown", sourceCode: source };
}

/** Merge lineage fields when classification collapses a detailed/OSM code. */
export function buildingTypeClassificationNormalizedPatch(
    classified: ClassifiedBuildingTypeCode
): Record<string, unknown> {
    if (!classified.sourceCode) {
        return {};
    }

    return {
        source_building_type_code: classified.sourceCode,
        building_type_classified_at: new Date().toISOString(),
    };
}

export function isActiveBuildingTypeCode(code: string): code is ActiveBuildingTypeCode {
    return ACTIVE_SET.has(code.trim().toLowerCase());
}
