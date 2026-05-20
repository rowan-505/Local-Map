"use client";

import type { ReactNode } from "react";

import ImportReviewReviewActionsMenu from "@/src/app/(admin)/import-review/_components/ImportReviewReviewActionsMenu";
import {
    IMPORT_REVIEW_TABLE_MIN_WIDTH_CLASS,
    ImportReviewTableFrame,
    importReviewRowSurface,
    importReviewStickyActionsTdClass,
    importReviewStickyActionsThClass,
    importReviewStickyCheckboxTdClass,
    importReviewStickyCheckboxThClass,
    importReviewStickyIdTdClass,
    importReviewStickyIdThClass,
} from "@/src/app/(admin)/import-review/_components/importReviewTableUi";
import type { ImportReviewBuildingListItem, ImportReviewDecision } from "@/src/lib/api";

import type { ImportReviewTableColumn } from "../config/types";
import { importReviewCellValue } from "../utils/entityPageUtils";
import ImportReviewStatusBadge from "./ImportReviewStatusBadge";

const STATUS_COLUMNS = new Set([
    "match_status",
    "auto_action",
    "review_status",
    "review_decision",
    "promotion_status",
]);

function renderCell(row: ImportReviewBuildingListItem, col: ImportReviewTableColumn): ReactNode {
    const text = importReviewCellValue(row, col);
    if (STATUS_COLUMNS.has(col.key) && text !== "—") {
        return <ImportReviewStatusBadge value={text} />;
    }
    return text;
}

export default function ImportReviewCandidatesTable({
    displayColumns,
    items,
    supportsSelection,
    selectedIds,
    canEdit,
    rowActionBusyId,
    emptyMessage,
    isLoading,
    onToggleSelectAll,
    onToggleRow,
    onRowClick,
    onRowDecision,
    onViewDetails,
}: {
    displayColumns: ImportReviewTableColumn[];
    items: ImportReviewBuildingListItem[];
    supportsSelection: boolean;
    selectedIds: Set<string>;
    canEdit: boolean;
    rowActionBusyId: string | null;
    emptyMessage: string;
    isLoading: boolean;
    onToggleSelectAll: (checked: boolean) => void;
    onToggleRow: (id: string, checked: boolean) => void;
    onRowClick: (row: ImportReviewBuildingListItem) => void;
    onRowDecision: (row: ImportReviewBuildingListItem, decision: ImportReviewDecision) => void;
    onViewDetails: (row: ImportReviewBuildingListItem) => void;
}) {
    const colSpan = displayColumns.length + (supportsSelection ? 3 : 2);

    return (
        <ImportReviewTableFrame>
            <table className={`${IMPORT_REVIEW_TABLE_MIN_WIDTH_CLASS} w-full text-left text-sm`}>
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                        {supportsSelection ? (
                            <th className={importReviewStickyCheckboxThClass()}>
                                <input
                                    type="checkbox"
                                    checked={items.length > 0 && selectedIds.size === items.length}
                                    onChange={(e) => onToggleSelectAll(e.target.checked)}
                                />
                            </th>
                        ) : null}
                        <th className={importReviewStickyIdThClass()}>ID</th>
                        {displayColumns.map((col) => (
                            <th key={col.key} className="px-3 py-2 font-medium whitespace-nowrap">
                                {col.label}
                            </th>
                        ))}
                        <th className={importReviewStickyActionsThClass()}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {isLoading && items.length === 0 ? (
                        <tr>
                            <td colSpan={colSpan} className="px-4 py-8 text-center text-gray-500">
                                Loading candidates…
                            </td>
                        </tr>
                    ) : items.length === 0 ? (
                        <tr>
                            <td colSpan={colSpan} className="px-4 py-8 text-center text-gray-500">
                                {emptyMessage}
                            </td>
                        </tr>
                    ) : (
                        items.map((row) => {
                            const rowSurface = importReviewRowSurface(row, {
                                selected: supportsSelection && selectedIds.has(row.id),
                            });
                            return (
                                <tr
                                    key={row.id}
                                    className={`${rowSurface.rowClass} cursor-pointer border-b border-gray-100`}
                                    onClick={() => onRowClick(row)}
                                >
                                    {supportsSelection ? (
                                        <td
                                            className={importReviewStickyCheckboxTdClass(rowSurface.stickyCellClass)}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(row.id)}
                                                onChange={(e) => onToggleRow(row.id, e.target.checked)}
                                            />
                                        </td>
                                    ) : null}
                                    <td
                                        className={`${importReviewStickyIdTdClass(rowSurface.stickyCellClass)} font-mono text-xs`}
                                    >
                                        {row.id}
                                    </td>
                                    {displayColumns.map((col) => (
                                        <td
                                            key={col.key}
                                            className={`max-w-[220px] truncate px-3 py-2 ${col.mono ? "font-mono text-xs" : ""}`}
                                            title={importReviewCellValue(row, col)}
                                        >
                                            {renderCell(row, col)}
                                        </td>
                                    ))}
                                    <td
                                        className={importReviewStickyActionsTdClass(rowSurface.stickyCellClass)}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <ImportReviewReviewActionsMenu
                                            busy={rowActionBusyId === row.id}
                                            disabled={!canEdit}
                                            onDecision={(d) => onRowDecision(row, d)}
                                            onViewDetails={() => onViewDetails(row)}
                                        />
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </ImportReviewTableFrame>
    );
}
