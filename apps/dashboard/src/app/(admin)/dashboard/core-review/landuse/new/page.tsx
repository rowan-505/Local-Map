import { redirect } from "next/navigation";

import { coreReviewPath } from "@/src/lib/dashboardNavigation";

/** Legacy URL → land-areas/new. */
export default function LegacyLanduseCoreReviewNewRedirectPage() {
    redirect(coreReviewPath("land-areas/new"));
}
