import { redirect } from "next/navigation";

import { coreReviewPath } from "@/src/lib/dashboardNavigation";

/** Legacy URL → land-areas. */
export default function LegacyLanduseCoreReviewRedirectPage() {
    redirect(coreReviewPath("land-areas"));
}
