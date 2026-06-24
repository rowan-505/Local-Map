import { redirect } from "next/navigation";

import { transportPath } from "@/src/lib/dashboardNavigation";

/**
 * The standalone Terminals page was removed from Transport navigation: every
 * terminal is linked 1:1 to a stop (matching name/mode), so editing now lives
 * inside Stop detail. Visiting the old list URL redirects to the stops list
 * filtered to stops that back a terminal.
 */
export default function TransportTerminalsRoutePage() {
    redirect(`${transportPath("stops")}?hasTerminal=true`);
}
