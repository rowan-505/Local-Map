import { transportPath } from "@/src/lib/dashboardPaths";

export function fieldStopEditorHref(stopPublicId: string): string {
    return `${transportPath("stops")}?stop=${encodeURIComponent(stopPublicId)}`;
}

export function fieldRouteEditorHref(routePublicId: string): string {
    return `${transportPath("routes")}?route=${encodeURIComponent(routePublicId)}`;
}
