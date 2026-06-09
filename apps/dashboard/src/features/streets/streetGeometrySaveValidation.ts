import {
    validateStreetGeometry,
    type StreetLineStringGeoJson,
    type ValidateStreetGeometryResponse,
} from "@/src/lib/api";

export const TOPOLOGY_VALIDATION_TIMEOUT_WARNING = "Topology checks could not be completed";

/** Client abort for POST /streets/validate-geometry (matches API topology budget). */
export const STREET_GEOMETRY_VALIDATE_TIMEOUT_MS = 3000;

export function topologyValidationWarningResult(
    warning: string = TOPOLOGY_VALIDATION_TIMEOUT_WARNING,
): ValidateStreetGeometryResponse {
    return {
        isValid: true,
        errors: [],
        warnings: [warning],
        startConnection: null,
        endConnection: null,
        crossings: [],
        duplicates: [],
    };
}

/** Blocks save only for hard geometry failures (missing/invalid type/ST_IsValid). */
export function hasBlockingStreetGeometryErrors(result: ValidateStreetGeometryResponse): boolean {
    return result.errors.length > 0;
}

export function hasStreetGeometryTopologyWarnings(result: ValidateStreetGeometryResponse): boolean {
    return result.warnings.length > 0;
}

export function formatStreetGeometrySaveSuccessMessage(
    entityLabel: string,
    mode: "saved" | "created",
    check?: ValidateStreetGeometryResponse | null,
): string {
    const base = `${entityLabel} ${mode} successfully.`;
    if (!check || !hasStreetGeometryTopologyWarnings(check)) {
        return base;
    }
    if (check.warnings.length === 1) {
        return `${base} Warning: ${check.warnings[0]}`;
    }
    return `${base} ${check.warnings.length} topology warnings — see Validation panel.`;
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
        if (err instanceof DOMException && err.name === "AbortError") {
            return topologyValidationWarningResult();
        }
        const message =
            err instanceof Error ? err.message : "Geometry validation request failed";
        return topologyValidationWarningResult(message);
    } finally {
        window.clearTimeout(timeoutId);
    }
}
