import type { TransportVariantSummary } from "./types";

export function isCanonicalYbsRoute(
    mode: string | null | undefined,
    routeCode: string | null | undefined,
): boolean {
    return mode === "bus" && routeCode?.startsWith("YBS-") === true;
}

/** Route-usage detail currently omits route mode; an empty mode is accepted only with YBS-. */
export function isCanonicalYbsRouteUsage(mode: string, routeCode: string): boolean {
    return routeCode.startsWith("YBS-") && (mode === "" || mode === "bus");
}

export function ybsDirectionLabel(directionId: number | null | undefined): "D0" | "D1" | null {
    if (directionId === 0) return "D0";
    if (directionId === 1) return "D1";
    return null;
}

export function canonicalYbsVariantCode(
    routeCode: string,
    directionId: number | null | undefined,
): string | null {
    const direction = ybsDirectionLabel(directionId);
    return direction ? `${routeCode}-${direction}` : null;
}

/**
 * Canonical YBS stop-usage rows use direction_id even while legacy text may
 * still be present before the data migration is applied.
 */
export function routeUsageDirectionLabel(input: {
    readonly mode: string;
    readonly routeCode: string;
    readonly directionName: string | null;
    readonly directionId?: number | null;
}): string | null {
    const name = input.directionName?.trim() || null;
    if (!isCanonicalYbsRouteUsage(input.mode, input.routeCode)) {
        return name;
    }
    return ybsDirectionLabel(input.directionId);
}

export function variantDirectionLabel(
    variant: Pick<TransportVariantSummary, "direction_id" | "direction_name">,
    canonicalYbs: boolean,
): string {
    if (canonicalYbs) {
        return ybsDirectionLabel(variant.direction_id) ?? "Unknown";
    }
    return variant.direction_name?.trim() ||
        (variant.direction_id === null ? "Unknown" : `Direction ${variant.direction_id}`);
}

export function variantHumanRoute(
    variant: Pick<TransportVariantSummary, "origin_name" | "destination_name" | "headsign">,
): string {
    const origin = variant.origin_name?.trim();
    const destination = variant.destination_name?.trim();
    if (origin || destination) {
        return `${origin || "—"} → ${destination || "—"}`;
    }
    return variant.headsign?.trim() || "—";
}

export function ybsVariantOptionLabel(
    routeCode: string,
    variant: TransportVariantSummary,
): string {
    const direction = ybsDirectionLabel(variant.direction_id) ?? "Unknown";
    const code = canonicalYbsVariantCode(routeCode, variant.direction_id) ?? variant.variant_code;
    return `${direction} · ${variantHumanRoute(variant)} · ${code}`;
}

/** Resolve the opposite YBS variant strictly from the selected variant's machine id. */
export function oppositeYbsVariant(
    variants: readonly TransportVariantSummary[],
    selectedVariantId: string | null,
): TransportVariantSummary | null {
    const selected = variants.find((variant) => variant.public_id === selectedVariantId);
    if (!selected || (selected.direction_id !== 0 && selected.direction_id !== 1)) {
        return null;
    }
    const oppositeDirectionId = selected.direction_id === 0 ? 1 : 0;
    return (
        variants.find(
            (variant) => variant.is_active && variant.direction_id === oppositeDirectionId,
        ) ?? null
    );
}
