"use client";

import CoreReviewEntityPage from "@/src/features/core-review/components/CoreReviewEntityPage";
import { CORE_REVIEW_WATER_LINES_CONFIG } from "@/src/features/core-review/config/entity-configs";

export default function Page() {
    return <CoreReviewEntityPage config={CORE_REVIEW_WATER_LINES_CONFIG} />;
}
