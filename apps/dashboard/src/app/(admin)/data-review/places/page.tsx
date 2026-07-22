import { redirect } from "next/navigation";

import { importReviewPath } from "@/src/lib/dashboardPaths";

/** @deprecated Use /dashboard/import-review/places. */
export default function DataReviewPlacesPage() {
    redirect(importReviewPath("places"));
}
