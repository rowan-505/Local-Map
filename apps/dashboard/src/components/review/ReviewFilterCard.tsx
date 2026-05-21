import type { ReactNode } from "react";

import { REVIEW_PALETTE, type ReviewPalette } from "./reviewPalette";

export default function ReviewFilterCard({
    children,
    footer,
    palette = "core",
}: {
    children: ReactNode;
    footer?: ReactNode;
    palette?: ReviewPalette;
}) {
    const p = REVIEW_PALETTE[palette];
    return (
        <section className={`rounded-xl border ${p.cardBorder} ${p.cardBg} p-4 shadow-sm sm:p-5`}>
            {children}
            {footer ? (
                <div className={`mt-3 border-t ${palette === "core" ? "border-slate-100" : "border-gray-100"} pt-3`}>
                    {footer}
                </div>
            ) : null}
        </section>
    );
}
