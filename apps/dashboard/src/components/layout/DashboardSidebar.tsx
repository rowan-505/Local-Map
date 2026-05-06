"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
    { href: "/dashboard", label: "Dashboard", match: "exact" as const },
    { href: "/places", label: "Places", match: "prefix" as const },
    { href: "/streets", label: "Streets", match: "prefix" as const },
    { href: "/buildings", label: "Buildings", match: "prefix" as const },
    { href: "/categories", label: "Categories", match: "prefix" as const },
    { href: "/admin-areas", label: "Admin Areas", match: "prefix" as const },
];

function isActive(pathname: string, href: string, match: "exact" | "prefix") {
    if (match === "exact") {
        return pathname === href;
    }

    return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DashboardSidebar() {
    const pathname = usePathname() ?? "";

    return (
        <aside className="flex w-52 shrink-0 flex-col border-r border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-4">
                <Link
                    href="/dashboard"
                    prefetch={false}
                    className="text-sm font-semibold text-gray-900"
                >
                    Local Map
                </Link>
                <p className="mt-1 text-xs text-gray-500">Admin</p>
            </div>
            <nav className="flex flex-col gap-0.5 p-2">
                {NAV.map((item) => {
                    const active = isActive(pathname, item.href, item.match);

                    return (
                        <Link
                            prefetch={false}
                            key={item.href}
                            href={item.href}
                            className={`rounded-md px-3 py-2 text-sm ${
                                active
                                    ? "bg-gray-900 font-medium text-white"
                                    : "text-gray-700 hover:bg-gray-100"
                            }`}
                        >
                            {item.label}
                        </Link>
                    );
                })}
            </nav>
        </aside>
    );
}
