import type { ReactNode } from "react";
import { Suspense } from "react";

import FamilyTopNavFromConfig from "@/src/components/dashboard/FamilyTopNavFromConfig";
import { TRANSPORT_PATH, transportTabs } from "@/src/lib/dashboardNavigation";

export default function TransportLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <Suspense fallback={null}>
                <FamilyTopNavFromConfig
                    ariaLabel="Transport sections"
                    basePath={TRANSPORT_PATH}
                    tabs={transportTabs}
                />
            </Suspense>
            {children}
        </>
    );
}
