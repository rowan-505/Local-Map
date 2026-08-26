export const SETTLEMENT_TYPE_VALUES = ["city", "town", "village", "local_area"] as const;

export type SettlementTypeValue = (typeof SETTLEMENT_TYPE_VALUES)[number];

export const SETTLEMENT_TYPE_OPTIONS: { value: SettlementTypeValue; label: string }[] = [
    { value: "city", label: "City" },
    { value: "town", label: "Town" },
    { value: "village", label: "Village" },
    { value: "local_area", label: "Local Area" },
];
