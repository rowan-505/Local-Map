import { redirect } from "next/navigation";

import { coreReviewPath } from "@/src/lib/dashboardNavigation";

export default function DashboardHomePage() {
    redirect(coreReviewPath());
}
