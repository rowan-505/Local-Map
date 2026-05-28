/**
 * Filters routing API warnings for public UI — hides mapper/engine debug text.
 */

const TECHNICAL_WARNING_PATTERNS: readonly RegExp[] = [
    /decoded\s+valhalla/i,
    /encoded\s+polyline/i,
    /geojson\s+was\s+not\s+returned/i,
    /geojson\s+not\s+returned/i,
    /\btodo:/i,
    /enable\s+valhalla/i,
    /retried\s+with\s+auto/i,
    /motorcycle\s+costing\s+disabled/i,
    /routed\s+with\s+valhalla\s+auto\s+costing/i,
    /valhalla\s+encoded/i,
    /shape_format/i,
    /mapper\b/i,
    /internal\s+debug/i,
];

export function isTechnicalRouteWarning(warning: string): boolean {
    const text = warning.trim();
    if (!text) return true;
    return TECHNICAL_WARNING_PATTERNS.some((pattern) => pattern.test(text));
}

export function filterUserFacingRouteWarnings(
    warnings: readonly string[],
): readonly string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const warning of warnings) {
        const trimmed = warning.trim();
        if (!trimmed || isTechnicalRouteWarning(trimmed)) continue;
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        result.push(trimmed);
    }

    return result;
}

export function routingProfileDisplayLabel(profile: string): string {
    switch (profile) {
        case 'walk':
            return 'Walk';
        case 'car':
            return 'Car';
        case 'motorcycle':
            return 'Motorbike';
        case 'multimodal':
            return 'Multimodal';
        default:
            return profile.charAt(0).toUpperCase() + profile.slice(1);
    }
}

/** Subtle engine hint for summary — not raw engine codes. */
export function routingEngineDisplayHint(engine: string): string | null {
    switch (engine) {
        case 'valhalla':
            return 'Road network routing';
        case 'otp':
            return 'Transit routing';
        case 'external':
            return 'External routing';
        default:
            return null;
    }
}
