import type { ImportReviewBuildingListItem } from "@/src/lib/api";

export type ConflictFieldChoice = "existing" | "imported" | "custom" | "unset";

export type ConflictFieldCompareRow = {
    field: string;
    existing: string;
    imported: string;
    choice: ConflictFieldChoice;
};

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function displayValue(value: unknown): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string") {
        const t = value.trim();
        return t === "" ? "—" : t;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return "—";
    }
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
        if (key in obj && obj[key] !== null && obj[key] !== undefined && obj[key] !== "") {
            return obj[key];
        }
    }
    return undefined;
}

const FIELD_KEYS: { field: string; keys: string[] }[] = [
    { field: "primary_name", keys: ["primary_name", "canonical_name", "name", "name_mm"] },
    { field: "display_name", keys: ["display_name", "name_en", "name"] },
    { field: "external_id", keys: ["external_id"] },
    { field: "category_id", keys: ["category_id", "poi_category_id"] },
    { field: "admin_area_id", keys: ["admin_area_id"] },
    { field: "class_code", keys: ["class_code"] },
    { field: "lat", keys: ["lat"] },
    { field: "lng", keys: ["lng"] },
    { field: "building_type", keys: ["building_type", "building_type_id"] },
    { field: "road_class", keys: ["road_class", "road_class_id", "highway"] },
];

/**
 * Build side-by-side compare rows from package payload snapshots or row columns.
 */
export function buildConflictFieldCompareRows(
    row: ImportReviewBuildingListItem,
    choices: Record<string, ConflictFieldChoice> = {}
): ConflictFieldCompareRow[] {
    const payload = asRecord((row as { payload?: unknown }).payload);
    const importedSnap = asRecord(
        pick(payload, ["imported_values"]) ??
            pick(asRecord(row.normalized_data), ["imported_values"]) ??
            row.normalized_data
    );
    const coreSnap = asRecord(
        pick(payload, ["core_snapshot"]) ?? row.matched_core_data
    );

    // Prefer compact snapshots when present; otherwise project common row fields.
    const hasSnap =
        Object.keys(importedSnap).length > 0 || Object.keys(coreSnap).length > 0;

    const rows: ConflictFieldCompareRow[] = [];

    for (const def of FIELD_KEYS) {
        const existing = hasSnap
            ? displayValue(pick(coreSnap, def.keys))
            : displayValue(pick({ ...asRecord(row.matched_core_data), ...asRecord(row) }, def.keys));
        const imported = hasSnap
            ? displayValue(pick(importedSnap, def.keys))
            : displayValue(
                  pick(
                      {
                          ...asRecord(row.normalized_data),
                          ...asRecord(row),
                      },
                      def.keys
                  )
              );

        if (existing === "—" && imported === "—") continue;

        rows.push({
            field: def.field,
            existing,
            imported,
            choice: choices[def.field] ?? "unset",
        });
    }

    return rows;
}

export function formatFieldChoicesForNote(
    choices: Record<string, ConflictFieldChoice>
): string | null {
    const entries = Object.entries(choices).filter(([, v]) => v !== "unset");
    if (entries.length === 0) return null;
    return `field_choices:${JSON.stringify(Object.fromEntries(entries))}`;
}
