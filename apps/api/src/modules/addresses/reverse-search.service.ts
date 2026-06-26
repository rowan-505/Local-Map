import { generatePlusCode } from "../../lib/geo/plus-code.js";
import { composeMinimalAddressLine } from "./minimal-address-composer.js";
import type { MinimalReverseAddressRow, ReverseSearchRepository } from "./reverse-search.repo.js";

export const REVERSE_SEARCH_CONFIDENCES = [
    "exact_nearby",
    "street_nearby",
    "area_based",
    "unknown",
] as const;

export type ReverseSearchConfidence = (typeof REVERSE_SEARCH_CONFIDENCES)[number];

export type ReverseSearchResult = {
    address_line: string;
    plus_code: string | null;
    lat: number;
    lng: number;
    confidence: ReverseSearchConfidence;
};

function normalizeConfidence(raw: string | null): ReverseSearchConfidence {
    return (REVERSE_SEARCH_CONFIDENCES as readonly string[]).includes(raw ?? "")
        ? (raw as ReverseSearchConfidence)
        : "unknown";
}

export class ReverseSearchService {
    constructor(private readonly repo: ReverseSearchRepository) {}

    /**
     * Structured reverse-lookup row (nearby name/type/distance + admin hierarchy).
     * Used by callers that need the individual fields rather than a composed line.
     */
    async reverseDetails(lat: number, lng: number): Promise<MinimalReverseAddressRow | null> {
        return this.repo.reverseAddressMinimal(lat, lng);
    }

    async reverse(lat: number, lng: number): Promise<ReverseSearchResult> {
        const row = await this.repo.reverseAddressMinimal(lat, lng);

        const address_line = composeMinimalAddressLine({
            nearbyName: row?.nearby_name,
            township: row?.township,
            district: row?.district,
            regionState: row?.region_state,
            country: row?.country,
        });

        return {
            // Composer always returns at least "Myanmar"; the fallback keeps the contract explicit.
            address_line: address_line || "Myanmar",
            plus_code: generatePlusCode(lat, lng),
            lat,
            lng,
            confidence: normalizeConfidence(row?.confidence ?? null),
        };
    }
}
