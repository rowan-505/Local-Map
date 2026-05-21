"use client";

import type { ReactNode } from "react";

import type { CoreEntityFieldDef } from "@/src/lib/core-review/entityConfigs/types";

function readDetailPath(record: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = record;
    for (const part of parts) {
        if (current == null || typeof current !== "object") {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function formatDate(value: unknown): string {
    if (!value) return "—";
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
}

export type CoreReadonlyMetadataProps = {
    detail: Record<string, unknown> | null;
    fields: CoreEntityFieldDef[];
    title?: string;
};

export default function CoreReadonlyMetadata({
    detail,
    fields,
    title = "Record metadata",
}: CoreReadonlyMetadataProps) {
    if (!detail || fields.length === 0) {
        return null;
    }

    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                {fields.map((field) => {
                    const raw = field.detailPath ? readDetailPath(detail, field.detailPath) : undefined;
                    let display: ReactNode;

                    if (field.format) {
                        display = field.format(raw);
                    } else if (field.type === "date-readonly") {
                        display = formatDate(raw);
                    } else if (field.type === "json-readonly") {
                        display =
                            raw == null ? (
                                "—"
                            ) : (
                                <pre className="mt-1 max-h-48 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs font-mono text-slate-800">
                                    {JSON.stringify(raw, null, 2)}
                                </pre>
                            );
                    } else if (raw == null || raw === "") {
                        display = "—";
                    } else {
                        display = String(raw);
                    }

                    return (
                        <div key={field.key}>
                            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                {field.label}
                            </dt>
                            <dd className="mt-0.5 text-sm text-slate-900">{display}</dd>
                        </div>
                    );
                })}
            </dl>
        </div>
    );
}
