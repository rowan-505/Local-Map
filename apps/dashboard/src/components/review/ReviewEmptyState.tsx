import { REVIEW_PALETTE, type ReviewPalette } from "./reviewPalette";

export default function ReviewEmptyState({
    title,
    description,
    palette = "core",
}: {
    title: string;
    description?: string;
    palette?: ReviewPalette;
}) {
    const p = REVIEW_PALETTE[palette];
    return (
        <div
            className={`rounded-xl border border-dashed ${p.dashedBorder} ${p.cardBg} px-6 py-10 text-center shadow-sm`}
        >
            <p className={`text-sm font-medium ${p.title}`}>{title}</p>
            {description ? <p className={`mt-1 text-sm ${p.body}`}>{description}</p> : null}
        </div>
    );
}
