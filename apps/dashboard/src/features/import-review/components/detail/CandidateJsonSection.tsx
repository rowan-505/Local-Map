"use client";

import { safeJson } from "../../utils/detailDrawerUtils";

export default function CandidateJsonSection({
    title,
    data,
}: {
    title: string;
    data: unknown;
}) {
    return (
        <details className="group rounded-lg border border-gray-200 bg-gray-50/80">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                    <span className="text-gray-400 transition group-open:rotate-90">▸</span>
                    {title}
                </span>
            </summary>
            <pre className="max-h-56 overflow-auto border-t border-gray-200 p-3 text-xs text-gray-800">
                {safeJson(data)}
            </pre>
        </details>
    );
}
