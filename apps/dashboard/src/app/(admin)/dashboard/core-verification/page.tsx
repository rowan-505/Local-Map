import { redirect } from "next/navigation";

import { coreVerificationOverviewRedirectTarget } from "@/src/features/core-verification/coreVerificationRedirects";

/** Deprecated dashboard module — overview lives on Core Review. */
export default function CoreVerificationOverviewRedirectPage() {
    redirect(coreVerificationOverviewRedirectTarget());
}
