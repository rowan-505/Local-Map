import type { TransportVariantSummary } from "./types";

export type RouteDirectionSwapPair = {
    readonly outbound: TransportVariantSummary;
    readonly inbound: TransportVariantSummary;
};

/** True when the route has exactly two active variants: outbound (0) + inbound (1). */
export function getRouteDirectionSwapPair(
    variants: readonly TransportVariantSummary[],
): RouteDirectionSwapPair | null {
    const active = variants.filter((variant) => variant.is_active);
    if (active.length !== 2) {
        return null;
    }

    const outbound = active.find((variant) => variant.direction_id === 0);
    const inbound = active.find((variant) => variant.direction_id === 1);
    if (!outbound || !inbound) {
        return null;
    }

    return { outbound, inbound };
}

export function canSwapRouteDirection(variants: readonly TransportVariantSummary[]): boolean {
    return getRouteDirectionSwapPair(variants) !== null;
}

export function formatVariantDirectionSummary(variant: TransportVariantSummary): string {
    const direction =
        variant.direction_name?.trim() ||
        (variant.direction_id === 0
            ? "outbound"
            : variant.direction_id === 1
              ? "inbound"
              : "—");
    const detail = variant.headsign?.trim() || variant.destination_name?.trim() || "—";
    return `${variant.variant_code} · ${direction} · ${detail}`;
}
