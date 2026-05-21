import type { ReactNode } from "react";

import { REVIEW_PALETTE, type ReviewPalette } from "./reviewPalette";

export default function ReviewFamilyPageShell({
    children,
    palette = "core",
    maxWidthClass = "max-w-[1680px]",
}: {
    children: ReactNode;
    palette?: ReviewPalette;
    /** Override max width (import review map sidebar layout uses wider shell in-page). */
    maxWidthClass?: string;
}) {
    const p = REVIEW_PALETTE[palette];
    return (
        <main className={`min-h-screen overflow-x-hidden ${p.pageBg} p-4 sm:p-6`}>
            <div className={`mx-auto ${maxWidthClass} space-y-6`}>{children}</div>
        </main>
    );
}
