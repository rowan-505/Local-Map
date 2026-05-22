export function normalizeNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();

        if (trimmed === "") {
            return null;
        }

        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

export function resolveRoadLayerOverride(input: {
    layer?: unknown;
    bridge?: boolean | null;
    tunnel?: boolean | null;
}): number | null {
    const normalizedLayer = normalizeNullableNumber(input.layer);

    if (normalizedLayer !== null) {
        return normalizedLayer;
    }

    if (input.bridge === true) {
        return 1;
    }

    if (input.tunnel === true) {
        return -1;
    }

    return null;
}
