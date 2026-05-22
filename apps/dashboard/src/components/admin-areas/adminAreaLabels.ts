export type AdminAreaOption = {
    id: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_id: string;
    admin_level_code?: string;
    admin_level_name?: string | null;
    parent_id: string | null;
    parent_label?: string | null;
    boundary_status?: string | null;
    address_usage?: string | null;
};

/** Prefer name_mm + name_en; fallback to canonical_name. */
export function formatAdminAreaOptionLabel(
    option: Pick<AdminAreaOption, "canonical_name" | "name_mm" | "name_en">
): string {
    const mm = option.name_mm?.trim();
    const en = option.name_en?.trim();
    const canonical = option.canonical_name?.trim();
    if (mm && en) {
        return `${mm} — ${en}`;
    }
    if (mm) {
        return mm;
    }
    if (en) {
        return en;
    }
    return canonical ?? "";
}

const BOUNDARY_STATUS_ADMIN_HINTS: Record<string, string> = {
    settlement_extent: "Settlement extent",
    approximate: "Approximate",
    unknown: "Unknown boundary",
};

/** Secondary line for dashboard admin pickers (level, parent, boundary hint). */
export function formatAdminAreaOptionMeta(
    option: Pick<
        AdminAreaOption,
        | "admin_level_code"
        | "admin_level_name"
        | "parent_label"
        | "boundary_status"
    >
): string | null {
    const parts: string[] = [];
    const level =
        option.admin_level_name?.trim() ||
        (option.admin_level_code === "village" ? "Village" : option.admin_level_code?.trim());
    if (level) {
        parts.push(level);
    }
    if (option.admin_level_code === "village" && option.parent_label?.trim()) {
        parts.push(option.parent_label.trim());
    }
    const boundaryHint =
        option.boundary_status !== undefined && option.boundary_status !== null
            ? BOUNDARY_STATUS_ADMIN_HINTS[option.boundary_status]
            : undefined;
    if (boundaryHint) {
        parts.push(boundaryHint);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
}
