import type { CoreEntityFormValues } from "@/src/lib/core-review/entityConfigs/types";

/**
 * Place create/update — township adminAreaId slice only.
 *
 * - No manual override: omit admin fields (preserve existing DB value on update; create may infer).
 * - Manual override / applied recommendation with township id: send id.
 * - Explicit clear only: send null when admin_area_explicit_clear is set.
 */
export function placeAdminAreaForPayload(values: CoreEntityFormValues): {
    adminAreaId?: string | null;
    explicitClearAdminArea?: boolean;
} {
    if (!values.admin_area_manual_override) {
        return {};
    }

    const raw = String(values.adminAreaId ?? "").trim();
    if (raw) {
        return { adminAreaId: raw };
    }

    if (Boolean(values.admin_area_explicit_clear)) {
        return {
            adminAreaId: null,
            explicitClearAdminArea: true,
        };
    }

    return {};
}
