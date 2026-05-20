import Link from "next/link";
import { redirect } from "next/navigation";

import {
    getImportReviewEntityByApiFamily,
    getImportReviewEntityBySlug,
    importReviewEntityHref,
    importReviewOverviewHref,
} from "@/src/lib/importReviewEntityConfig";

/** Dedicated legacy route — road routing-validation drawer not yet on shared shell. */
const LEGACY_DEDICATED = new Set(["roads"]);

export default async function ImportReviewFamilyCatchAllPage({
    params,
    searchParams,
}: {
    params: Promise<{ family: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { family: rawFamily } = await params;
    const family = rawFamily.trim().toLowerCase();
    const q = await searchParams;

    const sp = new URLSearchParams();
    for (const [key, val] of Object.entries(q)) {
        if (typeof val === "string") {
            sp.set(key, val);
        } else if (Array.isArray(val) && val[0]) {
            sp.set(key, val[0]);
        }
    }

    const bySlug = getImportReviewEntityBySlug(family);
    if (bySlug && !LEGACY_DEDICATED.has(bySlug.slug)) {
        redirect(importReviewEntityHref(bySlug.slug, sp));
    }

    const byApi = getImportReviewEntityByApiFamily(family);
    if (byApi && !LEGACY_DEDICATED.has(byApi.slug)) {
        redirect(importReviewEntityHref(byApi.slug, sp));
    }

    if (LEGACY_DEDICATED.has(family)) {
        redirect(`/import-review/${family}${sp.toString() ? `?${sp.toString()}` : ""}`);
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-lg space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
                <h1 className="text-lg font-semibold text-gray-900">Unknown import-review entity</h1>
                <p>
                    No dashboard page is configured for family{" "}
                    <code className="rounded bg-amber-100 px-1 font-mono">{rawFamily}</code>.
                </p>
                <p className="text-gray-700">
                    Supported URL slugs use dashes (e.g.{" "}
                    <code className="rounded bg-amber-100 px-1">bus-stops</code>,{" "}
                    <code className="rounded bg-amber-100 px-1">water-lines</code>). API paths use underscores.
                </p>
                <Link
                    href={importReviewOverviewHref(sp)}
                    className="inline-flex rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                >
                    Back to overview
                </Link>
            </div>
        </main>
    );
}
