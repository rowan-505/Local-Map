"use client";

import { useCallback, useMemo, useState } from "react";

import DataTableToolbar, { type DataTableSortOption } from "@/src/components/dashboard/DataTableToolbar";
import CoreReviewFilterCard from "@/src/components/core-review/CoreReviewFilterCard";

import {
    useCoreReviewRefAdminAreas,
    useCoreReviewRefBuildingTypes,
    useCoreReviewRefCategories,
    useCoreReviewRefLandAreaClasses,
    useCoreReviewRefRoadClasses,
} from "../hooks/coreReviewRefQueries";

import type { CoreReviewFilterSupport } from "../config/entity-config-types";
import type { CoreReviewLifecycleStatusFilter } from "../lifecycle/coreReviewLifecycleUtils";
import type { CoreReviewListDraft } from "../hooks/useCoreReviewListState";
import {
    CORE_REVIEW_VERIFICATION_STATUS_FILTER_OPTIONS,
    type CoreReviewVerificationStatusFilter,
} from "../verification/coreReviewVerificationFilter";

const SELECT_CLASS =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm";

type Option = { id: string; label: string };

export default function CoreReviewEntityFilters({
    draft,
    setDraft,
    sortOptions,
    filterSupport,
    searchPlaceholder,
    totalCount,
    filteredCount,
    onApply,
    onClear,
    onApplyVerificationFilter,
    extraFilters,
    adminAreaTownshipOnly = false,
}: {
    draft: CoreReviewListDraft;
    setDraft: React.Dispatch<React.SetStateAction<CoreReviewListDraft>>;
    sortOptions: DataTableSortOption[];
    filterSupport: CoreReviewFilterSupport;
    searchPlaceholder: string;
    totalCount: number;
    filteredCount: number;
    onApply: () => void;
    onClear: () => void;
    onApplyVerificationFilter?: (filter: CoreReviewVerificationStatusFilter) => void;
    extraFilters?: React.ReactNode;
    adminAreaTownshipOnly?: boolean;
}) {
    // Lazily enable each reference query on first interaction with its control.
    const [refsEnabled, setRefsEnabled] = useState({
        buildingTypes: false,
        categories: false,
        roadClasses: Boolean(filterSupport.roadClassId),
        adminAreas: adminAreaTownshipOnly && Boolean(filterSupport.adminAreaId),
        landAreaClasses: false,
    });

    const enableRef = useCallback((key: keyof typeof refsEnabled) => {
        setRefsEnabled((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    }, []);

    /**
     * Lazy-load option lists on first interaction instead of page mount.
     * This reduces "unrelated" requests when opening a core-review tab.
     */
    const buildingTypesQuery = useCoreReviewRefBuildingTypes(
        Boolean(filterSupport.buildingTypeId) && refsEnabled.buildingTypes
    );
    const categoriesQuery = useCoreReviewRefCategories(
        Boolean(filterSupport.categoryId) && refsEnabled.categories
    );
    const roadClassesQuery = useCoreReviewRefRoadClasses(
        Boolean(filterSupport.roadClassId) && refsEnabled.roadClasses
    );
    const adminAreasQuery = useCoreReviewRefAdminAreas(
        200,
        Boolean(filterSupport.adminAreaId) && refsEnabled.adminAreas,
        adminAreaTownshipOnly,
    );
    const landAreaClassesQuery = useCoreReviewRefLandAreaClasses(
        Boolean(filterSupport.landAreaClassId) && refsEnabled.landAreaClasses
    );

    const buildingTypes: Option[] = useMemo(
        () =>
            (buildingTypesQuery.data ?? []).map((r) => ({
                id: r.id,
                label: r.name_mm ? `${r.code} — ${r.name} (${r.name_mm})` : `${r.code} — ${r.name}`,
            })),
        [buildingTypesQuery.data]
    );

    const categories: Option[] = useMemo(
        () => (categoriesQuery.data ?? []).map((r) => ({ id: r.id, label: r.name })),
        [categoriesQuery.data]
    );

    const roadClasses: Option[] = useMemo(
        () => (roadClassesQuery.data ?? []).map((r) => ({ id: r.id, label: r.name })),
        [roadClassesQuery.data]
    );

    const adminAreas: Option[] = useMemo(
        () =>
            (adminAreasQuery.data ?? []).map((r) => ({
                id: r.id,
                label: r.canonical_name,
            })),
        [adminAreasQuery.data]
    );

    const landAreaClasses: Option[] = useMemo(
        () =>
            (landAreaClassesQuery.data ?? [])
                .filter((r) => r.is_active)
                .map((r) => ({
                    id: r.id,
                    label: r.name_mm ? `${r.name_en} — ${r.name_mm}` : r.name_en,
                })),
        [landAreaClassesQuery.data]
    );

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
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-slate-600">Status</span>
                    <select
                        className={SELECT_CLASS}
                        value={draft.statusFilter}
                        onChange={(e) =>
                            setDraft((d) => ({
                                ...d,
                                statusFilter: e.target.value as CoreReviewLifecycleStatusFilter,
                            }))
                        }
                    >
                        <option value="active">Active</option>
                        <option value="deleted">Deleted</option>
                        <option value="all">All</option>
                    </select>
                </label>

                {filterSupport.isVerified ? (
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-slate-600">Verification status</span>
                        <select
                            className={SELECT_CLASS}
                            value={draft.verificationStatusFilter}
                            onChange={(e) => {
                                const verificationStatusFilter = e.target
                                    .value as CoreReviewVerificationStatusFilter;
                                setDraft((d) => ({ ...d, verificationStatusFilter }));
                                onApplyVerificationFilter?.(verificationStatusFilter);
                            }}
                        >
                            {CORE_REVIEW_VERIFICATION_STATUS_FILTER_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}

                {filterSupport.buildingTypeId ? (
                    <FilterSelect
                        label="Building type"
                        value={draft.buildingTypeId}
                        options={buildingTypes}
                        onOpen={() => enableRef("buildingTypes")}
                        onChange={(v) => setDraft((d) => ({ ...d, buildingTypeId: v }))}
                    />
                ) : null}

                {filterSupport.categoryId ? (
                    <FilterSelect
                        label="Category"
                        value={draft.categoryId}
                        options={categories}
                        onOpen={() => enableRef("categories")}
                        onChange={(v) => setDraft((d) => ({ ...d, categoryId: v }))}
                    />
                ) : null}

                {filterSupport.roadClassId ? (
                    <FilterSelect
                        label="Road class"
                        value={draft.roadClassId}
                        options={roadClasses}
                        onOpen={() => enableRef("roadClasses")}
                        onChange={(v) => setDraft((d) => ({ ...d, roadClassId: v }))}
                    />
                ) : null}

                {filterSupport.adminAreaId ? (
                    <FilterSelect
                        label="Admin area"
                        value={draft.adminAreaId}
                        options={adminAreas}
                        onOpen={() => enableRef("adminAreas")}
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

                {filterSupport.landAreaClassId ? (
                    <FilterSelect
                        label="Landuse class"
                        value={draft.landAreaClassId}
                        options={landAreaClasses}
                        onOpen={() => enableRef("landAreaClasses")}
                        onChange={(v) => setDraft((d) => ({ ...d, landAreaClassId: v }))}
                    />
                ) : null}

                {filterSupport.detailLevel ? (
                    <FilterSelect
                        label="Detail level"
                        value={draft.detailLevel}
                        options={[
                            { id: "zone", label: "Zone" },
                            { id: "parcel", label: "Parcel" },
                        ]}
                        onChange={(v) => setDraft((d) => ({ ...d, detailLevel: v }))}
                    />
                ) : null}

                {filterSupport.cropCode ? (
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-slate-600">Crop code</span>
                        <input
                            type="text"
                            className={SELECT_CLASS}
                            value={draft.cropCode}
                            placeholder="e.g. rice"
                            onChange={(e) => setDraft((d) => ({ ...d, cropCode: e.target.value }))}
                        />
                    </label>
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
    onOpen,
}: {
    label: string;
    value: string;
    options: Option[];
    onChange: (value: string) => void;
    onOpen?: () => void;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">{label}</span>
            <select
                className={SELECT_CLASS}
                value={value}
                onFocus={onOpen}
                onMouseDown={onOpen}
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
