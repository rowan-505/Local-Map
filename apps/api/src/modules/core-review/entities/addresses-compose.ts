import { composeAddress } from "../../addresses/address-composer.js";
import type { AddressComposerComponent } from "../../addresses/address-composer.types.js";
import type { CoreAddressComponentRowDb } from "./addresses.repo.js";

export type ComposedCoreAddressFields = {
    generatedFullAddressEn: string | null;
    generatedFullAddressMy: string | null;
    displayFullAddress: string | null;
    compositionWarnings: string[];
};

export function mapDbComponentsToComposer(
    rows: readonly CoreAddressComponentRowDb[]
): AddressComposerComponent[] {
    return rows.map((row) => ({
        component_type_code: row.component_type_code,
        component_value: row.component_value,
        language_code: row.language_code,
        sort_order: row.sort_order,
    }));
}

export function composeCoreAddressFromComponents(
    components: readonly CoreAddressComponentRowDb[]
): ComposedCoreAddressFields {
    const result = composeAddress({
        components: mapDbComponentsToComposer(components),
        fallbackMode: "my_first",
    });
    return {
        generatedFullAddressEn: result.full_address_en,
        generatedFullAddressMy: result.full_address_my,
        displayFullAddress: result.display_full_address,
        compositionWarnings: result.warnings,
    };
}

export function groupComponentsByAddressId(
    rows: readonly CoreAddressComponentRowDb[]
): Map<bigint, CoreAddressComponentRowDb[]> {
    const map = new Map<bigint, CoreAddressComponentRowDb[]>();
    for (const row of rows) {
        const list = map.get(row.address_id) ?? [];
        list.push(row);
        map.set(row.address_id, list);
    }
    return map;
}

export function attachComposedFields<
    T extends { id: bigint },
>(
    rows: readonly T[],
    componentsByAddressId: Map<bigint, CoreAddressComponentRowDb[]>
): Array<T & ComposedCoreAddressFields> {
    return rows.map((row) => {
        const components = componentsByAddressId.get(row.id) ?? [];
        return {
            ...row,
            ...composeCoreAddressFromComponents(components),
        };
    });
}
