import type { ReactNode } from "react";
import { Suspense } from "react";

import FamilyTopNavFromConfig from "@/src/components/dashboard/FamilyTopNavFromConfig";
import { STATS_PATH, statsTabs } from "@/src/lib/dashboardNavigation";

export default function StatsLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <Suspense fallback={null}>
                <FamilyTopNavFromConfig
                    ariaLabel="Stats sections"
                    basePath={STATS_PATH}
                    tabs={statsTabs}
                />
            </Suspense>
            {children}
        </>
    );
}
