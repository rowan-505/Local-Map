"use client";

import CoreReviewStatusBadge from "@/src/components/core-review/CoreReviewStatusBadge";
import { VerifiedBadge } from "@/src/components/review/ReviewStatusBadge";

import { isCoreReviewRowDeleted } from "./coreReviewLifecycleUtils";

export default function CoreReviewLifecycleStatusCell({
    row,
}: {
    row: Record<string, unknown>;
}) {
    const deleted = isCoreReviewRowDeleted(row);
    const verified =
        row.isVerified === true || row.is_verified === true
            ? true
            : row.isVerified === false || row.is_verified === false
              ? false
              : null;

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {deleted ? (
                <CoreReviewStatusBadge variant="deleted" label="Deleted" />
            ) : (
                <CoreReviewStatusBadge variant="active" label="Active" />
            )}
            {verified !== null ? <VerifiedBadge verified={verified} /> : null}
        </div>
    );
}
