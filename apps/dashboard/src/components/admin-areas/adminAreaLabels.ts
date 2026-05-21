export type AdminAreaOption = {
    id: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_id: string;
    parent_id: string | null;
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
