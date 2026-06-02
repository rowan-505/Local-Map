import { redirect } from "next/navigation";

type PageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** Legacy data-review roads URL — unified on import-review entity page. */
export default async function DataReviewRoadsPage({ searchParams }: PageProps) {
    const resolved = searchParams ? await searchParams : {};
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(resolved)) {
        if (value === undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const v of value) {
                params.append(key, v);
            }
        } else {
            params.set(key, value);
        }
    }
    const query = params.toString();
    redirect(`/dashboard/import-review/roads${query ? `?${query}` : ""}`);
}
