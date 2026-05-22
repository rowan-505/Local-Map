import { composeAddress } from "./address-composer.js";
import type { AddressComposerComponent } from "./address-composer.types.js";
import {
    isLocalityHintAdmin,
    isOfficialAdmin,
    REVERSE_STREET_CLOSE_M,
    REVERSE_STREET_MAX_M,
} from "./reverse-address.constants.js";
import type {
    ReverseAddressDebugResponse,
    ReverseAddressLang,
    ReverseAddressMatchedIds,
    ReverseAddressResolverComponent,
    ReverseAddressResponse,
    ReverseAddressResultType,
} from "./reverse-address.types.js";
import type {
    AdminAreaAtPointRow,
    ClickPoint,
    CoreAddressComponentDbRow,
    LanduseAtPointRow,
    NearbyCoreAddressRow,
    NearbyPlaceRow,
    NearbyStreetRow,
    ReverseAddressRepository,
} from "./reverse-address.repo.js";

const ADMIN_LEVEL_COMPONENT: Record<string, string> = {
    village: "village",
    village_tract: "village_tract",
    township: "township",
    region: "region",
    ward: "ward",
    district: "district",
    city: "city",
    town: "town",
};

function idStr(id: bigint | null | undefined): string | null {
    return id === null || id === undefined ? null : String(id);
}

