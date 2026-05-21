import type { ReactNode } from "react";
import { Suspense } from "react";

import { ReviewTopNavFromConfig } from "@/src/components/review";
import { CORE_REVIEW_PATH, coreReviewTabs } from "@/src/lib/dashboardNavigation";

export default function CoreReviewLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <Suspense fallback={null}>
                <ReviewTopNavFromConfig
                    ariaLabel="Core review sections"
                    basePath={CORE_REVIEW_PATH}
                    tabs={coreReviewTabs}
                />
            </Suspense>
            {children}
        </>
    );
}
