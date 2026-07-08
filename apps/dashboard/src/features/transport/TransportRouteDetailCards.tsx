"use client";

import type { ReactNode } from "react";

import { transportModeLabel, transportReviewStatusLabel } from "./constants";
import { PublicPreviewBadge } from "./transportReviewUi";
import type { RouteReviewReadiness, TransportRouteDetail, TransportVariantSummary } from "./types";

export type RouteReviewChecklistItem = {
    readonly key: string;
    readonly label: string;
    readonly status: "ok" | "attention";
    readonly hint?: string;
};

export const TRANSPORT_DETAIL_CARD_CLASS =
    "rounded-lg border border-gray-200 bg-white p-3 shadow-sm";

const CARD_CLASS = TRANSPORT_DETAIL_CARD_CLASS;

/** Responsive field grid: 1 col mobile, 2 tablet, 3 desktop. */
export const COMPACT_FIELD_GRID_CLASS =
    "grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3";

/** Two-column field grid for smaller sections (e.g. stop names). */
export const COMPACT_FIELD_GRID_2_CLASS =
    "grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2";

export function CompactField({
    label,
    value,
}: {
    readonly label: string;
    readonly value: ReactNode;
}) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                {label}
            </dt>
            <dd className="mt-0.5 text-sm font-medium leading-snug text-gray-900 wrap-break-word">
                {value}
            </dd>
        </div>
    );
}

export function CollapsibleSection({
    title,
    open,
    onToggle,
    children,
    description,
}: {
    readonly title: string;
    readonly open: boolean;
    readonly onToggle: () => void;
    readonly children: ReactNode;
    readonly description?: string;
}) {
    return (
        <section className={CARD_CLASS}>
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-start justify-between gap-3 text-left"
                aria-expanded={open}
            >
                <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                        {title}
                    </h2>
                    {description ? (
                        <p className="mt-1 text-xs text-gray-500">{description}</p>
                    ) : null}
                </div>
                <span className="shrink-0 text-xs font-medium text-gray-500">
                    {open ? "Hide" : "Show"}
                </span>
            </button>
            {open ? <div className="mt-3 border-t border-gray-100 pt-3">{children}</div> : null}
        </section>
    );
}

function routePublicVisibility(route: TransportRouteDetail): string {
    if (route.deleted_at || !route.is_active) {
        return "Hidden (inactive)";
    }
    if (route.review_status === "imported_unreviewed") {
        return "Hidden (imported, unreviewed)";
    }
    if (route.review_status === "needs_review") {
        return "Hidden (needs review)";
    }
    if (route.review_status === "rejected") {
        return "Hidden (rejected)";
    }
    if (route.review_status === "reviewed" || route.review_status === "verified") {
        return "Visible";
    }
    return "Hidden";
}

export function routePublicIsHidden(route: TransportRouteDetail): boolean {
    return routePublicVisibility(route).startsWith("Hidden");
}

