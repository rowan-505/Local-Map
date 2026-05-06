import type { DataTableArrange } from "@/src/components/dashboard/DataTableToolbar";

const DATE_SORT_FIELDS = new Set(["created", "updated"]);

/** Maps toolbar `arrange` + `sortBy` to API `sortOrder` (asc | desc). */
export function listApiSortOrder(sortBy: string, arrange: DataTableArrange): "asc" | "desc" {
    if (DATE_SORT_FIELDS.has(sortBy)) {
        return arrange === "newest" ? "desc" : "asc";
    }

    return arrange === "za" ? "desc" : "asc";
}
