"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useDashboardRoleAccess } from "@/src/hooks/useDashboardRoleAccess";
import {
    coreReviewPath,
    sidebarModuleFromPathname,
    viewerDashboardModules,
} from "@/src/lib/dashboardNavigation";

export default function DashboardViewerRouteGate({ children }: { children: ReactNode }) {
    const access = useDashboardRoleAccess();
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const moduleKey = sidebarModuleFromPathname(pathname);
    const sensitiveModule = moduleKey !== null && !viewerDashboardModules.has(moduleKey);
    const blocked =
        access.ready &&
        access.isViewer &&
        sensitiveModule;

    useEffect(() => {
        if (blocked) {
            router.replace(coreReviewPath());
        }
    }, [blocked, router]);

    if ((!access.ready && sensitiveModule) || blocked) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-7xl rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
                    {blocked ? "Returning to the read-only dashboard…" : "Checking dashboard access…"}
                </div>
            </main>
        );
    }

    return children;
}