export function buildRouteReviewChecklist(args: {
    readonly route: TransportRouteDetail;
    readonly variants: readonly TransportVariantSummary[];
    readonly readiness: RouteReviewReadiness | null;
    readonly stopsWithoutLocation: number;
    readonly usesPlaceholderReviewPoints: boolean;
}): RouteReviewChecklistItem[] {
    const { route, variants, readiness, stopsWithoutLocation, usesPlaceholderReviewPoints } = args;

    const namesComplete = Boolean(route.name_mm?.trim() && route.name_en?.trim());
    const sequenceComplete =
        variants.length > 0 && variants.every((v) => v.stop_count >= 2);
    const sourcesComplete = route.sources.length > 0;
    const pathNeedsReview = variants.some((v) => v.path_status === "none");
    const locationNeedsReview =
        stopsWithoutLocation > 0 ||
        usesPlaceholderReviewPoints ||
        (readiness?.warnings ?? []).some((w) => /location|geometry|stop/i.test(w)) ||
        (readiness?.blockers ?? []).some((b) => /location|geometry|stop/i.test(b));
    const publicHidden = routePublicIsHidden(route);

    return [
        {
            key: "names",
            label: "Route names complete",
            status: namesComplete ? "ok" : "attention",
            hint: namesComplete ? undefined : "Add Myanmar and English names.",
        },
        {
            key: "sequence",
            label: "Stop sequence complete",
            status: sequenceComplete ? "ok" : "attention",
            hint: sequenceComplete ? undefined : "Each variant needs at least two ordered stops.",
        },
        {
            key: "sources",
            label: "Source links complete",
            status: sourcesComplete ? "ok" : "attention",
            hint: sourcesComplete ? undefined : "No source links on this route.",
        },
        {
            key: "locations",
            label: "Stop locations need review",
            status: locationNeedsReview ? "attention" : "ok",
            hint: locationNeedsReview
                ? "Open Review Map to confirm stop locations."
                : "No location issues detected for the selected variant.",
        },
        {
            key: "path",
            label: "Route path needs review",
            status: pathNeedsReview ? "attention" : "ok",
            hint: pathNeedsReview ? "One or more variants have no path." : "All variants have a path.",
        },
        {
            key: "public",
            label: "Public hidden",
            status: publicHidden ? "attention" : "ok",
            hint: publicHidden ? routePublicVisibility(route) : "Eligible for public map when active.",
        },
    ];
}

export function RouteDetailHeader({
    route,
    routeDisplayName,
    routeLoading,
    reviewMapOpen,
    editingRoute,
    onReviewMap,
    onEditInfo,
    onClose,
}: {
    readonly route: TransportRouteDetail | null;
    readonly routeDisplayName: string;
    readonly routeLoading: boolean;
    readonly reviewMapOpen: boolean;
    readonly editingRoute: boolean;
    readonly onReviewMap: () => void;
    readonly onEditInfo: () => void;
    readonly onClose?: () => void;
}) {
    return (
        <header className="flex flex-col gap-2 border-b border-gray-200 pb-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                {routeLoading ? (
                    <div className="h-7 w-64 animate-pulse rounded bg-gray-200" />
                ) : route ? (
                    <>
                        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
                            <span className="mr-2 rounded bg-gray-900 px-2 py-0.5 text-base text-white">
                                {route.route_code}
                            </span>
                            {routeDisplayName}
                        </h1>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                            <span>
                                {transportModeLabel(route.mode)} · {route.route_kind}
                            </span>
                            <span>·</span>
                            <span>{transportReviewStatusLabel(route.review_status)}</span>
                            <PublicPreviewBadge
                                reviewStatus={route.review_status}
                                isActive={route.is_active}
                                deletedAt={route.deleted_at}
                            />
                            {route.is_active ? (
                                <span className="text-emerald-700">Active</span>
                            ) : (
                                <span className="text-gray-400">Inactive</span>
                            )}
                        </div>
                    </>
                ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={onReviewMap}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                        reviewMapOpen
                            ? "border-blue-300 bg-blue-50 text-blue-800"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                >
                    {reviewMapOpen ? "Review Map open" : "Review Map"}
                </button>
                <button
                    type="button"
                    onClick={onEditInfo}
                    disabled={!route || routeLoading}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                        editingRoute
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                >
                    {editingRoute ? "Editing…" : "Edit Info"}
                </button>
                {onClose ? (
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Close
                    </button>
                ) : null}
            </div>
        </header>
    );
}

