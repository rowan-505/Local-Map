import type { ReactNode } from "react";

import { REVIEW_PALETTE, type ReviewPalette } from "./reviewPalette";

export default function ReviewDetailField({
    label,
    children,
    palette = "core",
}: {
    label: string;
    children: ReactNode;
    palette?: ReviewPalette;
}) {
    const p = REVIEW_PALETTE[palette];
    return (
        <div>
            <div className={`text-xs font-medium uppercase tracking-wide ${p.muted}`}>{label}</div>
            <div className={`mt-1 text-sm ${palette === "core" ? "text-slate-800" : "text-gray-800"}`}>
                {children}
            </div>
        </div>
    );
}
