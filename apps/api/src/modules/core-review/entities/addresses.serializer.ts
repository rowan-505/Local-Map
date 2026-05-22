import type { CoreAddressComponentRowDb, CoreReviewAddressListRowDb } from "./addresses.repo.js";
import type { ComposedCoreAddressFields } from "./addresses-compose.js";

function iso(d: Date | string | null | undefined): string | null {
    if (d === null || d === undefined) {
        return null;
    }
    if (d instanceof Date) {
        return d.toISOString();
    }
    return String(d);
}

function numOrNull(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export type SerializedCoreAddressComponent = {
    id: string;
    componentTypeCode: string;
    componentValue: string;
    languageCode: string;
    sortOrder: number | null;
    confidenceScore: number | null;
    matchType: string | null;
    sourceAdminAreaId: string | null;
    boundaryStatus: string | null;
    addressUsage: string | null;
    sourceRefs: unknown;
};

export function serializeCoreAddressComponent(
    row: CoreAddressComponentRowDb
): SerializedCoreAddressComponent {
    return {
        id: row.id.toString(),
        componentTypeCode: row.component_type_code,
        componentValue: row.component_value,
        languageCode: row.language_code,
        sortOrder: row.sort_order,
        confidenceScore: numOrNull(row.confidence_score),
        matchType: row.match_type,
        sourceAdminAreaId: row.source_admin_area_id?.toString() ?? null,
        boundaryStatus: row.boundary_status,
        addressUsage: row.address_usage,
        sourceRefs: row.source_refs ?? {},
    };
}

export function serializeCoreReviewAddress(
    row: CoreReviewAddressListRowDb & ComposedCoreAddressFields,
    options: {
        components?: readonly CoreAddressComponentRowDb[];
        includeDetail?: boolean;
    } = {}
) {
    const adminAreaName =
        row.admin_area_canonical_name ??
        row.admin_area_name_en ??
        row.admin_area_name_my ??
        null;

    const base = {
        id: row.id.toString(),
        publicId: row.public_id,
        cachedFullAddress: row.cached_full_address,
        fullAddress: row.displayFullAddress ?? row.cached_full_address,
        generatedFullAddressEn: row.generatedFullAddressEn,
        generatedFullAddressMy: row.generatedFullAddressMy,
        displayFullAddress: row.displayFullAddress,
        houseNumber: row.house_number,
        unitNumber: row.unit_number,
        postalCode: row.postal_code,
        streetId: row.street_id?.toString() ?? null,
        streetPublicId: row.street_public_id,
        streetNameEn: row.street_name_en,
        streetNameMy: row.street_name_my,
        adminAreaId: row.admin_area_id?.toString() ?? null,
        adminAreaName,
        adminAreaNameEn: row.admin_area_name_en,
        adminAreaNameMy: row.admin_area_name_my,
        isPublic: row.is_public,
        isVerified: row.is_verified,
        confidenceScore: numOrNull(row.confidence_score),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        geometry: row.geometry,
        compositionWarnings: row.compositionWarnings,
        myanmarName: row.generatedFullAddressMy,
        englishName: row.generatedFullAddressEn,
    };

    if (!options.includeDetail) {
        return base;
    }

    return {
        ...base,
        entranceGeometry: row.entrance_geometry,
        sourceTypeId: row.source_type_id?.toString() ?? null,
        sourceRefs: row.source_refs ?? {},
        normalizedData: row.normalized_data ?? {},
        components: (options.components ?? []).map(serializeCoreAddressComponent),
    };
}
