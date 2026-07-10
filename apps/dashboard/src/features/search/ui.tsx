import { useEffect } from "react";

export const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

export const INPUT_CLASS =
    "min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

export const PRIMARY_BTN =
    "rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50";

export const SECONDARY_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

/** Long Myanmar/English labels in tables and panels. */
export const CELL_TEXT_CLASS = "max-w-[14rem] break-words [overflow-wrap:anywhere]";

export function useClampPageToTotal(
    page: number,
    setPage: (value: number | ((current: number) => number)) => void,
    total: number,
    pageSize: number,
): void {
    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(total / pageSize));
        if (page > maxPage) {
            setPage(maxPage);
        }
    }, [page, setPage, total, pageSize]);
}

export function ActiveBadge({ active }: { active: boolean }) {
    return active ? (
        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100">
            Active
        </span>
    ) : (
        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
            Disabled
        </span>
    );
}

const SYNC_STATE_CLASS: Record<string, string> = {
    current: "bg-emerald-50 text-emerald-800 ring-emerald-100",
    stale: "bg-amber-50 text-amber-900 ring-amber-100",
    missing: "bg-red-50 text-red-800 ring-red-100",
    ghost: "bg-violet-50 text-violet-800 ring-violet-100",
};

export function SyncStateBadge({ state, label }: { state: string; label: string }) {
    return (
        <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                SYNC_STATE_CLASS[state] ?? "bg-gray-100 text-gray-600 ring-gray-200"
            }`}
        >
            {label}
        </span>
    );
}
