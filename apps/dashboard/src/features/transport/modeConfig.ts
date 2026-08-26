/**
 * Shared Transport mode config (dashboard side).
 *
 * Small, generic per-mode defaults so a single route editor
 * (TransportRouteEditor / TransportVariantEditor / TransportStopSequence /
 * TransportPathEditor) can support bus, train, and ferry without mode-specific
 * editors. Intentionally tiny: no plugin system, no behaviour beyond defaults +
 * labels.
 *
 * Mirror of `apps/api/src/modules/transport/transport-mode-config.ts` — keep the
 * two files identical.
 */

/** Modes that have explicit per-mode defaults. Other modes use the generic config. */
export type TransportModeKey = "bus" | "train" | "ferry";

/** Seed values for a default route variant created alongside a new route. */
export type TransportVariantSeed = {
    readonly variant_code: string;
    readonly direction_name: string;
    /** Machine direction identity; display/geographic semantics are source-specific. */
    readonly direction_id: number;
};

/** Mode-specific UI labels for the shared editor. */
export type TransportModeLabels = {
    /** Singular label for a stop / station / pier in this mode. */
    readonly stop: string;
    /** Label for the route path / shape in this mode. */
    readonly path: string;
};

export type TransportModeConfig = {
    readonly defaultRouteKind: string;
    readonly defaultVariants: readonly TransportVariantSeed[];
    readonly labels: TransportModeLabels;
};

export type GetDefaultVariantsOptions = {
    /**
     * Force-include direction_id 1 for modes that default to only direction_id 0
     * (currently ferry). No effect on modes that already create the 0/1 pair.
     */
    readonly includeReturn?: boolean;
};

const OUTBOUND_VARIANT: TransportVariantSeed = {
    variant_code: "OUT",
    direction_name: "Outbound",
    direction_id: 0,
};

const INBOUND_VARIANT: TransportVariantSeed = {
    variant_code: "IN",
    direction_name: "Inbound",
    direction_id: 1,
};

const TRANSPORT_MODE_CONFIG: Record<TransportModeKey, TransportModeConfig> = {
    bus: {
        defaultRouteKind: "urban",
        defaultVariants: [OUTBOUND_VARIANT, INBOUND_VARIANT],
        labels: { stop: "Bus stop", path: "Bus path" },
    },
    train: {
        defaultRouteKind: "rail",
        defaultVariants: [OUTBOUND_VARIANT, INBOUND_VARIANT],
        labels: { stop: "Station", path: "Rail path" },
    },
    ferry: {
        defaultRouteKind: "ferry",
        // Ferries default to direction_id 0; add the return variant
        // later via getDefaultVariantsForMode(mode, { includeReturn: true }).
        defaultVariants: [OUTBOUND_VARIANT],
        labels: { stop: "Pier / terminal", path: "Ferry path" },
    },
};

/** Fallback for modes without explicit config (e.g. express_bus, air, other). */
const GENERIC_MODE_CONFIG: TransportModeConfig = {
    defaultRouteKind: "regional",
    defaultVariants: [OUTBOUND_VARIANT, INBOUND_VARIANT],
    labels: { stop: "Stop", path: "Route path" },
};

export function isTransportModeKey(mode: string): mode is TransportModeKey {
    return mode === "bus" || mode === "train" || mode === "ferry";
}

/** Resolves the config for a mode, falling back to the generic config. */
export function getTransportModeConfig(mode: string): TransportModeConfig {
    return isTransportModeKey(mode) ? TRANSPORT_MODE_CONFIG[mode] : GENERIC_MODE_CONFIG;
}

/** Default `route_kind` for a new route of the given mode. */
export function getDefaultRouteKind(mode: string): string {
    return getTransportModeConfig(mode).defaultRouteKind;
}

/**
 * Default variant seeds for a new route of the given mode. Returns a fresh
 * mutable array so callers can adapt it. `includeReturn` adds direction_id 1
 * for one-way-by-default modes (ferry).
 */
export function getDefaultVariantsForMode(
    mode: string,
    options?: GetDefaultVariantsOptions
): TransportVariantSeed[] {
    const variants = [...getTransportModeConfig(mode).defaultVariants];
    if (
        options?.includeReturn &&
        !variants.some((v) => v.direction_id === INBOUND_VARIANT.direction_id)
    ) {
        variants.push(INBOUND_VARIANT);
    }
    return variants;
}

/** Mode-specific stop / path labels for the shared editor UI. */
export function getTransportModeLabels(mode: string): TransportModeLabels {
    return getTransportModeConfig(mode).labels;
}
