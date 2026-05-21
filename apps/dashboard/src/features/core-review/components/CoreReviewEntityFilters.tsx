"use client";

import { useEffect, useState } from "react";

import DataTableToolbar, { type DataTableSortOption } from "@/src/components/dashboard/DataTableToolbar";
import CoreReviewFilterCard from "@/src/components/core-review/CoreReviewFilterCard";
import {
    getAdminAreaOptions,
    getBuildingTypes,
    getCategories,
    getCoreReviewList,
    getRoadClasses,
    isAbortError,
} from "@/src/lib/api";

import type { CoreReviewBusRouteRow } from "../config/types";

import type { CoreReviewFilterSupport } from "../config/entity-config-types";
import type { CoreReviewListDraft, CoreReviewVerifiedFilter } from "../hooks/useCoreReviewListState";

const SELECT_CLASS =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm";

type Option = { id: string; label: string };

export default function CoreReviewEntityFilters({
    draft,
    setDraft,
    sortOptions,
    defaultSortBy,
    filterSupport,
    searchPlaceholder,
    totalCount,
    filteredCount,
    onApply,
    onClear,
    extraFilters,
    showRoutePicker,
}: {
    draft: CoreReviewListDraft;
    setDraft: React.Dispatch<React.SetStateAction<CoreReviewListDraft>>;
    sortOptions: DataTableSortOption[];
    defaultSortBy: string;
    filterSupport: CoreReviewFilterSupport;
    searchPlaceholder: string;
    totalCount: number;
    filteredCount: number;
    onApply: () => void;
    onClear: () => void;
    extraFilters?: React.ReactNode;
    showRoutePicker?: boolean;
}) {
    const [buildingTypes, setBuildingTypes] = useState<Option[]>([]);
    const [categories, setCategories] = useState<Option[]>([]);
    const [roadClasses, setRoadClasses] = useState<Option[]>([]);
    const [adminAreas, setAdminAreas] = useState<Option[]>([]);
    const [routes, setRoutes] = useState<Option[]>([]);

    useEffect(() => {
        const c = new AbortController();
        const tasks: Promise<void>[] = [];

        if (filterSupport.buildingTypeId) {
            tasks.push(
                getBuildingTypes({ signal: c.signal })
                    .then((rows) =>
                        setBuildingTypes(
                            rows.map((r) => ({
                                id: r.id,
                                label: r.name_mm ? `${r.name} (${r.name_mm})` : r.name,
                            }))
                        )
                    )
                    .catch((e) => {
                        if (!isAbortError(e)) {
                            setBuildingTypes([]);
                        }
                    })
            );
        }
        if (filterSupport.categoryId) {
            tasks.push(
                getCategories()
                    .then((rows) =>
                        setCategories(rows.map((r) => ({ id: r.id, label: r.name })))
                    )
                    .catch((e) => {
                        if (!isAbortError(e)) {
                            setCategories([]);
                        }
                    })
            );
        }
        if (filterSupport.roadClassId) {
            tasks.push(
                getRoadClasses({ signal: c.signal })
                    .then((rows) =>
                        setRoadClasses(rows.map((r) => ({ id: r.id, label: r.name })))
                    )
                    .catch((e) => {
                        if (!isAbortError(e)) {
                            setRoadClasses([]);
                        }
                    })
            );
        }
        if (filterSupport.adminAreaId) {
            tasks.push(
                Promise.resolve(getAdminAreaOptions({ limit: 200 }))
                    .then((rows) =>
                        setAdminAreas(
                            rows.map((r) => ({
                                id: r.id,
                                label: r.canonical_name,
                            }))
                        )
                    )
                    .catch((e) => {
                        if (!isAbortError(e)) {
                            setAdminAreas([]);
                        }
                    })
            );
        }
        if (showRoutePicker && filterSupport.routeId) {
            tasks.push(
                getCoreReviewList<CoreReviewBusRouteRow>("bus-routes", { pageSize: 100 })
                    .then((res) =>
                        setRoutes(
                            res.data.map((r) => ({
                                id: r.id,
                                label: r.publicName?.trim() || r.routeCode?.trim() || r.id,
                            }))
                        )
                    )
                    .catch(() => setRoutes([]))
            );
        }

        void Promise.all(tasks);
        return () => c.abort();
    }, [filterSupport, showRoutePicker]);

    return (
        <CoreReviewFilterCard>
            <DataTableToolbar
                searchValue={draft.searchDraft}
                onSearchChange={(v) => setDraft((d) => ({ ...d, searchDraft: v }))}
                onSearchSubmit={onApply}
                onSearchClear={() => {
                    setDraft((d) => ({ ...d, searchDraft: "" }));
                    onClear();
                }}
                placeholder={searchPlaceholder}
                sortBy={draft.sortBy}
                onSortByChange={(v) => setDraft((d) => ({ ...d, sortBy: v }))}
                sortOptions={sortOptions}
                arrange={draft.arrange}
                onArrangeChange={(v) => setDraft((d) => ({ ...d, arrange: v }))}
                totalCount={totalCount}
                filteredCount={filteredCount}
                onClearFilters={onClear}
            />

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filterSupport.isVerified ? (
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-slate-600">Verification</span>
                        <select
                            className={SELECT_CLASS}
                            value={draft.verifiedFilter}
                            onChange={(e) =>
                                setDraft((d) => ({
                                    ...d,
                                    verifiedFilter: e.target.value as CoreReviewVerifiedFilter,
                                }))
                            }
                        >
                            <option value="all">All</option>
                            <option value="verified">Verified</option>
                            <option value="unverified">Unverified</option>
                        </select>
                    </label>
                ) : null}

                {filterSupport.buildingTypeId ? (
                    <FilterSelect
                        label="Building type"
                        value={draft.buildingTypeId}
                        options={buildingTypes}
                        onChange={(v) => setDraft((d) => ({ ...d, buildingTypeId: v }))}
                    />
                ) : null}

                {filterSupport.categoryId ? (
                    <FilterSelect
                        label="Category"
                        value={draft.categoryId}
                        options={categories}
                        onChange={(v) => setDraft((d) => ({ ...d, categoryId: v }))}
                    />
                ) : null}

                {filterSupport.roadClassId ? (
                    <FilterSelect
                        label="Road class"
                        value={draft.roadClassId}
                        options={roadClasses}
                        onChange={(v) => setDraft((d) => ({ ...d, roadClassId: v }))}
                    />
                ) : null}

                {filterSupport.adminAreaId ? (
                    <FilterSelect
                        label="Admin area"
                        value={draft.adminAreaId}
                        options={adminAreas}
                        onChange={(v) => setDraft((d) => ({ ...d, adminAreaId: v }))}
                    />
                ) : null}

                {filterSupport.isPublic ? (
                    <FilterSelect
                        label="Public"
                        value={draft.isPublic}
                        options={[
                            { id: "", label: "All" },
                            { id: "true", label: "Public" },
                            { id: "false", label: "Private" },
                        ]}
                        onChange={(v) => setDraft((d) => ({ ...d, isPublic: v }))}
                    />
                ) : null}

                {showRoutePicker && filterSupport.routeId ? (
                    <FilterSelect
                        label="Route"
                        value={draft.routeId}
                        options={[{ id: "", label: "All routes" }, ...routes]}
                        onChange={(v) => setDraft((d) => ({ ...d, routeId: v }))}
                    />
                ) : null}

                <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-slate-600">Page size</span>
                    <select
                        className={SELECT_CLASS}
                        value={draft.pageSize}
                        onChange={(e) =>
                            setDraft((d) => ({ ...d, pageSize: Number(e.target.value) }))
                        }
                    >
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                </label>

                {extraFilters}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={onApply}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                    Apply filters
                </button>
            </div>
        </CoreReviewFilterCard>
    );
}

function FilterSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: Option[];
    onChange: (value: string) => void;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">{label}</span>
            <select
                className={SELECT_CLASS}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                <option value="">All</option>
                {options.map((o) => (
                    <option key={o.id} value={o.id}>
                        {o.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
