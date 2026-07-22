import { redirect } from "next/navigation";

import { importReviewPath } from "@/src/lib/dashboardPaths";

/** @deprecated Use /dashboard/import-review/buildings. */
export default function DataReviewBuildingsPage() {
    redirect(importReviewPath("buildings"));
}
