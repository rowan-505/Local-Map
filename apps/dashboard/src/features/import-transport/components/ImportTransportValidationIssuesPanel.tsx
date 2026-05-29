"use client";

import ImportTransportStatusBadge from "./ImportTransportStatusBadge";
import type { ImportTransportValidationIssue } from "../config/types";

export default function ImportTransportValidationIssuesPanel({
    issues,
    isLoading,
    error,
}: {
    issues: ImportTransportValidationIssue[];
    isLoading?: boolean;
    error?: string;
}) {
    if (isLoading) {
        return <p className="text-sm text-gray-500">Loading validation issues…</p>;
    }

    if (error) {
        return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>;
    }

    if (issues.length === 0) {
        return (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                No open validation issues.
            </p>
        );
    }

    return (
        <ul className="space-y-2">
            {issues.map((issue) => (
                <li
                    key={issue.id}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800"
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <ImportTransportStatusBadge value={issue.severity} />
                        <span className="font-mono text-xs text-gray-500">{issue.issue_code}</span>
                    </div>
                    <p className="mt-1">{issue.message}</p>
                </li>
            ))}
        </ul>
    );
}
