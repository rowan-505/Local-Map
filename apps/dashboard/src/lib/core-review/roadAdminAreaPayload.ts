import type { CoreEntityFormValues } from "@/src/lib/core-review/entityConfigs/types";

/** Road/street edit save only — manual override controls whether admin_area_id is sent. */
export function roadAdminAreaForStreetUpdatePayload(values: CoreEntityFormValues): {
    admin_area_id?: string | null;
    admin_area_manual_override?: boolean;
} {
    if (!values.admin_area_manual_override) {
        return {};
    }
    const raw = String(values.admin_area_id ?? "").trim();
    return {
        admin_area_manual_override: true,
        admin_area_id: raw || null,
    };
}
