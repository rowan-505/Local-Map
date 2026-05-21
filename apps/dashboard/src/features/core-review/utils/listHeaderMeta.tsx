import type { CoreReviewListDraft } from "../hooks/useCoreReviewListState";
import type { CoreReviewVerificationTotals } from "../hooks/useCoreReviewVerificationTotals";

export function formatCoreReviewHeaderMeta(
    totals: CoreReviewVerificationTotals,
    appliedDraft: CoreReviewListDraft,
    supportsVerification: boolean
): string | undefined {
    if (totals.isLoading) {
        return "Loading counts…";
    }

    if (!supportsVerification) {
        return `${totals.total.toLocaleString()} record${totals.total === 1 ? "" : "s"}`;
    }

    const total = totals.total.toLocaleString();
    const verified = totals.verified.toLocaleString();
    const unverified = totals.unverified.toLocaleString();

    if (appliedDraft.verifiedFilter === "verified") {
        return `${verified} verified (filtered) · ${total} total in scope`;
    }
    if (appliedDraft.verifiedFilter === "unverified") {
        return `${unverified} unverified (filtered) · ${total} total in scope`;
    }

    return `${total} total · ${verified} verified · ${unverified} unverified`;
}
