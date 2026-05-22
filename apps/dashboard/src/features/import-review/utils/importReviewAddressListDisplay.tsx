import type { ImportReviewBuildingListItem } from "@/src/lib/api";

function dash(value: string | null | undefined): string {
    if (!value?.trim()) {
        return "—";
    }
    return value;
}

/** Addresses: generated full address with optional muted source sublines. */
export function importReviewAddressDisplayCell(row: ImportReviewBuildingListItem) {
    const address = dash(row.display_full_address);
    const sourceName = dash(row.source_name);
    const sourceType = row.source_type_hint?.trim();
    return (
        <span className="block max-w-[300px]">
            <span className="block truncate font-medium text-gray-900">{address}</span>
            <span className="block truncate text-xs text-gray-500">
                Source / place: {sourceName}
            </span>
            {sourceType ? (
                <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                    {sourceType}
                </span>
            ) : null}
        </span>
    );
}

export function importReviewAddressSourceTypeCell(row: ImportReviewBuildingListItem) {
    const sourceType = row.source_type_hint?.trim();
    if (!sourceType) {
        return <span className="text-gray-400">—</span>;
    }
    return (
        <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
            {sourceType}
        </span>
    );
}
