"use client";

import type { ReactNode } from "react";

import { Card, CardContent } from "@/src/components/ui/card";

import type { ImportTransportListItem, ImportTransportTableColumn } from "../config/types";
import { importTransportCellValue } from "../utils/entityPageUtils";
import ImportTransportStatusBadge from "./ImportTransportStatusBadge";

const STATUS_COLUMNS = new Set([
    "review_status",
    "review_decision",
    "promotion_status",
    "validation_status",
    "geometry_status",
]);

function renderCell(row: ImportTransportListItem, col: ImportTransportTableColumn): ReactNode {
    const text = importTransportCellValue(row, col);
    if (STATUS_COLUMNS.has(col.key) && text !== "—") {
        return <ImportTransportStatusBadge value={text} />;
    }
    if (col.mono) {
        return <span className="font-mono text-xs text-gray-700">{text}</span>;
    }
    return text;
}

export default function ImportTransportCandidatesTable({
    displayColumns,
    items,
    emptyMessage,
    isLoading,
    onRowClick,
}: {
    displayColumns: ImportTransportTableColumn[];
    items: ImportTransportListItem[];
    emptyMessage: string;
    isLoading: boolean;
    onRowClick: (row: ImportTransportListItem) => void;
}) {
    const colSpan = displayColumns.length + 1;

    return (
        <Card className="overflow-hidden border-gray-200 shadow-sm">
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="min-w-[960px] w-full text-left text-sm">
                        <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                            <tr>
                                {displayColumns.map((col) => (
                                    <th
                                        key={col.key}
                                        className="px-3 py-2 font-medium whitespace-nowrap"
                                    >
                                        {col.label}
                                    </th>
                                ))}
                                <th className="px-3 py-2 font-medium whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading && items.length === 0 ? (
                                <tr>
                                    <td colSpan={colSpan} className="px-4 py-8 text-center text-gray-500">
                                        Loading transport candidates…
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={colSpan} className="px-4 py-8 text-center text-gray-500">
                                        {emptyMessage}
                                    </td>
                                </tr>
                            ) : (
                                items.map((row) => (
                                    <tr
                                        key={row.id}
                                        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                                        onClick={() => onRowClick(row)}
                                    >
                                        {displayColumns.map((col) => (
                                            <td
                                                key={col.key}
                                                className="max-w-[240px] truncate px-3 py-2 text-gray-800"
                                            >
                                                {renderCell(row, col)}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2">
                                            <button
                                                type="button"
                                                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRowClick(row);
                                                }}
                                            >
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
}
