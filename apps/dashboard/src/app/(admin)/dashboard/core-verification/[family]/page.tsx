import { redirect } from "next/navigation";

import { coreVerificationFamilyRedirectTarget } from "@/src/features/core-verification/coreVerificationRedirects";

/** Deprecated family queue — redirects to the matching Core Review module when safe. */
export default async function CoreVerificationFamilyRedirectPage({
    params,
}: {
    params: Promise<{ family: string }>;
}) {
    const { family } = await params;
    redirect(coreVerificationFamilyRedirectTarget(family));
}
