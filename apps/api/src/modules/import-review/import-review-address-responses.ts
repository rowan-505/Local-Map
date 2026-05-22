import { composeAddress } from "../addresses/address-composer.js";
import type { AddressComposerComponent } from "../addresses/address-composer.types.js";
import type { AddressComponentRowDb } from "./import-review-address-components.repo.js";
import {
    deriveAddressSourceContextFromCandidate,
    type AddressSourceContext,
} from "./import-review-address-source-context.js";
import type { BuildingListRowDb } from "./import-review-data-repository.js";
import type { ImportReviewBuildingListItem, ImportReviewGeoJson } from "./import-review.types.js";

export type { AddressSourceContext };

export type AddressComponentsGrouped = Record<
    string,
    Record<string, AddressComponentDto[]>
>;

export type AddressComponentDto = {
    id: string;
    component_type_code: string;
    component_value: string;
    language_code: string;
    sort_order: number | null;
    confidence_score: number | null;
    match_type: string | null;
    source_tag: string | null;
    is_inferred: boolean;
    is_reviewed: boolean;
    source_admin_area_id: string | null;
    boundary_status: string | null;
    address_usage: string | null;
    source_refs: unknown;
    normalized_data: unknown;
    review_note: string | null;
};

export type ImportReviewAddressListItem = {
    id: string;
    external_id: string | null;
    source_entity_type: string | null;
    generated_full_address_en: string | null;
    generated_full_address_my: string | null;
    display_full_address: string | null;
    house_number: string | null;
    street: string | null;
    locality: string | null;
    city: string | null;
    confidence_score: number | null;
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    validation_status: string | null;
    promotion_status: string | null;
    promotion_blockers: unknown;
    promotion_warnings: unknown;
    updated_at: string;
    source_name: string | null;
    source_type_hint: string | null;
};

export type ImportReviewAddressDetailItem = ImportReviewAddressListItem & {
    public_id: string;
    review_batch_id: string;
    source_snapshot_version: string;
    local_staging_id: string;
    source_snapshot_id_local: string | null;
    canonical_name: string | null;
    class_code: string | null;
    review_decision: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    source_context: AddressSourceContext;
    source_tags: unknown;
    source_refs: unknown;
    normalized_data: unknown;
    review_overrides: unknown;
    address_components: AddressComponentsGrouped;
    address_components_flat: AddressComponentDto[];
    components_by_type: import("../addresses/address-composer.types.js").AddressComposerResult["components_by_type"];
    composition_warnings: string[];
    matched_admin_area_id: string | null;
    matched_street_id: string | null;
    matched_building_id: string | null;
    matched_place_id: string | null;
    admin_match_type: string | null;
    street_match_type: string | null;
    admin_match_confidence: number | null;
    street_match_confidence: number | null;
    matched_core_id: string | null;
    matched_core_table: string | null;
    promoted_core_address_id: string | null;
    promoted_core_id: string | null;
    validated_at: string | null;
    validation_warnings: unknown;
    validation_errors: unknown;
    created_at: string;
    geometry: ImportReviewGeoJson | null;
    entrance_geometry: ImportReviewGeoJson | null;
    map_preview_layers?: AddressMapPreviewLayers | null;
};

export type AddressMapPreviewLayers = {
    candidate_point: ImportReviewGeoJson | null;
    entrance_point: ImportReviewGeoJson | null;
    matched_building: ImportReviewGeoJson | null;
    matched_street: ImportReviewGeoJson | null;
    matched_admin_area: ImportReviewGeoJson | null;
};

