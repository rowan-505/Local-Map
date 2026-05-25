import type { ReactNode } from "react";
import { Suspense } from "react";

import { ReviewTopNavFromConfig } from "@/src/components/review";
import {
    CORE_VERIFICATION_PATH,
    coreVerificationTabs,
} from "@/src/lib/dashboardNavigation";

export default function CoreVerificationLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <Suspense fallback={null}>
                <ReviewTopNavFromConfig
                    ariaLabel="Core verification sections"
                    basePath={CORE_VERIFICATION_PATH}
                    tabs={coreVerificationTabs}
                />
            </Suspense>
            {children}
        </>
    );
}
