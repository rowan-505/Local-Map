"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import FamilyTopNav from "@/src/components/dashboard/FamilyTopNav";
import { IMPORT_TRANSPORT_PATH } from "@/src/lib/dashboardPaths";

import {
    importTransportGtfsHref,
    importTransportHistoryHref,
} from "@/src/features/import-transport/navigation/importTransportRoutes";

import {
    IMPORT_TRANSPORT_NAV_ENTITIES,
    importTransportEntityHref,
    importTransportOverviewHref,
    importTransportPromotionHref,
} from "@/src/features/import-transport/navigation/importTransportNavHrefs";
import { importBatchIdFromTransportSearch } from "@/src/features/import-transport/utils/importTransportScope";

export default function ImportTransportSubNav() {
    const searchParams = useSearchParams();
    const searchKey = searchParams.toString();
    const pathname = usePathname() ?? "";
    const importBatchId = useMemo(
        () => importBatchIdFromTransportSearch(searchParams),
        [searchKey]
    );

    const tabs = useMemo(
        () => [
            {
                label: "Overview",
                href: importTransportOverviewHref(searchParams),
                match: "exact" as const,
            },
            ...IMPORT_TRANSPORT_NAV_ENTITIES.map((entity) => ({
                label: entity.pluralLabel,
                href: importTransportEntityHref(entity.slug, searchParams, importBatchId || null),
                match: "prefix" as const,
            })),
            {
                label: "Promotion",
                href: importTransportPromotionHref(searchParams),
                match: "prefix" as const,
            },
            {
                label: "History",
                href: importTransportHistoryHref(),
                match: "prefix" as const,
            },
            {
                label: "GTFS / OTP",
                href: importTransportGtfsHref(),
                match: "prefix" as const,
            },
        ],
        [searchKey, importBatchId]
    );

    if (!pathname.startsWith(IMPORT_TRANSPORT_PATH)) {
        return null;
    }

    return <FamilyTopNav ariaLabel="Import transport sections" tabs={tabs} />;
}
