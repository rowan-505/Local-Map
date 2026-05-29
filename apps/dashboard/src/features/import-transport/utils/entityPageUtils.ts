import type {
    ImportTransportDetailItem,
    ImportTransportEntityConfig,
    ImportTransportListItem,
    ImportTransportTableColumn,
} from "../config/types";

export function importTransportCellValue(
    row: ImportTransportListItem,
    col: ImportTransportTableColumn
): string {
    const raw = row[col.key];
    if (raw === null || raw === undefined || raw === "") {
        if (col.key === "name") {
            const fallback = row.stop_name ?? row.stop_name_local;
            if (typeof fallback === "string" && fallback.trim()) {
                return fallback.trim();
            }
        }
        return "—";
    }
    if (typeof raw === "string") {
        return raw;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
        return String(raw);
    }
    return "—";
}

export function resolveImportTransportDrawerTitle(
    row: ImportTransportListItem,
    titleField: string
): string {
    const value = row[titleField];
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    if (titleField === "name") {
        const name = row.stop_name ?? row.stop_name_local;
        if (typeof name === "string" && name.trim()) {
            return name.trim();
        }
    }
    if (row.external_id?.trim()) {
        return row.external_id.trim();
    }
    return `Candidate ${row.id}`;
}

export function resolveImportTransportDrawerSubtitle(
    row: ImportTransportListItem,
    subtitleField: string
): string {
    const value = row[subtitleField];
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return row.id;
}

type DetailField = { label: string; keys: string[] };

const FAMILY_DETAIL_FIELDS: Record<string, DetailField[]> = {
    routes: [
        { label: "Route code", keys: ["route_code"] },
        { label: "Public name", keys: ["public_name"] },
        { label: "Mode type", keys: ["mode_type", "transport_mode"] },
        { label: "Operator", keys: ["operator", "operator_name"] },
    ],
    stops: [
        { label: "Name", keys: ["name", "stop_name", "stop_name_local"] },
        { label: "Stop code", keys: ["stop_code"] },
        { label: "Mode type", keys: ["mode_type", "transport_mode"] },
        { label: "Admin area", keys: ["admin_area"] },
    ],
    variants: [
        { label: "Route code", keys: ["route_code"] },
        { label: "Variant code", keys: ["variant_code"] },
        { label: "Direction", keys: ["direction_name"] },
        { label: "Origin", keys: ["origin_name"] },
        { label: "Destination", keys: ["destination_name"] },
        { label: "Geometry", keys: ["geometry_status"] },
    ],
    route_stops: [
        { label: "Route code", keys: ["route_code"] },
        { label: "Variant code", keys: ["variant_code"] },
        { label: "Stop name", keys: ["stop_name", "name"] },
        { label: "Stop sequence", keys: ["stop_sequence"] },
    ],
};

function readDetailFieldValue(row: ImportTransportDetailItem, keys: string[]): string {
    for (const key of keys) {
        const raw = row[key];
        if (raw === null || raw === undefined || raw === "") {
            continue;
        }
        if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
            return String(raw);
        }
    }
    return "—";
}

export function importTransportDetailFields(
    config: ImportTransportEntityConfig,
    row: ImportTransportDetailItem
): Array<{ label: string; value: string }> {
    const fields = FAMILY_DETAIL_FIELDS[config.apiFamily] ?? [];
    return fields.map((field) => ({
        label: field.label,
        value: readDetailFieldValue(row, field.keys),
    }));
}
