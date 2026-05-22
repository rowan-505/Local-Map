"use client";

import type { RoadDryRunItemStatus } from "@/src/lib/api";
import {
    ROAD_DRY_RUN_STATUS_LABELS,
    roadDryRunStatusBadgeClass,
} from "@/src/features/import-review/utils/importReviewRoadDryRunUi";

export default function ImportReviewRoadDryRunStatusBadge({
    status,
}: {
    status: RoadDryRunItemStatus;
}) {
    return (
        <span
            className={`inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roadDryRunStatusBadgeClass(status)}`}
        >
            {ROAD_DRY_RUN_STATUS_LABELS[status]}
        </span>
    );
}
