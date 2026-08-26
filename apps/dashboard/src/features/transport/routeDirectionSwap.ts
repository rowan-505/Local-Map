import type { TransportVariantSummary } from "./types";

export type RouteDirectionSwapPair = {
    readonly direction0: TransportVariantSummary;
    readonly direction1: TransportVariantSummary;
};

/** True when the route has exactly two active variants: direction_id 0 + 1. */
export function getRouteDirectionSwapPair(
    variants: readonly TransportVariantSummary[],
): RouteDirectionSwapPair | null {
    const active = variants.filter((variant) => variant.is_active);
    if (active.length !== 2) {
        return null;
    }

    const direction0 = active.find((variant) => variant.direction_id === 0);
    const direction1 = active.find((variant) => variant.direction_id === 1);
    if (!direction0 || !direction1) {
        return null;
    }

    return { direction0, direction1 };
}

export function canSwapRouteDirection(variants: readonly TransportVariantSummary[]): boolean {
    return getRouteDirectionSwapPair(variants) !== null;
}

/** Keep the same logical direction after the backend swaps variant metadata. */
export function resolveVariantIdAfterDirectionSwap(
    variants: readonly TransportVariantSummary[],
    previousDirectionId: number | null | undefined,
): string | null {
    const sameDirection =
        previousDirectionId === null || previousDirectionId === undefined
            ? undefined
            : variants.find((variant) => variant.direction_id === previousDirectionId);
    return sameDirection?.public_id ?? variants[0]?.public_id ?? null;
}

export function formatVariantDirectionSummary(variant: TransportVariantSummary): string {
    const direction =
        variant.direction_name?.trim() ||
        (variant.direction_id === null ? "—" : `Direction ${variant.direction_id}`);
    const detail = variant.first_stop_name?.trim() || "—";
    return `${variant.variant_code} · ${direction} · ${detail}`;
}
