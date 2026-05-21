"use client";

import FamilyTopNav from "@/src/components/dashboard/FamilyTopNav";
import {
    type FamilyNavTab,
    familyTabsToHref,
} from "@/src/lib/dashboardNavigation";

export default function FamilyTopNavFromConfig({
    ariaLabel,
    basePath,
    tabs,
}: {
    ariaLabel: string;
    basePath: string;
    tabs: readonly FamilyNavTab[];
}) {
    return <FamilyTopNav ariaLabel={ariaLabel} tabs={familyTabsToHref(basePath, tabs)} />;
}
