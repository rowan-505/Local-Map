import { redirect } from "next/navigation";

import { TRANSPORT_PATH } from "@/src/lib/dashboardNavigation";

/**
 * The Data Quality page was merged into the Transport Overview. Any direct visit
 * (or stale bookmark) is redirected to the Overview, which now hosts the queues.
 */
export default function TransportDataQualityRoutePage() {
    redirect(TRANSPORT_PATH);
}
