/** Common OSM-style `surface` values — user can still type a custom value. */
export const STREET_SURFACE_PRESETS = [
    { value: "", label: "— Select or type —" },
    { value: "asphalt", label: "Asphalt" },
    { value: "concrete", label: "Concrete" },
    { value: "paved", label: "Paved" },
    { value: "paving_stones", label: "Paving stones" },
    { value: "unpaved", label: "Unpaved" },
    { value: "gravel", label: "Gravel" },
    { value: "ground", label: "Ground" },
    { value: "dirt", label: "Dirt" },
    { value: "grass", label: "Grass" },
    { value: "cobblestone", label: "Cobblestone" },
] as const;

export function isStreetSurfacePreset(value: string): boolean {
    return STREET_SURFACE_PRESETS.some((preset) => preset.value !== "" && preset.value === value);
}
