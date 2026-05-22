"use client";

import CandidateJsonSection from "./detail/CandidateJsonSection";
import type { ImportReviewAddressSourceContext } from "@/src/lib/api";

function dash(value: string | null | undefined): string {
    if (!value?.trim()) {
        return "—";
    }
    return value;
}

export default function AddressSourceContextSection({
    sourceContext,
    sourceTags,
    externalId,
    sourceEntityType,
}: {
    sourceContext: ImportReviewAddressSourceContext | null | undefined;
    sourceTags?: unknown;
    externalId?: string | null;
    sourceEntityType?: string | null;
}) {
    const ctx = sourceContext;

    return (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    Source / related place evidence
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                    OSM source context from import tags — not an address component. The generated full
                    address below comes only from structured address components.
                </p>
            </div>

            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                    <dt className="text-gray-500">Source name</dt>
                    <dd>{dash(ctx?.source_name)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Source name (EN)</dt>
                    <dd>{dash(ctx?.source_name_en)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Source name (MY)</dt>
                    <dd>{dash(ctx?.source_name_my)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Source type</dt>
                    <dd className="font-mono text-xs">{dash(ctx?.source_type_hint)}</dd>
                </div>
                <div className="sm:col-span-2">
                    <dt className="text-gray-500">Category hints</dt>
                    <dd className="text-xs">{dash(ctx?.source_category_hint)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Phone</dt>
                    <dd>{dash(ctx?.phone)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Email</dt>
                    <dd>{dash(ctx?.email)}</dd>
                </div>
                <div className="sm:col-span-2">
                    <dt className="text-gray-500">Opening hours</dt>
                    <dd className="text-xs">{dash(ctx?.opening_hours)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">external_id</dt>
                    <dd className="font-mono text-xs">{dash(externalId)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">source_entity_type</dt>
                    <dd>{dash(sourceEntityType)}</dd>
                </div>
            </dl>

            <details className="text-xs">
                <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
                    Raw source tags (debug)
                </summary>
                <div className="mt-2">
                    <CandidateJsonSection title="source_tags" data={sourceTags} />
                </div>
            </details>
        </section>
    );
}
