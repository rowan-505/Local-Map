"use client";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import {
    buildConflictFieldCompareRows,
    type ConflictFieldChoice,
} from "../../utils/conflictFieldCompare";
import { IMPORT_REVIEW_SELECT_CLASS } from "../../utils/entityPageUtils";

export default function CandidateFieldCompareSection({
    row,
    choices,
    editable,
    onChoiceChange,
}: {
    row: ImportReviewBuildingListItem;
    choices: Record<string, ConflictFieldChoice>;
    editable: boolean;
    onChoiceChange: (field: string, choice: ConflictFieldChoice) => void;
}) {
    const rows = buildConflictFieldCompareRows(row, choices);

    if (rows.length === 0) {
        return (
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Field comparison
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                    No comparable field snapshots on this candidate yet.
                </p>
            </section>
        );
    }

    return (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Field comparison
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                    Existing core vs imported values. Set Final choice when using Merge fields.
                </p>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                            <th className="px-2 py-2 font-semibold">Field</th>
                            <th className="px-2 py-2 font-semibold">Existing core</th>
                            <th className="px-2 py-2 font-semibold">Imported</th>
                            <th className="px-2 py-2 font-semibold">Final choice</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.field} className="border-b border-gray-100 align-top">
                                <td className="px-2 py-2 font-mono text-xs text-gray-700">{r.field}</td>
                                <td className="px-2 py-2 text-gray-900">{r.existing}</td>
                                <td className="px-2 py-2 text-gray-900">{r.imported}</td>
                                <td className="px-2 py-2">
                                    {editable ? (
                                        <select
                                            value={choices[r.field] ?? "unset"}
                                            onChange={(e) =>
                                                onChoiceChange(
                                                    r.field,
                                                    e.target.value as ConflictFieldChoice
                                                )
                                            }
                                            className={IMPORT_REVIEW_SELECT_CLASS}
                                        >
                                            <option value="unset">—</option>
                                            <option value="existing">Existing</option>
                                            <option value="imported">Imported</option>
                                        </select>
                                    ) : (
                                        <span className="text-gray-500">
                                            {(choices[r.field] ?? "unset") === "unset"
                                                ? "—"
                                                : choices[r.field]}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
