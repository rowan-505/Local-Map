import type { CoreEntityFormValues } from "@/src/lib/core-review/entityConfigs/types";

/**
 * Road/street edit save — township admin_area_id slice only.
 *
 * - No manual override: omit admin fields (preserve existing DB value on save).
 * - Manual override / applied recommendation with township id: send id.
 * - Explicit clear only: send null when admin_area_explicit_clear is set.
 */
export function roadAdminAreaForStreetUpdatePayload(values: CoreEntityFormValues): {
    admin_area_id?: string | null;
    admin_area_manual_override?: boolean;
    explicitClearAdminArea?: boolean;
} {
    if (!values.admin_area_manual_override) {
        return {};
    }

    const raw = String(values.admin_area_id ?? "").trim();
    if (raw) {
        return {
            admin_area_manual_override: true,
            admin_area_id: raw,
        };
    }

    if (Boolean(values.admin_area_explicit_clear)) {
        return {
            admin_area_manual_override: true,
            admin_area_id: null,
            explicitClearAdminArea: true,
        };
    }

    return {};
}
