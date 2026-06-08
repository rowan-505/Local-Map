import { validateStreetGeometry, type StreetLineStringGeoJson, type ValidateStreetGeometryResponse } from "@/src/lib/api";

export const TOPOLOGY_VALIDATION_TIMEOUT_WARNING = "Topology checks could not be completed";

export const STREET_GEOMETRY_VALIDATE_TIMEOUT_MS = 5000;

export function topologyValidationWarningResult(): ValidateStreetGeometryResponse {
    return {
        isValid: true,
        errors: [],
        warnings: [TOPOLOGY_VALIDATION_TIMEOUT_WARNING],
        startConnection: null,
        endConnection: null,
        crossings: [],
        duplicates: [],
    };
}

export function hasBlockingStreetGeometryErrors(result: ValidateStreetGeometryResponse): boolean {
    return !result.isValid && result.errors.length > 0;
}

export function shouldConfirmStreetTopologyWarnings(result: ValidateStreetGeometryResponse): boolean {
    return result.warnings.some((warning) => warning !== TOPOLOGY_VALIDATION_TIMEOUT_WARNING);
}

export async function validateStreetGeometryForSave(params: {
    geometry: StreetLineStringGeoJson;
    streetId?: string | number;
}): Promise<ValidateStreetGeometryResponse> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), STREET_GEOMETRY_VALIDATE_TIMEOUT_MS);

    try {
        return await validateStreetGeometry(params, { signal: controller.signal });
    } catch (err) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (isAbort || err instanceof Error) {
            return topologyValidationWarningResult();
        }
        return topologyValidationWarningResult();
    } finally {
        window.clearTimeout(timeoutId);
    }
}
