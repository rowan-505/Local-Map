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
import { useDashboardRoleAccess } from "@/src/hooks/useDashboardRoleAccess";

const VIEWER_MODULES = new Set(["core-review", "import-review", "references", "stats"]);

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
    const access = useDashboardRoleAccess();
    const moduleItems = !access.ready
        ? []
        : access.isViewer
          ? dashboardSidebarItems.filter((item) => VIEWER_MODULES.has(item.moduleKey))
          : dashboardSidebarItems;

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
                {access.isViewer ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs leading-4 text-amber-900">
                        Read-only demo — changes are disabled.
                    </p>
                ) : null}
            </div>
            <nav className="flex flex-col gap-0.5 p-2">
                {moduleItems.map((item) => (
                    <NavItem key={item.moduleKey} item={item} activeModule={activeModule} />
                ))}

                {access.ready && !access.isViewer ? (
                    <>
                        <p className="mt-4 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                            User Management
                        </p>
                        {userManagementSidebarItems.map((item) => (
                            <NavItem key={item.moduleKey} item={item} activeModule={activeModule} />
                        ))}
                    </>
                ) : null}
            </nav>
        </aside>
    );
}
