export const TRANSPORT_MODE_OPTIONS = [
    { value: "bus", label: "Bus" },
    { value: "express_bus", label: "Express bus" },
    { value: "train", label: "Train" },
    { value: "ferry", label: "Ferry" },
    { value: "air", label: "Air" },
    { value: "other", label: "Other" },
] as const;

export const TRANSPORT_REVIEW_STATUS_OPTIONS = [
    { value: "imported_unreviewed", label: "Imported (unreviewed)" },
    { value: "needs_review", label: "Needs review" },
    { value: "reviewed", label: "Reviewed" },
    { value: "verified", label: "Verified" },
    { value: "rejected", label: "Rejected" },
    { value: "manual_protected", label: "Manual (protected)" },
] as const;

// Mirrors the API `infrastructureLineTypeEnum` allowlist (no DB CHECK exists).
export const TRANSPORT_LINE_TYPE_OPTIONS = [
    { value: "ferry", label: "Ferry" },
    { value: "rail", label: "Rail" },
    { value: "abandoned", label: "Abandoned" },
    { value: "disused", label: "Disused" },
    { value: "construction", label: "Construction" },
    { value: "narrow_gauge", label: "Narrow gauge" },
    { value: "tram", label: "Tram" },
] as const;

export const TRANSPORT_ROUTE_GEOMETRY_STATUS_OPTIONS = [
    { value: "no_path", label: "No path" },
    { value: "estimate", label: "Estimate path" },
    { value: "manual", label: "Manual path" },
    { value: "verified", label: "Verified path" },
] as const;

export const TRANSPORT_PUBLIC_VISIBILITY_OPTIONS = [
    { value: "hidden", label: "Hidden" },
    { value: "visible", label: "Visible" },
] as const;

export const TRANSPORT_STOP_GEOMETRY_STATUS_OPTIONS = [
    { value: "missing", label: "Missing location" },
    { value: "estimate", label: "Estimate location" },
    { value: "manual", label: "Manual location" },
    { value: "verified", label: "Verified location" },
] as const;

export const TRANSPORT_DUPLICATE_STATUS_OPTIONS = [
    { value: "none", label: "No duplicates" },
    { value: "nearby", label: "Nearby duplicate" },
    { value: "duplicate_name", label: "Duplicate name" },
] as const;

export const TRANSPORT_STOP_TYPE_OPTIONS = [
    { value: "stop", label: "Stop" },
    { value: "terminal", label: "Terminal" },
    { value: "station", label: "Station" },
    { value: "platform", label: "Platform" },
    { value: "halt", label: "Halt" },
    { value: "airport", label: "Airport" },
    { value: "helipad", label: "Helipad" },
] as const;

const MODE_LABELS: Record<string, string> = Object.fromEntries(
    TRANSPORT_MODE_OPTIONS.map((o) => [o.value, o.label])
);

const REVIEW_STATUS_LABELS: Record<string, string> = Object.fromEntries(
    TRANSPORT_REVIEW_STATUS_OPTIONS.map((o) => [o.value, o.label])
);

export function transportModeLabel(value: string): string {
    return MODE_LABELS[value] ?? value;
}

export function transportReviewStatusLabel(value: string): string {
    return REVIEW_STATUS_LABELS[value] ?? value;
}

/**
 * Safe display name for a terminal. Generated OSM names (e.g.
 * "ferry_terminal osm:N:123") and missing names are never shown directly:
 * ferry terminals fall back to "Ferry landing candidate", others to
 * "Unnamed {role}". Only `real` names render as-is.
 */
export function transportTerminalDisplayName(t: {
    name: string;
    raw_name_status: "real" | "generated" | "missing";
    mode: string;
    terminal_role: string;
}): string {
    if (t.raw_name_status === "real") {
        return t.name;
    }
    if (t.mode === "ferry") {
        return "Ferry landing candidate";
    }
    return `Unnamed ${t.terminal_role || "terminal"}`;
}

/**
 * Safe display name for an infrastructure line. Generated OSM names (e.g.
 * "railway_disused osm:W:123") and missing names are never shown directly:
 * they fall back to a humanized "{Mode} {line type}" label. Only `real`
 * names render as-is.
 */
export function transportInfrastructureLineDisplayName(l: {
    name: string | null;
    raw_name_status: "real" | "generated" | "missing";
    mode: string;
    line_type: string;
}): string {
    if (l.raw_name_status === "real" && (l.name ?? "").trim() !== "") {
        return l.name as string;
    }
    const mode = transportModeLabel(l.mode);
    const lineType = (l.line_type || "line").replace(/_/g, " ");
    return `Unnamed ${mode} ${lineType}`;
}
