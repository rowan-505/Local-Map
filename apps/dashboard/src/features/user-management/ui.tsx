import { roleLabel, statusLabel } from "./constants";
import { PRIVILEGED_ROLES } from "./constants";
import type { AccountStatus } from "./types";

export function VerifiedBadge({ verified }: { verified: boolean }) {
    return verified ? (
        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100">
            Verified
        </span>
    ) : (
        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
            Unverified
        </span>
    );
}

const STATUS_CLASS: Record<AccountStatus, string> = {
    active: "bg-emerald-50 text-emerald-800 ring-emerald-100",
    disabled: "bg-amber-50 text-amber-900 ring-amber-100",
    deleted: "bg-red-50 text-red-800 ring-red-100",
};

export function StatusBadge({ status }: { status: AccountStatus }) {
    return (
        <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                STATUS_CLASS[status] ?? "bg-gray-100 text-gray-600 ring-gray-200"
            }`}
        >
            {statusLabel(status)}
        </span>
    );
}

export function RolePills({ roles }: { roles: string[] }) {
    if (roles.length === 0) {
        return <span className="text-gray-400">—</span>;
    }
    return (
        <span className="flex flex-wrap gap-1">
            {roles.map((role) => {
                const privileged = PRIVILEGED_ROLES.has(role);
                return (
                    <span
                        key={role}
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                            privileged
                                ? "bg-indigo-50 text-indigo-800 ring-indigo-100"
                                : "bg-gray-100 text-gray-700 ring-gray-200"
                        }`}
                    >
                        {roleLabel(role)}
                    </span>
                );
            })}
        </span>
    );
}

export function PointsDelta({ value }: { value: number }) {
    if (value === 0) {
        return <span className="tabular-nums text-gray-600">0</span>;
    }
    return (
        <span
            className={`tabular-nums font-medium ${value > 0 ? "text-emerald-700" : "text-red-700"}`}
        >
            {value > 0 ? `+${value}` : value}
        </span>
    );
}

export const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

export const INPUT_CLASS =
    "min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

export const PRIMARY_BTN =
    "rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50";

export const SECONDARY_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
