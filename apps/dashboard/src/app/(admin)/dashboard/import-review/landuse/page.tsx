import { redirect } from "next/navigation";

/** Legacy URL → land-areas. */
export default function LegacyLanduseImportReviewRedirectPage() {
    redirect("/dashboard/import-review/land-areas");
}
