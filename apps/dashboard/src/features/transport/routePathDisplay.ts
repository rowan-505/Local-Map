import type { TransportRoutePath } from "./types";

export type RoutePathDisplayKind =
    | "none"
    | "placeholder"
    | "auto_generated"
    | "manual"
    | "reviewed"
    | "other";

export type RoutePathLineStyle = {
    color: string;
    width: number;
    opacity: number;
};

const REVIEWED_STATUSES = new Set(["reviewed", "verified"]);
const MANUAL_PATH_KINDS = new Set(["manual", "manual_drawn"]);

export function resolveRoutePathDisplayKind(
    path: TransportRoutePath | null | undefined,
): RoutePathDisplayKind {
    if (!path?.geometry) {
        return "none";
    }
    if (path.review_status && REVIEWED_STATUSES.has(path.review_status)) {
        return "reviewed";
    }
    switch (path.path_kind) {
        case "corridor_estimate":
            return "placeholder";
        case "valhalla_snapped":
            return "auto_generated";
        default:
            if (MANUAL_PATH_KINDS.has(path.path_kind)) {
                return "manual";
            }
            return "other";
    }
}

export function routePathDisplayLabel(kind: RoutePathDisplayKind): string {
    switch (kind) {
        case "none":
            return "No path";
        case "placeholder":
            return "Placeholder path";
        case "auto_generated":
            return "Auto-generated path";
        case "manual":
            return "Manually edited path";
        case "reviewed":
            return "Reviewed path";
        case "other":
            return "Route path";
    }
}

export function routePathLineStyle(kind: RoutePathDisplayKind): RoutePathLineStyle {
    switch (kind) {
        case "reviewed":
            return { color: "#1d4ed8", width: 4.5, opacity: 0.95 };
        case "manual":
            return { color: "#2563eb", width: 4, opacity: 0.92 };
        case "auto_generated":
            return { color: "#0f766e", width: 3.5, opacity: 0.9 };
        case "placeholder":
            return { color: "#7c3aed", width: 3, opacity: 0.85 };
        case "other":
            return { color: "#2563eb", width: 3.5, opacity: 0.9 };
        case "none":
            return { color: "#2563eb", width: 3, opacity: 0 };
    }
}

export function hasSavedRoutePathGeometry(path: TransportRoutePath | null | undefined): boolean {
    return resolveRoutePathDisplayKind(path) !== "none";
}
