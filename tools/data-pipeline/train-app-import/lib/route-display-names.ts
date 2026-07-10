import {
    formatMyanmarPlaceNameForDisplay,
    latinDigitsToMyanmar,
} from "./text-normalize.js";

export function buildPublicName(
    trainNumber: string,
    originName: string | null,
    destinationName: string | null,
): string {
    const origin = originName ?? "?";
    const destination = destinationName ?? "?";
    return `Train ${trainNumber} · ${origin} ↔ ${destination}`;
}

export function buildPublicNameMy(
    trainNumber: string,
    originName: string | null,
    destinationName: string | null,
): string {
    const origin = originName ? formatMyanmarPlaceNameForDisplay(originName) : "?";
    const destination = destinationName
        ? formatMyanmarPlaceNameForDisplay(destinationName)
        : "?";
    return `ရထား ${latinDigitsToMyanmar(trainNumber)} · ${origin} ↔ ${destination}`;
}

export function buildRoutePublicNames(input: {
    train_number: string;
    origin_name_en?: string | null;
    origin_name_my?: string | null;
    destination_name_en?: string | null;
    destination_name_my?: string | null;
}): { public_name: string; public_name_my: string } {
    const originEn = input.origin_name_en ?? null;
    const originMy = input.origin_name_my ?? null;
    const destinationEn = input.destination_name_en ?? null;
    const destinationMy = input.destination_name_my ?? null;

    return {
        public_name: buildPublicName(
            input.train_number,
            originEn ?? originMy,
            destinationEn ?? destinationMy,
        ),
        public_name_my: buildPublicNameMy(
            input.train_number,
            originMy ?? originEn,
            destinationMy ?? destinationEn,
        ),
    };
}
