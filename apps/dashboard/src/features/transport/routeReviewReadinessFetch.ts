/**
 * Pure helpers for route review-readiness fetch gating.
 * Prevents duplicate GETs when the parent re-renders with a new `route` object
 * identity but the same public id.
 */

export function shouldFetchRouteReviewReadiness(input: {
    readonly routeLoading: boolean;
    readonly routePublicId: string | null | undefined;
    readonly lastRequestedPublicId: string | null;
}): boolean {
    if (input.routeLoading) {
        return false;
    }
    const id = input.routePublicId?.trim() ?? "";
    if (!id) {
        return false;
    }
    if (input.lastRequestedPublicId === id) {
        return false;
    }
    return true;
}

/** True when a review mutation already returned readiness — skip a second GET. */
export function shouldReloadReadinessAfterReview(result: {
    readonly readiness?: unknown;
}): boolean {
    return result.readiness == null;
}
