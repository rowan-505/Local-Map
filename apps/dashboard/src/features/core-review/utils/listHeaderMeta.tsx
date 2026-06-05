import type { CoreReviewListDraft } from "../hooks/useCoreReviewListState";
import type { CoreReviewVerificationTotals } from "../hooks/useCoreReviewVerificationTotals";
import type { CoreReviewVerificationStatusFilter } from "../verification/coreReviewVerificationFilter";

export function formatCoreReviewHeaderMeta(
    totals: CoreReviewVerificationTotals,
    appliedDraft: CoreReviewListDraft,
    supportsVerification: boolean
): string | undefined {
    if (totals.isLoading) {
        return "Counting…";
    }

    if (!supportsVerification) {
        return `${totals.total.toLocaleString()} record${totals.total === 1 ? "" : "s"}`;
    }

    const total = totals.total.toLocaleString();
    const verified = totals.verified.toLocaleString();
    const unverified = totals.unverified.toLocaleString();

    if (appliedDraft.verificationStatusFilter === "verified") {
        return `${verified} verified (filtered) · ${total} total in scope`;
    }
    if (appliedDraft.verificationStatusFilter === "unverified") {
        return `${unverified} unverified (filtered) · ${total} total in scope`;
    }
    if (appliedDraft.verificationStatusFilter !== "all") {
        const labels: Record<Exclude<CoreReviewVerificationStatusFilter, "all">, string> = {
            verified: "verified",
            unverified: "unverified",
            needs_fix: "needs fix",
            questionable: "questionable",
            rejected: "rejected",
        };
        const label = labels[appliedDraft.verificationStatusFilter];
        return `${total} ${label} (filtered)`;
    }

    return `${total} total · ${verified} verified · ${unverified} unverified`;
}
