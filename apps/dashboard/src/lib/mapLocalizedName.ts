import type { ExpressionSpecification } from "maplibre-gl";

export type LanguageMode = "my" | "en" | "both";

/**
 * MapLibre `layout["text-field"]` for vector/GeoJSON features with `name_mm`, `name_en`, `name`.
 * Duplicated from `packages/localized-name` so the dashboard bundle stays inside the app root.
 */
export function getMapTextFieldExpression(mode: LanguageMode): ExpressionSpecification {
    if (mode === "my") {
        return ["coalesce", ["get", "name_mm"], ["get", "name_en"], ["get", "name"]];
    }
    if (mode === "en") {
        return ["coalesce", ["get", "name_en"], ["get", "name_mm"], ["get", "name"]];
    }
    return [
        "case",
        ["all", ["has", "name_mm"], ["has", "name_en"]],
        ["concat", ["get", "name_mm"], "\n", ["get", "name_en"]],
        ["coalesce", ["get", "name_mm"], ["get", "name_en"], ["get", "name"]],
    ];
}
