"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type FamilyTopNavTab = {
    label: string;
    href: string;
    match?: "exact" | "prefix";
};

function isTabActive(pathname: string, href: string, match: "exact" | "prefix"): boolean {
    const path = href.split("?")[0] ?? href;
    if (match === "exact") {
        return pathname === path;
    }
    return pathname === path || pathname.startsWith(`${path}/`);
}

export default function FamilyTopNav({
    ariaLabel,
    tabs,
}: {
    ariaLabel: string;
    tabs: readonly FamilyTopNavTab[];
}) {
    const pathname = usePathname() ?? "";

    return (
        <nav
            aria-label={ariaLabel}
            className="border-b border-gray-200 bg-white px-4 py-2 sm:px-6"
        >
            <div className="flex flex-wrap gap-1">
                {tabs.map((tab) => {
                    const match = tab.match ?? "prefix";
                    const active = isTabActive(pathname, tab.href, match);
                    return (
                        <Link
                            key={`${tab.href}-${tab.label}`}
                            href={tab.href}
                            prefetch={false}
                            className={`block rounded-md px-2.5 py-1.5 text-sm ${
                                active
                                    ? "bg-gray-900 font-medium text-white"
                                    : "text-gray-700 hover:bg-gray-100"
                            }`}
                        >
                            {tab.label}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
