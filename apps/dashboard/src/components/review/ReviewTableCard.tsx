import type { ReactNode } from "react";

import { REVIEW_PALETTE, type ReviewPalette } from "./reviewPalette";

export default function ReviewTableCard({
    children,
    caption,
    palette = "core",
    maxHeightClass = "max-h-[min(70vh,720px)]",
}: {
    children: ReactNode;
    caption?: ReactNode;
    palette?: ReviewPalette;
    maxHeightClass?: string;
}) {
    const p = REVIEW_PALETTE[palette];
    const captionBorder = palette === "core" ? "border-slate-100" : "border-gray-100";
    return (
        <section className={`overflow-hidden rounded-xl border ${p.cardBorder} ${p.cardBg} shadow-sm`}>
            {caption ? (
                <div className={`border-b ${captionBorder} px-4 py-2 text-xs ${p.muted} sm:px-5`}>
                    {caption}
                </div>
            ) : null}
            <div className={`${maxHeightClass} overflow-x-auto overflow-y-auto`}>{children}</div>
        </section>
    );
}
