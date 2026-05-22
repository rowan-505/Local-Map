"use client";

import { useEffect, useState } from "react";

import {
    getRefAddressUsageTypes,
    getRefBoundaryStatuses,
    isAbortError,
    type RefAddressUsageType,
    type RefBoundaryStatus,
} from "@/src/lib/api";

import type { CoreReviewListDraft } from "../hooks/useCoreReviewListState";

const SELECT_CLASS =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm";

function refLabel(nameEn: string, nameMm: string | null | undefined, code: string): string {
    return `${nameEn} — ${nameMm?.trim() || code}`;
}

export default function AdminAreaBoundaryFilters({
    draft,
    setDraft,
}: {
    draft: CoreReviewListDraft;
    setDraft: React.Dispatch<React.SetStateAction<CoreReviewListDraft>>;
}) {
    const [boundaryStatuses, setBoundaryStatuses] = useState<RefBoundaryStatus[]>([]);
    const [addressUsageTypes, setAddressUsageTypes] = useState<RefAddressUsageType[]>([]);

    useEffect(() => {
        const controller = new AbortController();
        Promise.all([
            getRefBoundaryStatuses({ signal: controller.signal }),
            getRefAddressUsageTypes({ signal: controller.signal }),
        ])
            .then(([statuses, usages]) => {
                setBoundaryStatuses(statuses);
                setAddressUsageTypes(usages);
            })
            .catch((err) => {
                if (!isAbortError(err)) {
                    setBoundaryStatuses([]);
                    setAddressUsageTypes([]);
                }
            });
        return () => controller.abort();
    }, []);

    return (
        <>
            <label className="block space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Boundary status
                </span>
                <select
                    value={draft.boundaryStatus}
                    onChange={(e) =>
                        setDraft((prev) => ({ ...prev, boundaryStatus: e.target.value }))
                    }
                    className={SELECT_CLASS}
                >
                    <option value="">All boundary statuses</option>
                    {boundaryStatuses.map((item) => (
                        <option key={item.code} value={item.code}>
                            {refLabel(item.name_en, item.name_mm, item.code)}
                        </option>
                    ))}
                </select>
            </label>

            <label className="block space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Address usage
                </span>
                <select
                    value={draft.addressUsage}
                    onChange={(e) => setDraft((prev) => ({ ...prev, addressUsage: e.target.value }))}
                    className={SELECT_CLASS}
                >
                    <option value="">All address usage types</option>
                    {addressUsageTypes.map((item) => (
                        <option key={item.code} value={item.code}>
                            {refLabel(item.name_en, item.name_mm, item.code)}
                        </option>
                    ))}
                </select>
            </label>

            <label className="block space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Official boundary
                </span>
                <select
                    value={draft.isOfficialBoundary}
                    onChange={(e) =>
                        setDraft((prev) => ({ ...prev, isOfficialBoundary: e.target.value }))
                    }
                    className={SELECT_CLASS}
                >
                    <option value="">All</option>
                    <option value="true">Official only</option>
                    <option value="false">Non-official only</option>
                </select>
            </label>
        </>
    );
}
