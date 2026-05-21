import Link from "next/link";

/**
 * Thin hub for map-first candidate review. Detailed snapshot counts stay on `/import-review`.
 */
export default function DataReviewIndexPage() {
    return (
        <main className="p-6">
            <div className="mx-auto max-w-2xl space-y-6">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Data review</h1>
                    <p className="mt-2 text-sm text-gray-600">
                        Map-assisted review of import_review candidates via the dashboard API. Pass{" "}
                        <code className="rounded bg-gray-100 px-1 text-xs">source_snapshot_version</code> in the URL
                        (legacy alias <code className="rounded bg-gray-100 px-1 text-xs">snapshot_version</code> is
                        still accepted). Aggregate counts:{" "}
                        <Link href="/dashboard/import-review" className="font-medium text-blue-700 underline">
                            Import review
                        </Link>
                        .
                    </p>
                </header>
                <ul className="space-y-3 text-sm">
                    <li>
                        <Link
                            href="/data-review/buildings"
                            className="font-medium text-blue-700 underline hover:text-blue-900"
                        >
                            Buildings
                        </Link>{" "}
                        — polygon footprint preview
                    </li>
                    <li>
                        <Link
                            href="/data-review/places"
                            className="font-medium text-blue-700 underline hover:text-blue-900"
                        >
                            Places
                        </Link>{" "}
                        — point preview
                    </li>
                    <li>
                        <Link
                            href="/data-review/roads"
                            className="font-medium text-blue-700 underline hover:text-blue-900"
                        >
                            Roads
                        </Link>{" "}
                        — line preview
                    </li>
                </ul>
            </div>
        </main>
    );
}
