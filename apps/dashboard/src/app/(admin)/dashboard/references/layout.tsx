import type { ReactNode } from "react";
import { Suspense } from "react";

import FamilyTopNavFromConfig from "@/src/components/dashboard/FamilyTopNavFromConfig";
import { REFERENCES_PATH, referencesTabs } from "@/src/lib/dashboardNavigation";

export default function ReferencesLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <Suspense fallback={null}>
                <FamilyTopNavFromConfig
                    ariaLabel="References sections"
                    basePath={REFERENCES_PATH}
                    tabs={referencesTabs}
                />
            </Suspense>
            {children}
        </>
    );
}
