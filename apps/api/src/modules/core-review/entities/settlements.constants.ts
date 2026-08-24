export const SETTLEMENT_TYPE_CODES = ["city", "town", "village", "local_area"] as const;

export type SettlementTypeCode = (typeof SETTLEMENT_TYPE_CODES)[number];

export const SETTLEMENT_TYPE_LABELS: Record<SettlementTypeCode, string> = {
    city: "City",
    town: "Town",
    village: "Village",
    local_area: "Local Area",
};

/** Nearby duplicate warning radius. Warning only — create is still allowed. */
export const SETTLEMENT_DUPLICATE_NEARBY_METERS = 500;

export const SETTLEMENT_DUPLICATE_NAME_SIMILARITY = 0.3;

export function isSettlementTypeCode(value: string): value is SettlementTypeCode {
    return (SETTLEMENT_TYPE_CODES as readonly string[]).includes(value);
}
