import type { Map as MaplibreMap } from "maplibre-gl";

function stringifyError(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }

    return String(err ?? "");
}

/**
 * Martin tile endpoints that can fail (e.g. 500) without breaking dashboard map UX.
 * Downgrade to dev-only warnings so building/place editors are not noisy in the console.
 */
function isOptionalTransitTileFailureMessage(message: string): boolean {
    const m = message.toLowerCase();

    return (
        m.includes("transport_stops_v") ||
        m.includes("transport_route_paths_v") ||
        m.includes("/transport_stops") ||
        m.includes("/transport_route_paths")
    );
}

export function attachDashboardMapErrorHandler(map: MaplibreMap, context: string): void {
    map.on("error", (event: { error?: unknown }) => {
        const msg = stringifyError(event.error);

        if (isOptionalTransitTileFailureMessage(msg)) {
            if (process.env.NODE_ENV === "development") {
                console.warn(`[${context}] map tile warning (non-fatal):`, event.error ?? event);
            }

            return;
        }

        console.error(`${context} map error:`, event.error ?? event);
    });
}
