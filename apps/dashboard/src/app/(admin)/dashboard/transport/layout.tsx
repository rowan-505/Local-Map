import type { ReactNode } from "react";
import { Suspense } from "react";

import FamilyTopNavFromConfig from "@/src/components/dashboard/FamilyTopNavFromConfig";
import { TransportBasemapModeProvider } from "@/src/features/transport/TransportBasemapModeProvider";
import { TRANSPORT_PATH, transportTabs } from "@/src/lib/dashboardNavigation";

export default function TransportLayout({ children }: { children: ReactNode }) {
    return (
        <TransportBasemapModeProvider>
            <Suspense fallback={null}>
                <FamilyTopNavFromConfig
                    ariaLabel="Transport sections"
                    basePath={TRANSPORT_PATH}
                    tabs={transportTabs}
                />
            </Suspense>
            {children}
        </TransportBasemapModeProvider>
    );
}
