import type { CoreEntityFormValues } from "@/src/lib/core-review/entityConfigs/types";

/** Omit admin_area_id from API payload unless the user enabled manual township override. */
export function entityAdminAreaIdForPayload(
    values: CoreEntityFormValues,
    key: "adminAreaId" | "admin_area_id"
): string | null | undefined {
    if (!values.admin_area_manual_override) {
        return undefined;
    }
    const raw = String(values[key] ?? "").trim();
    return raw || null;
}
