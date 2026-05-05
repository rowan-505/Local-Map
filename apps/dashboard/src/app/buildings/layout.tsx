import type { ReactNode } from "react";

import DashboardSidebar from "@/src/components/layout/DashboardSidebar";

export default function BuildingsLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-screen bg-gray-100">
            <DashboardSidebar />
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}
