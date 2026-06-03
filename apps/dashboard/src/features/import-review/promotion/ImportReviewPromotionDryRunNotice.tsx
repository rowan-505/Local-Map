import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";

type Props = {
    hasRoads: boolean;
    hasRoutingBarriers: boolean;
    className?: string;
};

export default function ImportReviewPromotionDryRunNotice({
    hasRoads,
    hasRoutingBarriers,
    className = "",
}: Props) {
    if (!hasRoads && !hasRoutingBarriers) {
        return null;
    }

    const parts: string[] = [];
    if (hasRoads) {
        parts.push("roads (core.core_streets)");
    }
    if (hasRoutingBarriers) {
        parts.push("routing barriers (routing.routing_barriers)");
    }

    return (
        <ImportReviewStatusBanner
            tone="info"
            compact
            className={className}
            message={`Dry-run recommended before promote: ${parts.join(" and ")}. Run road or routing-barrier dry-run on the publish batch page when you need a routing impact preview. Simple families do not require dry-run.`}
        />
    );
}
