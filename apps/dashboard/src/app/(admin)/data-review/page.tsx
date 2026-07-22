import { redirect } from "next/navigation";

import { importReviewPath } from "@/src/lib/dashboardPaths";

/** @deprecated Legacy data-review hub — use Import Review. */
export default function DataReviewIndexPage() {
    redirect(importReviewPath());
}
