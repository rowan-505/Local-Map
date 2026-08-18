import { redirect } from "next/navigation";

import { coreReviewPath } from "@/src/lib/dashboardNavigation";

type Props = {
    params: Promise<{ id: string }>;
};

/** Legacy URL → land-areas/[id]/edit. */
export default async function LegacyLanduseCoreReviewEditRedirectPage({ params }: Props) {
    const { id } = await params;
    redirect(coreReviewPath(`land-areas/${id}/edit`));
}
