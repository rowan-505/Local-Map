import type { ReactNode } from "react";

import ImportReviewRouteAuthGate from "./_components/ImportReviewRouteAuthGate";

export default function ImportReviewLayout({ children }: { children: ReactNode }) {
    return <ImportReviewRouteAuthGate>{children}</ImportReviewRouteAuthGate>;
}
