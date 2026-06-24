import { redirect } from "next/navigation";

import { transportPath } from "@/src/lib/dashboardNavigation";

/**
 * Legacy full-page route detail URL. Route detail now opens as a drawer on the
 * Routes list, so this redirects to `…/routes?route=<publicId>` (preserving any
 * other query params). The target is a different path (the list), so there is no
 * redirect loop. Direct/shared links keep working.
 */
export default async function TransportRouteDetailRoutePage({
    params,
    searchParams,
}: {
    params: Promise<{ publicId: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { publicId } = await params;
    const sp = await searchParams;

    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
        if (key === "route") continue;
        if (Array.isArray(value)) {
            for (const v of value) usp.append(key, v);
        } else if (value !== undefined) {
            usp.set(key, value);
        }
    }
    usp.set("route", publicId);

    redirect(`${transportPath("routes")}?${usp.toString()}`);
}
