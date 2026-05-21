import type { ReactNode } from "react";

import { REVIEW_PALETTE, type ReviewPalette } from "./reviewPalette";

export default function ReviewHeaderCard({
    title,
    description,
    meta,
    actions,
    palette = "core",
}: {
    title: string;
    description?: ReactNode;
    meta?: ReactNode;
    actions?: ReactNode;
    palette?: ReviewPalette;
}) {
    const p = REVIEW_PALETTE[palette];
    return (
        <header
            className={`flex flex-col gap-4 rounded-xl border ${p.cardBorder} ${p.cardBg} p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between`}
        >
            <div className="min-w-0">
                <h1 className={`text-xl font-bold sm:text-2xl ${p.title}`}>{title}</h1>
                {description ? <p className={`mt-1 max-w-3xl text-sm ${p.body}`}>{description}</p> : null}
                {meta ? <div className={`mt-2 text-xs ${p.muted}`}>{meta}</div> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
    );
}
