import { redirect } from "next/navigation";

import { accountPath } from "@/src/lib/dashboardNavigation";

export default function DashboardHomePage() {
    redirect(accountPath());
}