function numConfidence(raw: unknown, fallback: number): number {
    if (raw === null || raw === undefined) {
        return fallback;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return n > 1 ? Math.min(1, n / 100) : Math.min(1, Math.max(0, n));
}

function pickName(row: { name_en: string | null; name_my: string | null; canonical_name: string }, lang: "en" | "my"): string {
    if (lang === "my") {
        return (row.name_my ?? row.name_en ?? row.canonical_name).trim();
    }
    return (row.name_en ?? row.name_my ?? row.canonical_name).trim();
}

function adminComponentType(code: string): string {
    return ADMIN_LEVEL_COMPONENT[code] ?? code;
}

function toComposerRows(components: ReverseAddressResolverComponent[]): AddressComposerComponent[] {
    return components.map((c) => ({
        component_type_code: c.component_type_code,
        component_value: c.component_value,
        language_code: c.language_code,
        sort_order: c.sort_order,
        confidence_score: c.confidence_score,
        match_type: c.match_type,
        boundary_status: c.boundary_status,
        address_usage: c.address_usage,
    }));
}

function serializeComponents(components: ReverseAddressResolverComponent[]) {
    return components.map((c) => ({
        component_type: c.component_type_code,
        value: c.component_value,
        language_code: c.language_code,
        source: c.source,
        source_id: c.source_id,
        confidence_score: c.confidence_score,
        match_type: c.match_type,
        boundary_status: c.boundary_status,
        address_usage: c.address_usage,
    }));
}

function finalize(
    result_type: ReverseAddressResultType,
    confidence_score: number,
    components: ReverseAddressResolverComponent[],
    matched: ReverseAddressMatchedIds,
    lang: ReverseAddressLang,
    warnings: string[],
    displayOverride?: string | null
): ReverseAddressResponse {
    const composed = composeAddress({
        components: toComposerRows(components),
        displayLanguage: lang,
        fallbackMode: "en_first",
    });
    const allWarnings = [...warnings, ...composed.warnings];
    return {
        result_type,
        confidence_score,
        full_address_en: composed.full_address_en,
        full_address_my: composed.full_address_my,
        display_address: displayOverride ?? composed.display_full_address,
        components: serializeComponents(components),
        matched,
        alternatives: [],
        warnings: allWarnings,
    };
}

function componentsFromDbRows(
    rows: CoreAddressComponentDbRow[],
    source: "core_address",
    sourceId: string
): ReverseAddressResolverComponent[] {
    return rows.map((r) => ({
        component_type_code: r.component_type_code,
        component_value: r.component_value,
        language_code: r.language_code,
        source,
        source_id: sourceId,
        confidence_score: numConfidence(r.confidence_score, 0.9),
        match_type: r.match_type,
        boundary_status: r.boundary_status,
        address_usage: r.address_usage,
        sort_order: r.sort_order,
    }));
}

function adminToComponents(
    rows: AdminAreaAtPointRow[],
    source: "core_admin_area",
    asLocalityHint: boolean
): ReverseAddressResolverComponent[] {
    const out: ReverseAddressResolverComponent[] = [];
    for (const row of rows) {
        const typeCode = adminComponentType(row.admin_level_code);
        const baseConf = numConfidence(row.boundary_confidence_score, asLocalityHint ? 0.55 : 0.85);
        const matchType = asLocalityHint ? "point_in_polygon_locality_hint" : row.match_type;
        const en = pickName(row, "en");
        const my = pickName(row, "my");
        if (en) {
            out.push({
                component_type_code: typeCode,
                component_value: en,
                language_code: "en",
                source,
                source_id: idStr(row.id),
                confidence_score: baseConf,
                match_type: matchType,
                boundary_status: row.boundary_status,
                address_usage: row.address_usage,
                sort_order: row.admin_level_rank,
            });
        }
        if (my && my !== en) {
            out.push({
                component_type_code: typeCode,
                component_value: my,
                language_code: "my",
                source,
                source_id: idStr(row.id),
                confidence_score: baseConf,
                match_type: matchType,
                boundary_status: row.boundary_status,
                address_usage: row.address_usage,
                sort_order: row.admin_level_rank,
            });
        }
    }
    return out;
}

function streetToComponents(street: NearbyStreetRow): ReverseAddressResolverComponent[] {
    const distFactor = street.distance_m <= REVERSE_STREET_CLOSE_M ? 0.85 : 0.65;
    const out: ReverseAddressResolverComponent[] = [];
    const en = (street.name_en ?? street.name_und ?? street.canonical_name)?.trim();
    const my = (street.name_my ?? street.name_und ?? street.canonical_name)?.trim();
    if (en) {
        out.push({
            component_type_code: "street",
            component_value: en,
            language_code: "en",
            source: "core_street",
            source_id: street.public_id,
            confidence_score: distFactor,
            match_type: "nearest_street",
            boundary_status: null,
            address_usage: null,
            sort_order: 20,
        });
    }
    if (my && my !== en) {
        out.push({
            component_type_code: "street",
            component_value: my,
            language_code: "my",
            source: "core_street",
            source_id: street.public_id,
            confidence_score: distFactor,
            match_type: "nearest_street",
            boundary_status: null,
            address_usage: null,
            sort_order: 20,
        });
    }
    return out;
}

function placeNameComponents(place: NearbyPlaceRow): ReverseAddressResolverComponent[] {
    const en = (place.display_name ?? place.primary_name)?.trim();
    const out: ReverseAddressResolverComponent[] = [];
    if (en) {
        out.push({
            component_type_code: "building",
            component_value: en,
            language_code: "en",
            source: "core_place",
            source_id: place.public_id,
            confidence_score: 0.8,
            match_type: "nearest_place",
            boundary_status: null,
            address_usage: null,
            sort_order: 10,
        });
    }
    return out;
}

function landuseContextComponent(lu: LanduseAtPointRow): ReverseAddressResolverComponent | null {
    const label = (lu.name ?? lu.class_name ?? lu.class_code)?.trim();
    if (!label) {
        return null;
    }
    return {
        component_type_code: "building",
        component_value: label,
        language_code: "und",
        source: "core_landuse",
        source_id: lu.public_id,
        confidence_score: 0.4,
        match_type: "landuse_at_point",
        boundary_status: null,
        address_usage: null,
        sort_order: 5,
    };
}

function partitionAdmins(adminAreas: AdminAreaAtPointRow[]) {
    const official: AdminAreaAtPointRow[] = [];
    const localityHints: AdminAreaAtPointRow[] = [];
    for (const row of adminAreas) {
        if (isOfficialAdmin(row.boundary_status, row.address_usage)) {
            official.push(row);
        } else if (isLocalityHintAdmin(row.boundary_status, row.address_usage)) {
            localityHints.push(row);
        }
    }
    return { official, localityHints };
}

function formatNearLocalityDisplay(
    composedEn: string | null,
    composedMy: string | null,
    lang: ReverseAddressLang
): string | null {
    if (lang === "my") {
        const base = composedMy ?? composedEn;
        return base ? `အနီး ${base}` : null;
    }
    const base = composedEn ?? composedMy;
    return base ? `Near ${base}` : null;
}

function coordinateComponents(lat: number, lng: number): ReverseAddressResolverComponent[] {
    const value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    return [
        {
            component_type_code: "plus_code",
            component_value: value,
            language_code: "und",
            source: "coordinates",
            source_id: null,
            confidence_score: 0.15,
            match_type: "coordinates_fallback",
            boundary_status: null,
            address_usage: null,
            sort_order: 999,
        },
    ];
}

export class ReverseAddressResolver {
    constructor(private readonly repo: ReverseAddressRepository) {}

    async resolve(lat: number, lng: number, lang: ReverseAddressLang): Promise<ReverseAddressResponse> {
        const { response } = await this.resolveInternal({ lng, lat }, lang, false);
        return response;
    }

    async resolveDebug(lat: number, lng: number, lang: ReverseAddressLang): Promise<ReverseAddressDebugResponse> {
        const { response, layers, decision_reason } = await this.resolveInternal({ lng, lat }, lang, true);
        return {
            ...response,
            debug: {
                lat,
                lng,
                lang,
                decision_reason,
                layers,
            },
        };
    }

    private async resolveInternal(
        point: ClickPoint,
        lang: ReverseAddressLang,
        collectLayers: boolean
    ): Promise<{
        response: ReverseAddressResponse;
        layers: Record<string, unknown>;
        decision_reason: string;
    }> {
        const [
            nearbyAddresses,
            building,
            places,
            streets,
            adminAreas,
            landuse,
        ] = await Promise.all([
            this.repo.findNearbyCoreAddresses(point),
            this.repo.findBuildingAtPoint(point),
            this.repo.findNearbyPlaces(point),
            this.repo.findNearbyStreets(point, REVERSE_STREET_MAX_M),
            this.repo.findAdminAreasAtPoint(point),
            this.repo.findLanduseAtPoint(point),
        ]);

        const { official: officialAdmins, localityHints: polygonLocalityHints } = partitionAdmins(adminAreas);
        const street = streets[0] ?? null;
        const place = places[0] ?? null;

        const layers: Record<string, unknown> = collectLayers
            ? {
                  nearby_addresses: nearbyAddresses,
                  building,
                  places,
                  streets,
                  admin_areas: adminAreas,
                  landuse,
              }
            : {};

        const matchedEmpty = (): ReverseAddressMatchedIds => ({
            address_id: null,
            building_id: null,
            place_id: null,
            street_id: null,
            admin_area_id: null,
        });

        // 1. Exact nearby core address
        const exact = nearbyAddresses[0];
        if (exact) {
            const header = await this.repo.loadAddressHeader(exact.id);
            const dbComponents = await this.repo.listAddressComponents(exact.id);
            const components = componentsFromDbRows(dbComponents, "core_address", exact.public_id);
            const response = finalize(
                "exact_address",
                0.95,
                components,
                {
                    ...matchedEmpty(),
                    address_id: header?.public_id ?? exact.public_id,
                },
                lang,
                [`Matched core address within ${Math.round(exact.distance_m)}m (${exact.match_geom}).`]
            );
            return { response, layers, decision_reason: "priority_1_nearby_core_address" };
        }

        // 2a. Building with linked address
        if (building?.linked_address_id) {
            const addrId = building.linked_address_id;
            const header = await this.repo.loadAddressHeader(addrId);
            const dbComponents = await this.repo.listAddressComponents(addrId);
            const components = componentsFromDbRows(
                dbComponents,
                "core_address",
                header?.public_id ?? building.linked_address_public_id ?? String(addrId)
            );
            const response = finalize(
                "building_address",
                0.9,
                components,
                {
                    ...matchedEmpty(),
                    address_id: header?.public_id ?? building.linked_address_public_id,
                    building_id: building.public_id,
                },
                lang,
                ["Building polygon contains click; linked primary place address used."]
            );
            return { response, layers, decision_reason: "priority_2_building_with_linked_address" };
        }

        // 2b. Building without address — partial
        if (building) {
            const components: ReverseAddressResolverComponent[] = [];
            const warnings: string[] = ["Building has no linked core address; street and admin areas only."];
            if (street) {
                components.push(...streetToComponents(street));
            }
            components.push(...adminToComponents(officialAdmins, "core_admin_area", false));
            const response = finalize(
                "building_partial_address",
                street ? 0.65 : 0.5,
                components,
                {
                    ...matchedEmpty(),
                    building_id: building.public_id,
                    street_id: street?.public_id ?? null,
                    admin_area_id: idStr(officialAdmins[0]?.id),
                },
                lang,
                warnings
            );
            return { response, layers, decision_reason: "priority_2_building_without_address" };
        }

        // 3a. Place with linked address
        if (place?.linked_address_id) {
            const header = await this.repo.loadAddressHeader(place.linked_address_id);
            const dbComponents = await this.repo.listAddressComponents(place.linked_address_id);
            const components = componentsFromDbRows(
                dbComponents,
                "core_address",
                header?.public_id ?? String(place.linked_address_id)
            );
            const response = finalize(
                "place_address",
                0.88,
                components,
                {
                    ...matchedEmpty(),
                    address_id: header?.public_id ?? null,
                    place_id: place.public_id,
                },
                lang,
                [`Matched place within ${Math.round(place.distance_m)}m with linked address.`]
            );
            return { response, layers, decision_reason: "priority_3_place_with_linked_address" };
        }

        // 3b. Nearby place without address
        if (place) {
            const components = [
                ...placeNameComponents(place),
                ...(street ? streetToComponents(street) : []),
                ...adminToComponents(officialAdmins, "core_admin_area", false),
            ];
            const response = finalize(
                "place_address",
                0.75,
                components,
                {
                    ...matchedEmpty(),
                    place_id: place.public_id,
                    street_id: street?.public_id ?? null,
                    admin_area_id: idStr(officialAdmins[0]?.id),
                },
                lang,
                [`Matched place within ${Math.round(place.distance_m)}m without linked address.`]
            );
            return { response, layers, decision_reason: "priority_3_place_without_address" };
        }

        // 4. Street + admin (road click / nearest street)
        if (street && street.distance_m <= REVERSE_STREET_MAX_M) {
            const components = [
                ...streetToComponents(street),
                ...adminToComponents(officialAdmins, "core_admin_area", false),
            ];
            const conf = street.distance_m <= REVERSE_STREET_CLOSE_M ? 0.72 : 0.6;
            const response = finalize(
                "street_area_address",
                conf,
                components,
                {
                    ...matchedEmpty(),
                    street_id: street.public_id,
                    admin_area_id: idStr(officialAdmins[0]?.id),
                },
                lang,
                [`Nearest street ${Math.round(street.distance_m)}m from click.`]
            );
            return { response, layers, decision_reason: "priority_4_nearest_street" };
        }

        // 5. Official admin only (inside polygon, no street/place/building)
        if (officialAdmins.length > 0) {
            const components = adminToComponents(officialAdmins, "core_admin_area", false);
            const response = finalize(
                "admin_only",
                0.45,
                components,
                {
                    ...matchedEmpty(),
                    admin_area_id: idStr(officialAdmins[0]?.id),
                },
                lang,
                ["Click is inside official admin boundaries; no street or address match."]
            );
            return { response, layers, decision_reason: "priority_5_admin_only" };
        }

        // 6–7. Locality hint + landuse / field context
        let villageHint: AdminAreaAtPointRow | null = polygonLocalityHints[0] ?? null;
        if (!villageHint) {
            villageHint = await this.repo.findNearestVillageHint(point);
            if (villageHint && collectLayers) {
                layers.nearest_village_hint = villageHint;
            }
        }

        const localityComponents: ReverseAddressResolverComponent[] = [];
        const warnings: string[] = [];

        if (landuse) {
            const luComp = landuseContextComponent(landuse);
            if (luComp) {
                localityComponents.push(luComp);
            }
        }
        if (villageHint) {
            localityComponents.push(...adminToComponents([villageHint], "core_admin_area", true));
            warnings.push(
                "Village boundary is approximate or settlement extent; shown as locality hint only, not an official address line."
            );
        }
        localityComponents.push(...adminToComponents(officialAdmins, "core_admin_area", false));

        if (localityComponents.length > 0 || villageHint || landuse) {
            const composed = composeAddress({
                components: toComposerRows(localityComponents),
                displayLanguage: lang,
            });
            const display = formatNearLocalityDisplay(composed.full_address_en, composed.full_address_my, lang);
            const response = finalize(
                "locality_partial_address",
                villageHint ? 0.5 : 0.4,
                localityComponents,
                {
                    ...matchedEmpty(),
                    admin_area_id: idStr(villageHint?.id ?? officialAdmins[0]?.id),
                },
                lang,
                warnings,
                display
            );
            return { response, layers, decision_reason: "priority_6_7_locality_and_landuse" };
        }

        // 8. Coordinates fallback
        const components = coordinateComponents(point.lat, point.lng);
        const response = finalize(
            "coordinate_only",
            0.15,
            components,
            matchedEmpty(),
            lang,
            ["No address, building, place, street, or admin match; coordinates only."]
        );
        return { response, layers, decision_reason: "priority_8_coordinates" };
    }
}
