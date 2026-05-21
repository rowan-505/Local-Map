export { ReviewLoadingCard as CoreReviewLoadingCard } from "@/src/components/review";
export { default as CoreReviewErrorCard } from "@/src/components/review/ReviewErrorState";
export { default as CoreReviewDetailField } from "@/src/components/review/ReviewDetailField";

/** Success banner for core review mutations. */
export function CoreReviewSuccessBanner({ message }: { message: string }) {
    if (!message.trim()) {
        return null;
    }
    return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm">
            {message}
        </div>
    );
}
