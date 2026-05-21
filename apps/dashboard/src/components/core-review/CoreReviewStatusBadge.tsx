import ReviewStatusBadge, {
    ConfidenceBadge,
    VerifiedBadge,
    type ReviewStatusBadgeVariant,
} from "@/src/components/review/ReviewStatusBadge";

export default ReviewStatusBadge;
export type CoreReviewStatusBadgeVariant = ReviewStatusBadgeVariant;
export const CoreReviewVerifiedBadge = VerifiedBadge;
export const CoreReviewConfidenceBadge = ConfidenceBadge;

export function CoreReviewActiveBadge({ active }: { active: boolean }) {
    return (
        <ReviewStatusBadge variant={active ? "active" : "inactive"} label={active ? "Active" : "Inactive"} />
    );
}