function numOrNull(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const n =
        typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function bigStr(v: bigint | null | undefined): string | null {
    if (v === null || v === undefined) {
        return null;
    }
    return v.toString();
}

function toIso(d: Date | null | undefined): string | null {
    return d ? d.toISOString() : null;
}

function toComposerComponent(row: AddressComponentRowDb): AddressComposerComponent {
    return {
        component_type_code: row.component_type_code,
        component_value: row.component_value,
        language_code: row.language_code,
        sort_order: row.sort_order,
        confidence_score: numOrNull(row.confidence_score),
        match_type: row.match_type,
        source_tag: row.source_tag,
        source_admin_area_id: row.source_admin_area_id,
        boundary_status: row.boundary_status,
        address_usage: row.address_usage,
        is_inferred: row.is_inferred,
        is_reviewed: row.is_reviewed,
    };
}

export function mapAddressComponentDto(row: AddressComponentRowDb): AddressComponentDto {
    return {
        id: row.id.toString(),
        component_type_code: row.component_type_code,
        component_value: row.component_value,
        language_code: row.language_code,
        sort_order: row.sort_order,
        confidence_score: numOrNull(row.confidence_score),
        match_type: row.match_type,
        source_tag: row.source_tag,
        is_inferred: row.is_inferred,
        is_reviewed: row.is_reviewed,
        source_admin_area_id: bigStr(row.source_admin_area_id),
        boundary_status: row.boundary_status,
        address_usage: row.address_usage,
        source_refs: row.source_refs,
        normalized_data: row.normalized_data,
        review_note: row.review_note,
    };
}

export function groupAddressComponents(rows: readonly AddressComponentRowDb[]): AddressComponentsGrouped {
    const grouped: AddressComponentsGrouped = {};
    for (const row of rows) {
        const type = row.component_type_code;
        const lang = row.language_code;
        if (!grouped[type]) {
            grouped[type] = {};
        }
        if (!grouped[type][lang]) {
            grouped[type][lang] = [];
        }
        grouped[type][lang].push(mapAddressComponentDto(row));
    }
    return grouped;
}

export function indexComponentsByCandidateId(
    rows: readonly AddressComponentRowDb[]
): Map<string, AddressComponentRowDb[]> {
    const map = new Map<string, AddressComponentRowDb[]>();
    for (const row of rows) {
        const key = row.address_candidate_id.toString();
        const list = map.get(key);
        if (list) {
            list.push(row);
        } else {
            map.set(key, [row]);
        }
    }
    return map;
}

function pickUsedInEn(
    componentsByType: import("../addresses/address-composer.types.js").AddressComposerResult["components_by_type"],
    typeCode: string
): string | null {
    return componentsByType[typeCode]?.used_in_en ?? null;
}

function pickLocalityDisplay(
    componentsByType: import("../addresses/address-composer.types.js").AddressComposerResult["components_by_type"]
): string | null {
    return (
        pickUsedInEn(componentsByType, "township") ??
        pickUsedInEn(componentsByType, "village") ??
        pickUsedInEn(componentsByType, "quarter") ??
        pickUsedInEn(componentsByType, "ward") ??
        pickUsedInEn(componentsByType, "town") ??
        pickUsedInEn(componentsByType, "village_tract") ??
        null
    );
}

function pickStreetDisplay(
    componentsByType: import("../addresses/address-composer.types.js").AddressComposerResult["components_by_type"]
): string | null {
    return pickUsedInEn(componentsByType, "street") ?? pickUsedInEn(componentsByType, "road");
}

export function composeFromComponentRows(
    rows: readonly AddressComponentRowDb[],
    displayLanguage?: "en" | "my"
) {
    return composeAddress({
        components: rows.map(toComposerComponent),
        displayLanguage,
    });
}

function addressRowBase(row: BuildingListRowDb) {
    return {
        id: row.id.toString(),
        external_id: row.external_id,
        source_entity_type: row.source_entity_type ?? null,
        confidence_score: numOrNull(row.confidence_score),
        match_status: row.match_status,
        auto_action: row.auto_action,
        review_status: row.review_status,
        validation_status: row.validation_status ?? "not_checked",
        promotion_status: row.promotion_status,
        promotion_blockers: row.promotion_blockers ?? [],
        promotion_warnings: row.promotion_warnings ?? [],
        updated_at: row.updated_at.toISOString(),
    };
}

export function resolveAddressDisplayName(
    row: BuildingListRowDb,
    composed: ReturnType<typeof composeFromComponentRows>
): string {
    return (
        composed.display_full_address ??
        composed.full_address_en ??
        composed.full_address_my ??
        row.canonical_name ??
        `Address ${row.id}`
    );
}

export function mapAddressListItem(
    row: BuildingListRowDb,
    componentRows: readonly AddressComponentRowDb[]
): ImportReviewAddressListItem {
    const composed = composeFromComponentRows(componentRows, "en");
    const sourceContext = deriveAddressSourceContextFromCandidate(row);
    return {
        ...addressRowBase(row),
        generated_full_address_en: composed.full_address_en,
        generated_full_address_my: composed.full_address_my,
        display_full_address: composed.display_full_address,
        house_number: pickUsedInEn(composed.components_by_type, "house_number"),
        street: pickStreetDisplay(composed.components_by_type),
        locality: pickLocalityDisplay(composed.components_by_type),
        city: pickUsedInEn(composed.components_by_type, "city"),
        source_name: sourceContext.source_name,
        source_type_hint: sourceContext.source_type_hint,
    };
}

export function mapAddressDetailItem(
    row: BuildingListRowDb,
    componentRows: readonly AddressComponentRowDb[]
): ImportReviewAddressDetailItem {
    const composed = composeFromComponentRows(componentRows, "en");
    const list = mapAddressListItem(row, componentRows);

    return {
        ...list,
        public_id: row.public_id,
        review_batch_id: row.review_batch_id.toString(),
        source_snapshot_version: row.source_snapshot_version,
        local_staging_id: row.local_staging_id.toString(),
        source_snapshot_id_local: bigStr(row.source_snapshot_id_local),
        canonical_name: row.canonical_name,
        class_code: row.class_code,
        review_decision: row.review_decision,
        reviewed_by: row.reviewed_by,
        reviewed_at: toIso(row.reviewed_at),
        review_note: row.review_note,
        source_context: deriveAddressSourceContextFromCandidate(row),
        source_tags: row.source_tags ?? {},
        source_refs: row.source_refs,
        normalized_data: row.normalized_data,
        review_overrides: row.review_overrides,
        address_components: groupAddressComponents(componentRows),
        address_components_flat: componentRows.map(mapAddressComponentDto),
        components_by_type: composed.components_by_type,
        composition_warnings: composed.warnings,
        matched_admin_area_id: bigStr(row.matched_admin_area_id),
        matched_street_id: bigStr(row.matched_street_id),
        matched_building_id: bigStr(row.matched_building_id),
        matched_place_id: bigStr(row.matched_place_id),
        admin_match_type: row.admin_match_type ?? null,
        street_match_type: row.street_match_type ?? null,
        admin_match_confidence: numOrNull(row.admin_match_confidence),
        street_match_confidence: numOrNull(row.street_match_confidence),
        matched_core_id: bigStr(row.matched_core_id),
        matched_core_table: row.matched_core_table,
        promoted_core_address_id: bigStr(row.promoted_core_address_id ?? row.promoted_core_id),
        promoted_core_id: bigStr(row.promoted_core_id),
        validated_at: toIso(row.validated_at),
        validation_warnings: row.validation_warnings,
        validation_errors: row.validation_errors,
        created_at: row.created_at.toISOString(),
        geometry: (row.geometry as ImportReviewGeoJson | null) ?? null,
        entrance_geometry: (row.centroid as ImportReviewGeoJson | null) ?? null,
    };
}

/** Enrich generic list item with composed address fields (backward compatible). */
export function enrichAddressListItem(
    item: ImportReviewBuildingListItem,
    row: BuildingListRowDb,
    componentRows: readonly AddressComponentRowDb[]
): ImportReviewBuildingListItem {
    const address = mapAddressListItem(row, componentRows);
    return {
        ...item,
        generated_full_address_en: address.generated_full_address_en,
        generated_full_address_my: address.generated_full_address_my,
        display_full_address: address.display_full_address,
        effective_full_address: address.display_full_address,
        effective_house_number: address.house_number,
        effective_street_name: address.street,
        effective_township: address.locality,
        effective_quarter: pickUsedInEn(
            composeFromComponentRows(componentRows).components_by_type,
            "quarter"
        ),
        source_entity_type: address.source_entity_type,
        source_name: address.source_name,
        source_type_hint: address.source_type_hint,
        validation_status: address.validation_status,
        promotion_blockers: address.promotion_blockers,
        promotion_warnings: address.promotion_warnings,
    };
}
