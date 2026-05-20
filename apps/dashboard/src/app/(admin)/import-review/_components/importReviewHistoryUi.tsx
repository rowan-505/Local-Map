"use client";

import { useState } from "react";

export function formatHistoryDate(iso: string | null | undefined): string {
    if (!iso) {
        return "—";
    }
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

export function HistoryStatusBadge({ status }: { status: string }) {
    const s = status.trim().toLowerCase();
    const cls =
        s === "promoted" || s === "success" || s === "review_completed"
            ? "bg-emerald-100 text-emerald-900"
            : s === "failed" || s === "blocked"
              ? "bg-red-100 text-red-900"
              : s === "validating" || s === "promoting" || s === "reviewing"
                ? "bg-amber-100 text-amber-900"
                : "bg-gray-100 text-gray-800";
    return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>
    );
}

export function CollapsibleJson({ label, value }: { label: string; value: unknown }) {
    const [open, setOpen] = useState(false);
    if (value === null || value === undefined) {
        return null;
    }
    const text =
        typeof value === "string"
            ? value
            : JSON.stringify(value, null, 2);
    if (!text || text === "{}" || text === "null") {
        return null;
    }
    return (
        <div className="rounded-md border border-gray-200 bg-gray-50">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-gray-900"
            >
                {label}
                <span className="text-xs text-gray-500">{open ? "Hide" : "Show"}</span>
            </button>
            {open ? (
                <pre className="max-h-64 overflow-auto border-t border-gray-200 px-3 py-2 text-xs text-gray-800 whitespace-pre-wrap">
                    {text}
                </pre>
            ) : null}
        </div>
    );
}

export function CleanupPlaceholderButton() {
    return (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
            <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-400"
            >
                Permanent cleanup — coming later
            </button>
            <p className="mt-2 text-xs text-gray-500">
                Only after core verification and audit retention are stable. Promoted import_review rows remain
                soft-hidden, not physically deleted.
            </p>
        </div>
    );
}