export function RouteSummaryCard({
    route,
    routeLoading,
}: {
    readonly route: TransportRouteDetail | null;
    readonly routeLoading: boolean;
}) {
    return (
        <section className={CARD_CLASS}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Route summary
            </h2>
            {routeLoading ? (
                <div className={`${COMPACT_FIELD_GRID_CLASS}`}>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
                    ))}
                </div>
            ) : route ? (
                <dl className={COMPACT_FIELD_GRID_CLASS}>
                    <CompactField label="Route code" value={route.route_code} />
                    <CompactField label="Myanmar name" value={route.name_mm ?? "—"} />
                    <CompactField label="English name" value={route.name_en ?? "—"} />
                    <CompactField label="Origin" value={route.origin_name ?? "—"} />
                    <CompactField label="Destination" value={route.destination_name ?? "—"} />
                    <CompactField label="Operator" value={route.operator?.name ?? "—"} />
                    <CompactField label="Variants" value={route.counts.variants} />
                    <CompactField label="Stops" value={route.counts.stops} />
                    <CompactField label="Paths" value={route.counts.paths} />
                    <CompactField
                        label="Public visibility"
                        value={routePublicVisibility(route)}
                    />
                </dl>
            ) : null}
        </section>
    );
}

function variantPathStatusLabel(variant: TransportVariantSummary): string {
    return variant.path_status === "has_path" ? "Has path" : "No path";
}

export function RouteVariantsCard({
    variants,
    routeLoading,
    addingVariant,
    addVariantSlot,
    onOpenReviewMap,
    onStartAddVariant,
}: {
    readonly variants: readonly TransportVariantSummary[];
    readonly routeLoading: boolean;
    readonly addingVariant: boolean;
    readonly addVariantSlot?: ReactNode;
    readonly onOpenReviewMap: (variantPublicId: string) => void;
    readonly onStartAddVariant: () => void;
}) {
    return (
        <section className={`${CARD_CLASS} p-0`}>
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Variants {variants.length > 0 ? `(${variants.length})` : ""}
                </h2>
                {!addingVariant ? (
                    <button
                        type="button"
                        onClick={onStartAddVariant}
                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                        + Add variant
                    </button>
                ) : null}
            </div>
            {addingVariant && addVariantSlot ? (
                <div className="border-b border-gray-100 bg-gray-50/60 p-3">{addVariantSlot}</div>
            ) : null}
            {routeLoading ? (
                <div className="space-y-2 p-3">
                    {[0, 1].map((i) => (
                        <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
                    ))}
                </div>
            ) : variants.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-gray-500">
                    No variants for this route.
                </p>
            ) : (
                <ul className="divide-y divide-gray-100">
                    {variants.map((v) => (
                        <li
                            key={v.public_id}
                            className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-3"
                        >
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900">
                                    {v.variant_code}
                                    {v.direction_name ? ` · ${v.direction_name}` : ""}
                                </p>
                                <p className="truncate text-xs text-gray-500">
                                    {v.headsign || v.destination_name || "—"}
                                </p>
                            </div>
                            <p className="text-xs text-gray-600 sm:text-center">
                                {v.stop_count} stops · {variantPathStatusLabel(v)}
                            </p>
                            <button
                                type="button"
                                onClick={() => onOpenReviewMap(v.public_id)}
                                className="justify-self-start rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 sm:justify-self-end"
                            >
                                Open in Review Map
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function ChecklistRow({ item }: { readonly item: RouteReviewChecklistItem }) {
    const ok = item.status === "ok";
    return (
        <li className="flex items-start gap-1.5 text-sm">
            <span
                className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
                }`}
                aria-hidden
            >
                {ok ? "✓" : "!"}
            </span>
            <div className="min-w-0">
                <p className={ok ? "text-gray-700" : "font-medium text-gray-900"}>{item.label}</p>
                {item.hint ? <p className="text-xs text-gray-500">{item.hint}</p> : null}
            </div>
        </li>
    );
}

export function RouteReviewChecklistCard({
    items,
    loading,
}: {
    readonly items: readonly RouteReviewChecklistItem[];
    readonly loading: boolean;
}) {
    return (
        <section className={CARD_CLASS}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Review checklist
            </h2>
            {loading ? (
                <p className="text-sm text-gray-500">Loading checklist…</p>
            ) : (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-x-4">
                    {items.map((item) => (
                        <ChecklistRow key={item.key} item={item} />
                    ))}
                </ul>
            )}
        </section>
    );
}
