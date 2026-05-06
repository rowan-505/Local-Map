import type { ReactNode } from "react";

import DashboardSidebar from "@/src/components/layout/DashboardSidebar";
import { BuildingTileVersionProvider } from "@/src/components/map/BuildingTileVersionContext";

/**
 * Shared shell for authenticated data modules (`/dashboard`, `/places`, `/streets`, etc.).
 * Route group name `(admin)` is not part of URLs.
 */
export default function AdminModuleLayout({ children }: { children: ReactNode }) {
    return (
        <BuildingTileVersionProvider>
            <div className="flex min-h-screen bg-gray-100">
                <DashboardSidebar />
                <div className="min-w-0 flex-1">{children}</div>
            </div>
        </BuildingTileVersionProvider>
    );
}
