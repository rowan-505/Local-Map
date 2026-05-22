import type { ReverseAddressResultType } from "./reverseAddress.types";

/** API confidence_score is 0–1. Below this threshold suggestions look tentative. */
export const REVERSE_ADDRESS_LOW_CONFIDENCE = 0.55;

const RESULT_TYPE_LABELS: Record<ReverseAddressResultType, string> = {
    exact_address: "Exact address",
    building_address: "Building address",
    building_partial_address: "Building (partial)",
    place_address: "Place / POI",
    street_area_address: "Street + area",
    locality_partial_address: "Locality hint (partial)",
    admin_only: "Admin area only",
    coordinate_only: "Coordinates only",
};

export function reverseResultTypeLabel(type: ReverseAddressResultType): string {
    return RESULT_TYPE_LABELS[type] ?? type;
}

export function isLowConfidenceReverse(score: number): boolean {
    return !Number.isFinite(score) || score < REVERSE_ADDRESS_LOW_CONFIDENCE;
}

export function confidencePercentLabel(score: number): string {
    if (!Number.isFinite(score)) {
        return "—";
    }
    return `${Math.round(score * 100)}%`;
}

export function reversePanelToneClass(score: number, resultType: ReverseAddressResultType): string {
    if (resultType === "coordinate_only") {
        return "border-slate-300 bg-slate-50";
    }
    if (isLowConfidenceReverse(score)) {
        return "border-amber-300 bg-amber-50/80";
    }
    return "border-sky-200 bg-sky-50/60";
}
