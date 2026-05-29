/** Production transport tables backing core-review bus-* URL segments. */
export const CORE_REVIEW_TRANSPORT_DATA_SOURCE = "core_transport" as const;

export const CORE_REVIEW_TRANSPORT_ENTITY_KEYS = [
    "bus-stops",
    "bus-routes",
    "bus-route-variants",
] as const;

export type CoreReviewTransportEntityKey = (typeof CORE_REVIEW_TRANSPORT_ENTITY_KEYS)[number];

export function isCoreReviewTransportEntityKey(
    entityKey: string,
): entityKey is CoreReviewTransportEntityKey {
    return (CORE_REVIEW_TRANSPORT_ENTITY_KEYS as readonly string[]).includes(entityKey);
}

export default function CoreReviewTransportSourceBadge({
    source = CORE_REVIEW_TRANSPORT_DATA_SOURCE,
    className = "",
}: {
    source?: string;
    className?: string;
}) {
    return (
        <span
            className={`inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-900 ${className}`}
        >
            Source: {source}
        </span>
    );
}
