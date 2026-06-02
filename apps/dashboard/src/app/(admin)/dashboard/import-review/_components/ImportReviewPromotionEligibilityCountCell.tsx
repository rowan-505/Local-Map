"use client";

type ImportReviewPromotionEligibilityCountCellProps = {
    count: number;
    onOpen?: () => void;
};

export default function ImportReviewPromotionEligibilityCountCell({
    count,
    onOpen,
}: ImportReviewPromotionEligibilityCountCellProps) {
    const formatted = count.toLocaleString();

    if (count <= 0 || !onOpen) {
        return <span className="tabular-nums text-gray-400">{formatted}</span>;
    }

    return (
        <button
            type="button"
            onClick={onOpen}
            className="tabular-nums font-medium text-blue-700 underline-offset-2 hover:text-blue-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            aria-label={`View ${formatted} candidates`}
        >
            {formatted}
        </button>
    );
}
