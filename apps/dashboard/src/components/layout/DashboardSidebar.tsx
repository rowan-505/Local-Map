"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
    dashboardSidebarItems,
    sidebarModuleFromPathname,
    userManagementSidebarItems,
    type DashboardSidebarItem,
    type DashboardSidebarModuleKey,
} from "@/src/lib/dashboardNavigation";

function NavItem({
    item,
    activeModule,
}: {
    item: DashboardSidebarItem;
    activeModule: DashboardSidebarModuleKey | null;
}) {
    const active = activeModule === item.moduleKey;
    const Icon = item.Icon;

    return (
        <Link
            prefetch={false}
            href={item.href}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                active
                    ? "bg-gray-900 font-medium text-white"
                    : "text-gray-700 hover:bg-gray-100"
            }`}
        >
            <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
            {item.label}
        </Link>
    );
}

export default function DashboardSidebar() {
    const pathname = usePathname() ?? "";
    const activeModule = sidebarModuleFromPathname(pathname);

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
                {dashboardSidebarItems.map((item) => (
                    <NavItem key={item.moduleKey} item={item} activeModule={activeModule} />
                ))}

                <p className="mt-4 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    User Management
                </p>
                {userManagementSidebarItems.map((item) => (
                    <NavItem key={item.moduleKey} item={item} activeModule={activeModule} />
                ))}
            </nav>
        </aside>
    );
}
