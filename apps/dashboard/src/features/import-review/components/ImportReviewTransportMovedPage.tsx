"use client";

import Link from "next/link";

import {
    IMPORT_REVIEW_TRANSPORT_MOVED_DETAIL,
    IMPORT_REVIEW_TRANSPORT_MOVED_MESSAGE,
} from "@/src/features/import-review/utils/deprecatedCoreBusPromotion";
import { importReviewPath, importTransportPath } from "@/src/lib/dashboardPaths";

export default function ImportReviewTransportMovedPage({
    slug,
}: {
    slug?: string | null;
}) {
    return (
        <main className="min-h-[50vh] p-6">
            <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-sky-200 bg-sky-50 p-6 text-sm text-sky-950 shadow-sm">
                <h1 className="text-lg font-semibold text-gray-900">Transport review has moved</h1>
                <p className="font-medium text-sky-950">{IMPORT_REVIEW_TRANSPORT_MOVED_MESSAGE}</p>
                <p className="text-gray-700">{IMPORT_REVIEW_TRANSPORT_MOVED_DETAIL}</p>
                {slug ? (
                    <p className="text-xs text-gray-600">
                        Requested legacy path:{" "}
                        <code className="rounded bg-white px-1 font-mono">{importReviewPath(slug)}</code>
                    </p>
                ) : null}
                <div className="flex flex-wrap gap-3 pt-2">
                    <Link
                        href={importTransportPath()}
                        className="inline-flex rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                        Open Import transport
                    </Link>
                    <Link
                        href={importReviewPath()}
                        className="inline-flex rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
                    >
                        Back to import review
                    </Link>
                </div>
            </div>
        </main>
    );
}
