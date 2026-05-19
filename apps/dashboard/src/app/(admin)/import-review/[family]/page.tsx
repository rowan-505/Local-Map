import Link from "next/link";
import { notFound } from "next/navigation";

/** Dynamic segment for future families. `places` / `roads` / `buildings` use dedicated routes. */
const FAMILY_LABEL: Record<string, string> = {
    buildings: "Buildings",
};

export default async function ImportReviewFamilyPage({
    params,
    searchParams,
}: {
    params: Promise<{ family: string }>;
    searchParams: Promise<{ source_snapshot_version?: string; snapshot_version?: string }>;
}) {
    const { family: rawFamily } = await params;
    const family = rawFamily.toLowerCase();
    if (!FAMILY_LABEL[family]) {
        notFound();
    }

    const q = await searchParams;
    const snapshotVersion =
        q.source_snapshot_version?.trim() || q.snapshot_version?.trim() || "";
    const summaryQuery = snapshotVersion
        ? `?${new URLSearchParams({ source_snapshot_version: snapshotVersion }).toString()}`
        : "";

    return (
        <main className="p-6">
            <div className="mx-auto max-w-3xl space-y-6">
                <div className="border-b border-gray-200 pb-6">
                    <h1 className="text-2xl font-bold text-gray-900">
                        Review {FAMILY_LABEL[family].toLowerCase()}
                    </h1>
                    <p className="mt-2 text-sm text-gray-600">
                        Row-level review for this entity family is not implemented in the dashboard yet. Use the
                        summary page for counts, or the API for list and decision endpoints.
                    </p>
                    {snapshotVersion ? (
                        <p className="mt-3 text-sm text-gray-700">
                            <span className="text-gray-500">Source snapshot:</span>{" "}
                            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{snapshotVersion}</code>
                        </p>
                    ) : null}
                </div>
                <div className="flex flex-wrap gap-3">
                    <Link
                        href={`/import-review${summaryQuery}`}
                        className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                    >
                        Back to summary
                    </Link>
                </div>
            </div>
        </main>
    );
}
