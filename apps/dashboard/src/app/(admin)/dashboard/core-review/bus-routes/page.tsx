"use client";

/** URL segment `bus-routes` is legacy; data is loaded from core_transport.routes via core-review API. */

import CoreReviewEntityPage from "@/src/features/core-review/components/CoreReviewEntityPage";
import { CORE_REVIEW_BUS_ROUTES_CONFIG } from "@/src/features/core-review/config/entity-configs";

export default function Page() {
    return <CoreReviewEntityPage config={CORE_REVIEW_BUS_ROUTES_CONFIG} />;
}
