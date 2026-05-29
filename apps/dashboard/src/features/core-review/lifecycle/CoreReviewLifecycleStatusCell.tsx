"use client";

import CoreReviewStatusBadge from "@/src/components/core-review/CoreReviewStatusBadge";

import CoreReviewVerificationStatusCell from "../components/CoreReviewVerificationStatusCell";
import { isCoreReviewRowDeleted } from "./coreReviewLifecycleUtils";

export default function CoreReviewLifecycleStatusCell({
    row,
}: {
    row: Record<string, unknown>;
}) {
    const deleted = isCoreReviewRowDeleted(row);
    const verificationStatus =
        (row.verificationStatus as string | null | undefined) ??
        (row.verification_status as string | null | undefined);
    const isVerifiedFallback =
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
            <CoreReviewVerificationStatusCell
                status={verificationStatus}
                isVerifiedFallback={isVerifiedFallback}
            />
        </div>
    );
}
