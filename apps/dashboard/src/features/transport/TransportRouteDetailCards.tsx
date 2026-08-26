"use client";

import type { ReactNode } from "react";

import {
    formatMetadataDuration,
    formatMetadataOperationDays,
    routeMetadataDisplayValue,
    routeModeKindLabel,
    routePublicVisibilityLabel,
} from "./transportRouteMetadataFields";
import { REVIEW_READINESS_UNAVAILABLE_MESSAGE } from "./transportFetchErrors";
import {
    PublicPreviewBadge,
    ReviewStatusBadge,
    SourceStatusBadge,
    TrainYangonServiceBadge,
} from "./transportReviewUi";
import type { TransportRouteDetail, TransportVariantSummary } from "./types";
import type { RouteDirectionSwapPair } from "./routeDirectionSwap";
import {
    canonicalYbsVariantCode,
    isCanonicalYbsRoute,
    variantDirectionLabel,
    variantHumanRoute,
} from "./variantDirection";

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
    "grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3";

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
        <section
            className={`${CARD_CLASS} transition-colors ${open ? "ring-1 ring-slate-200/80" : ""}`}
        >
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-start justify-between gap-3 text-left"
                aria-expanded={open}
            >
                <div className="flex min-w-0 items-start gap-2.5">
                    <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold transition-colors ${
                            open
                                ? "bg-slate-800 text-white"
                                : "bg-slate-100 text-slate-500"
                        }`}
                        aria-hidden
                    >
                        {open ? "−" : "+"}
                    </span>
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                            {title}
                        </h2>
                        {description ? (
                            <p className="mt-1 text-xs leading-relaxed text-slate-500">
                                {description}
                            </p>
                        ) : null}
                    </div>
                </div>
                <span
                    className={`shrink-0 text-[11px] font-medium ${
                        open ? "text-slate-600" : "text-slate-500"
                    }`}
                >
                    {open ? "Hide" : "Show"}
                </span>
            </button>
            {open ? (
                <div className="mt-2 space-y-3 border-t border-slate-100 pt-3">{children}</div>
            ) : null}
        </section>
    );
}

export type AdvancedToolAccent = "slate" | "violet" | "blue" | "amber";

const ADVANCED_TOOL_ACCENT_CLASS: Record<AdvancedToolAccent, string> = {
    slate: "border-l-slate-400",
    violet: "border-l-violet-500",
    blue: "border-l-blue-500",
    amber: "border-l-amber-400",
};

/** Nested panel inside Advanced / Diagnostics — consistent left accent and spacing. */
export function AdvancedToolSection({
    title,
    description,
    accent = "slate",
    children,
    className = "",
}: {
    readonly title: string;
    readonly description?: string;
    readonly accent?: AdvancedToolAccent;
    readonly children: ReactNode;
    readonly className?: string;
}) {
    return (
        <section
            className={`rounded-lg border border-slate-200/90 bg-white p-3 shadow-sm border-l-[3px] ${ADVANCED_TOOL_ACCENT_CLASS[accent]} ${className}`}
        >
            <header className={children ? "mb-2" : ""}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                    {title}
                </h3>
                {description ? (
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
                ) : null}
            </header>
            {children}
        </section>
    );
}

export function TransportToolbarButton({
    children,
    onClick,
    disabled,
    title,
    variant = "default",
}: {
    readonly children: ReactNode;
    readonly onClick: () => void;
    readonly disabled?: boolean;
    readonly title?: string;
    readonly variant?: "default" | "primary" | "danger" | "accent";
}) {
    const variantClass =
        variant === "primary"
            ? "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"
            : variant === "danger"
              ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
              : variant === "accent"
                ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClass}`}
        >
            {children}
        </button>
    );
}

