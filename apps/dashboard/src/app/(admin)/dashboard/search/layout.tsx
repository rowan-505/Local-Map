import type { ReactNode } from "react";
import { Suspense } from "react";

import FamilyTopNavFromConfig from "@/src/components/dashboard/FamilyTopNavFromConfig";
import { SEARCH_PATH, searchTabs } from "@/src/lib/dashboardNavigation";

export default function SearchLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <Suspense fallback={null}>
                <FamilyTopNavFromConfig
                    ariaLabel="Search sections"
                    basePath={SEARCH_PATH}
                    tabs={searchTabs}
                />
            </Suspense>
            {children}
        </>
    );
}
