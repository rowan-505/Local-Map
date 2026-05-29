"use client";

/** URL segment `bus-stops` is legacy; data is loaded from core_transport.stops via core-review API. */

import CoreReviewEntityPage from "@/src/features/core-review/components/CoreReviewEntityPage";
import { CORE_REVIEW_BUS_STOPS_CONFIG } from "@/src/features/core-review/config/entity-configs";

export default function Page() {
    return <CoreReviewEntityPage config={CORE_REVIEW_BUS_STOPS_CONFIG} />;
}
