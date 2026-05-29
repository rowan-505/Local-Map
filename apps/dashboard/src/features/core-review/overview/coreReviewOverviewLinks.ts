import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import {
    verificationStatusToFilterParam,
    type CoreReviewVerificationStatus,
} from "../verification/coreReviewVerificationFilter";

export function coreReviewModuleHref(entityPath: string): string {
    return coreReviewPath(entityPath);
}

export function coreReviewStatusFilterHref(
    entityPath: string,
    status: CoreReviewVerificationStatus
): string {
    const params = new URLSearchParams({
        verification_status: verificationStatusToFilterParam(status),
    });
    return `${coreReviewPath(entityPath)}?${params.toString()}`;
}
