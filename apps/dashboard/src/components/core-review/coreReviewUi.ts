export { confidenceBadgeVariant } from "@/src/components/review/reviewPalette";
import { reviewTableRowClass } from "@/src/components/review/reviewPalette";

/** Core review table row highlight (sky selected state). */
export function coreReviewTableRowClass(isSelected: boolean, extra?: string): string {
    return reviewTableRowClass("core", isSelected, extra);
}