export function TransportMetricPill({
    label,
    value,
    tone = "neutral",
}: {
    readonly label: string;
    readonly value: string | number;
    readonly tone?: "neutral" | "warning" | "success";
}) {
    const toneClass =
        tone === "warning"
            ? "bg-amber-50 text-amber-900 ring-amber-100"
            : tone === "success"
              ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
              : "bg-slate-50 text-slate-700 ring-slate-100";

    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${toneClass}`}
        >
            <span className="text-slate-500">{label}</span>
            <span>{value}</span>
        </span>
    );
}

export function routePublicIsHidden(route: TransportRouteDetail): boolean {
    return routePublicVisibilityLabel(route).startsWith("Hidden");
}

export function buildRouteReviewChecklist(args: {
    readonly route: TransportRouteDetail;
    readonly variants: readonly TransportVariantSummary[];
    readonly stopsWithoutLocation: number;
    readonly stopsNeedingReview: number;
    readonly usesPlaceholderReviewPoints: boolean;
}): RouteReviewChecklistItem[] {
    const {
        route,
        variants,
        stopsWithoutLocation,
        stopsNeedingReview,
        usesPlaceholderReviewPoints,
    } = args;

    const metadata = route.routeMetadata;
    const isTrain = (metadata?.summary.mode ?? route.mode) === "train";
    const namesComplete = Boolean(route.name_mm?.trim() && route.name_en?.trim());
    const sourcesComplete = metadata?.diagnostics.hasSourceLinks ?? route.sources.length > 0;
    const hasStopSequence = variants.some((v) => v.stop_count > 0);
    const sequenceComplete =
        metadata?.diagnostics.hasCompleteStopSequence ??
        (variants.length > 0 && variants.every((v) => v.stop_count >= 2));
    const closingDuplicateSkipped = metadata?.train.closingDuplicateStopSkipped === true;
    const pathAvailable = metadata?.diagnostics.hasPath ?? variants.every((v) => v.path_status !== "none");
    const locationsReviewed = !(
        stopsWithoutLocation > 0 ||
        stopsNeedingReview > 0 ||
        usesPlaceholderReviewPoints ||
        metadata?.diagnostics.hasStopLocationWarnings
    );
    const publicVisible = !routePublicIsHidden(route);

    const sequenceHint = (() => {
        if (!sequenceComplete) {
            if (closingDuplicateSkipped) {
                return "Ordered stops look incomplete — check variant sequence (closing duplicate may be skipped).";
            }
            return "Each variant needs at least two contiguous ordered stops.";
        }
        if (isTrain && hasStopSequence) {
            return "Stop sequence guide available.";
        }
        return undefined;
    })();

    const locationsHint = (() => {
        if (locationsReviewed) {
            return "Stop locations look reviewed for the selected variant.";
        }
        if (stopsNeedingReview > 0) {
            return `${stopsNeedingReview} stop${stopsNeedingReview === 1 ? "" : "s"} still need_review.`;
        }
        if (stopsWithoutLocation > 0) {
            return `${stopsWithoutLocation} stop${stopsWithoutLocation === 1 ? "" : "s"} missing location.`;
        }
        if (usesPlaceholderReviewPoints) {
            return "Some stops use review placeholder points.";
        }
        return "Open Review Map to confirm stop locations.";
    })();

    const pathHint = (() => {
        if (pathAvailable) {
            return "Route path geometry is present.";
        }
        if (isTrain) {
            return "No path yet — optional for train; use the stop sequence guide in Review Map.";
        }
        return "One or more variants have no path.";
    })();

    const publicHint = publicVisible
        ? "Visible on the public map."
        : routePublicVisibilityLabel(route);

    return [
        {
            key: "names",
            label: "Route names complete",
            status: namesComplete ? "ok" : "attention",
            hint: namesComplete ? undefined : "Add Myanmar and English names.",
        },
        {
            key: "sources",
            label: "Source links complete",
            status: sourcesComplete ? "ok" : "attention",
            hint: sourcesComplete ? undefined : "No source links on this route.",
        },
        {
            key: "sequence",
            label: "Stop sequence complete",
            status: sequenceComplete ? "ok" : "attention",
            hint: sequenceHint,
        },
        {
            key: "locations",
            label: "Stop locations reviewed",
            status: locationsReviewed ? "ok" : "attention",
            hint: locationsHint,
        },
        {
            key: "path",
            label: "Route path available",
            status: pathAvailable ? "ok" : "attention",
            hint: pathHint,
        },
        {
            key: "public",
            label: "Public visibility",
            status: publicVisible ? "ok" : "attention",
            hint: publicHint,
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
    canWrite,
}: {
    readonly route: TransportRouteDetail | null;
    readonly routeDisplayName: string;
    readonly routeLoading: boolean;
    readonly reviewMapOpen: boolean;
    readonly editingRoute: boolean;
    readonly onReviewMap: () => void;
    readonly onEditInfo: () => void;
    readonly onClose?: () => void;
    readonly canWrite: boolean;
}) {
    return (
        <header className="flex flex-col gap-2 border-b border-gray-200 pb-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                {routeLoading ? (
                    <div className="h-7 w-64 animate-pulse rounded bg-gray-200" />
                ) : route ? (
                    <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
                        <span className="mr-2 rounded bg-gray-900 px-2 py-0.5 text-base text-white">
                            {route.route_code}
                        </span>
                        {routeDisplayName}
                    </h1>
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
                    disabled={!canWrite || !route || routeLoading}
                    title={!canWrite ? "Read-only viewers cannot edit routes" : undefined}
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
    const metadata = route?.routeMetadata;
    const isTrain = (metadata?.summary.mode ?? route?.mode) === "train";
    const trainMeta = metadata?.train;
    const operationDays = formatMetadataOperationDays(metadata?.summary.operationDays ?? []);
    const estimatedDuration =
        trainMeta?.estimatedDurationMin != null
            ? formatMetadataDuration(trainMeta.estimatedDurationMin)
            : null;
    const trainType = routeMetadataDisplayValue(
        metadata?.summary.trainType ?? metadata?.summary.routeType,
    );
    const rawTrainModel = metadata?.summary.trainModel ?? trainMeta?.trainModel;
    const trainModel = rawTrainModel ? routeMetadataDisplayValue(rawTrainModel) : null;
    const showYangonBadge = trainMeta?.isYangonUrbanService === true;

    return (
        <section className={CARD_CLASS}>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                    Route summary
                </h2>
                {route && !routeLoading ? (
                    <div className="flex flex-wrap items-center gap-1">
                        <ReviewStatusBadge reviewStatus={route.review_status} />
                        <PublicPreviewBadge
                            reviewStatus={route.review_status}
                            isActive={route.is_active}
                            deletedAt={route.deleted_at}
                        />
                        <SourceStatusBadge
                            status={
                                metadata?.summary.sourceStatus ??
                                (route.sources.length > 0 ? "linked" : "none")
                            }
                        />
                        {isTrain && showYangonBadge ? (
                            <TrainYangonServiceBadge
                                isYangonUrbanService
                                isSourceFullLoop={trainMeta?.isSourceFullLoop ?? false}
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>
            {routeLoading ? (
                <div className={COMPACT_FIELD_GRID_CLASS}>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-9 animate-pulse rounded bg-gray-100" />
                    ))}
                </div>
            ) : route ? (
                <dl className={COMPACT_FIELD_GRID_CLASS}>
                    <CompactField
                        label="Myanmar name"
                        value={routeMetadataDisplayValue(metadata?.names.nameMy ?? route.name_mm)}
                    />
                    <CompactField
                        label="English name"
                        value={routeMetadataDisplayValue(metadata?.names.nameEn ?? route.name_en)}
                    />
                    <CompactField label="Mode · kind" value={routeModeKindLabel(route)} />
                    <CompactField
                        label="Origin"
                        value={routeMetadataDisplayValue(
                            metadata?.names.originName ?? route.origin_name,
                        )}
                    />
                    <CompactField
                        label="Destination"
                        value={routeMetadataDisplayValue(
                            metadata?.names.destinationName ?? route.destination_name,
                        )}
                    />
                    <CompactField
                        label="Variant count"
                        value={metadata?.counts.variantCount ?? route.counts.variants}
                    />
                    <CompactField
                        label="Stop count"
                        value={metadata?.counts.stopCount ?? route.counts.stops}
                    />
                    <CompactField
                        label="Path count"
                        value={metadata?.counts.pathCount ?? route.counts.paths}
                    />
                    {isTrain ? (
                        <>
                            {trainType !== "—" ? (
                                <CompactField label="Train type" value={trainType} />
                            ) : null}
                            {trainModel ? (
                                <CompactField label="Train model" value={trainModel} />
                            ) : null}
                            {estimatedDuration ? (
                                <CompactField
                                    label="Estimated duration"
                                    value={estimatedDuration}
                                />
                            ) : null}
                            {operationDays ? (
                                <CompactField label="Operation days" value={operationDays} />
                            ) : null}
                        </>
                    ) : null}
                </dl>
            ) : null}
        </section>
    );
}

function variantPathStatusLabel(variant: TransportVariantSummary): string {
    return variant.path_status === "has_path" ? "Has path" : "No path";
}

export function transportVariantFirstStopLabel(variant: TransportVariantSummary): string {
    return variant.first_stop_name?.trim() || "—";
}

export function RouteVariantsCard({
    variants,
    routeCode,
    routeMode,
    routeLoading,
    addingVariant,
    addVariantSlot,
    onOpenReviewMap,
    onStartAddVariant,
    directionSwapPair = null,
    onChangeDirection,
    canWrite,
}: {
    readonly variants: readonly TransportVariantSummary[];
    readonly routeCode: string;
    readonly routeMode: string;
    readonly routeLoading: boolean;
    readonly addingVariant: boolean;
    readonly addVariantSlot?: ReactNode;
    readonly onOpenReviewMap: (variantPublicId: string) => void;
    readonly onStartAddVariant: () => void;
    readonly directionSwapPair?: RouteDirectionSwapPair | null;
    readonly onChangeDirection?: () => void;
    readonly canWrite: boolean;
}) {
    const canonicalYbs = isCanonicalYbsRoute(routeMode, routeCode);

    return (
        <section className={`${CARD_CLASS} p-0`}>
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Variants {variants.length > 0 ? `(${variants.length})` : ""}
                </h2>
                <div className="flex items-center gap-2">
                    {!canonicalYbs && directionSwapPair && onChangeDirection ? (
                        <button
                            type="button"
                            onClick={onChangeDirection}
                            disabled={!canWrite}
                            title={!canWrite ? "Read-only viewers cannot change route direction" : undefined}
                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Swap direction assignments
                        </button>
                    ) : null}
                    {!addingVariant ? (
                        <button
                            type="button"
                            onClick={onStartAddVariant}
                            disabled={!canWrite}
                            title={!canWrite ? "Read-only viewers cannot add route variants" : undefined}
                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            + Add variant
                        </button>
                    ) : null}
                </div>
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
                <p className="px-3 py-3 text-center text-sm text-gray-500">
                    No variants for this route.
                </p>
            ) : (
                <ul className="divide-y divide-gray-100">
                    {variants.map((v) => (
                        <li
                            key={v.public_id}
                            className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-3"
                        >
                            {canonicalYbs ? (
                                <dl className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                                    <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                        Direction
                                    </dt>
                                    <dd className="text-sm font-semibold text-gray-900">
                                        {variantDirectionLabel(v, true)}
                                    </dd>
                                    <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                        Route
                                    </dt>
                                    <dd className="truncate text-sm text-gray-800" title={variantHumanRoute(v)}>
                                        {variantHumanRoute(v)}
                                    </dd>
                                    <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                        Code
                                    </dt>
                                    <dd className="truncate font-mono text-xs text-gray-600">
                                        {canonicalYbsVariantCode(routeCode, v.direction_id) ?? "—"}
                                    </dd>
                                </dl>
                            ) : (
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-gray-900">
                                        {v.variant_code}
                                        {v.direction_name ? ` · ${v.direction_name}` : ""}
                                    </p>
                                    <p className="truncate text-xs text-gray-500">
                                        {transportVariantFirstStopLabel(v)}
                                    </p>
                                </div>
                            )}
                            <p className="text-xs text-gray-600 sm:text-center">
                                {v.stop_count} stops · {variantPathStatusLabel(v)}
                            </p>
                            <button
                                type="button"
                                onClick={() => onOpenReviewMap(v.public_id)}
                                className="justify-self-start rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 sm:justify-self-end"
                            >
                                {canonicalYbs
                                    ? `Open ${variantDirectionLabel(v, true)}`
                                    : "Open in Review Map"}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export function ReadinessUnavailableNotice({
    onRetry,
    retrying = false,
}: {
    readonly onRetry?: () => void;
    readonly retrying?: boolean;
}) {
    return (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-relaxed text-slate-500">
            <span>{REVIEW_READINESS_UNAVAILABLE_MESSAGE}</span>
            {onRetry ? (
                <button
                    type="button"
                    onClick={onRetry}
                    disabled={retrying}
                    className="font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {retrying ? "Retrying…" : "Retry"}
                </button>
            ) : null}
        </p>
    );
}

function ChecklistRow({ item }: { readonly item: RouteReviewChecklistItem }) {
    const ok = item.status === "ok";
    return (
        <li
            className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-sm ${
                ok
                    ? "border-emerald-100 bg-emerald-50/40"
                    : "border-amber-100 bg-amber-50/50"
            }`}
        >
            <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-200 text-amber-900"
                }`}
                aria-hidden
            >
                {ok ? "✓" : "!"}
            </span>
            <div className="min-w-0">
                <p className={ok ? "font-medium text-slate-700" : "font-semibold text-slate-900"}>
                    {item.label}
                </p>
                {item.hint ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.hint}</p>
                ) : null}
            </div>
        </li>
    );
}

export function RouteReviewChecklistCard({
    items,
    loading,
    readinessUnavailable = false,
    onRetryReadiness,
    readinessRetrying = false,
}: {
    readonly items: readonly RouteReviewChecklistItem[];
    readonly loading: boolean;
    readonly readinessUnavailable?: boolean;
    readonly onRetryReadiness?: () => void;
    readonly readinessRetrying?: boolean;
}) {
    const attentionCount = items.filter((item) => item.status === "attention").length;

    return (
        <section className={CARD_CLASS}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                    Review checklist
                </h2>
                {!loading && items.length > 0 ? (
                    <TransportMetricPill
                        label="Attention"
                        value={attentionCount}
                        tone={attentionCount > 0 ? "warning" : "success"}
                    />
                ) : null}
            </div>
            {readinessUnavailable ? (
                <div className="mb-2">
                    <ReadinessUnavailableNotice
                        onRetry={onRetryReadiness}
                        retrying={readinessRetrying}
                    />
                </div>
            ) : null}
            {loading ? (
                <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                    {[0, 1, 2, 3].map((index) => (
                        <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                    ))}
                </div>
            ) : (
                <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2 md:gap-2">
                    {items.map((item) => (
                        <ChecklistRow key={item.key} item={item} />
                    ))}
                </ul>
            )}
        </section>
    );
}
