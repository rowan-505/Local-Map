import type { ReactNode } from "react";
import { Suspense } from "react";

import ImportReviewRouteAuthGate from "./_components/ImportReviewRouteAuthGate";
import ImportReviewSubNav from "./_components/ImportReviewSubNav";

export default function ImportReviewLayout({ children }: { children: ReactNode }) {
    return (
        <ImportReviewRouteAuthGate>
            <Suspense fallback={null}>
                <ImportReviewSubNav />
            </Suspense>
            {children}
        </ImportReviewRouteAuthGate>
    );
}
