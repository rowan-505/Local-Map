import type { ReactNode } from "react";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

/** Scroll wrapper + table min-width for wide import-review grids. */
export const IMPORT_REVIEW_TABLE_MIN_WIDTH_CLASS = "min-w-[1500px] w-full";

export function ImportReviewTableFrame({ children }: { children: ReactNode }) {
    return (
        <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            {children}
        </div>
    );
}

export type ImportReviewRowSurface = {
    rowClass: string;
    stickyCellClass: string;
};

/** Row tint + solid sticky-cell background (avoids bleed-through when scrolling). */
export function importReviewRowSurface(
    row: ImportReviewBuildingListItem,
    opts?: { selected?: boolean }
): ImportReviewRowSurface {
    const rd = (row.review_decision ?? "").toLowerCase();
    const rs = (row.review_status ?? "").toLowerCase();
    const ms = row.match_status ?? "";

    const parts: string[] = [];
    let stickyCellClass = "bg-white";

    if (opts?.selected) {
        parts.push("ring-2 ring-inset ring-blue-400/50");
    }

    if (ms === "manual_protected") {
        parts.push("ring-1 ring-inset ring-violet-300/70");
    }

    if (rd === "approved" || rs === "approved") {
        parts.push("bg-emerald-50/80");
        stickyCellClass = "bg-emerald-50";
    } else if (rd === "rejected" || rs === "rejected") {
        parts.push("bg-red-50/80");
        stickyCellClass = "bg-red-50";
    } else if (
        rd === "needs_more_review" ||
        rs === "needs_review" ||
        rs === "needs_more_review"
    ) {
        parts.push("bg-amber-50/70");
        stickyCellClass = "bg-amber-50";
    } else if (rd === "ignored" || rs === "ignored") {
        parts.push("bg-gray-50/90");
        stickyCellClass = "bg-gray-50";
    } else if (rd === "merged" || rs === "merged") {
        parts.push("bg-sky-50/85");
        stickyCellClass = "bg-sky-50";
    } else {
        parts.push("bg-white");
        stickyCellClass = "bg-white";
    }

    return { rowClass: parts.join(" "), stickyCellClass };
}

const STICKY_SHADOW = "shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.12)]";
const STICKY_LEFT_SHADOW = "shadow-[6px_0_10px_-6px_rgba(0,0,0,0.08)]";

export function importReviewStickyCheckboxThClass() {
    return `sticky left-0 z-30 w-10 min-w-[2.5rem] bg-gray-50 px-3 py-3 ${STICKY_LEFT_SHADOW}`;
}

export function importReviewStickyCheckboxTdClass(stickyBg: string) {
    return `sticky left-0 z-20 w-10 min-w-[2.5rem] px-3 py-3 align-top ${stickyBg} ${STICKY_LEFT_SHADOW}`;
}

export function importReviewStickyIdThClass() {
    return `sticky left-[2.5rem] z-30 min-w-[5.5rem] bg-gray-50 px-3 py-3 ${STICKY_LEFT_SHADOW}`;
}

export function importReviewStickyIdTdClass(stickyBg: string) {
    return `sticky left-[2.5rem] z-20 min-w-[5.5rem] px-3 py-3 align-top font-mono text-xs ${stickyBg} ${STICKY_LEFT_SHADOW}`;
}

export function importReviewStickyActionsThClass() {
    return `sticky right-0 z-30 min-w-[8.5rem] border-l border-gray-200/90 bg-gray-50 px-3 py-3 ${STICKY_SHADOW}`;
}

export function importReviewStickyActionsTdClass(stickyBg: string) {
    return `sticky right-0 z-20 min-w-[8.5rem] border-l border-gray-200/90 px-3 py-3 align-top ${stickyBg} ${STICKY_SHADOW}`;
}
