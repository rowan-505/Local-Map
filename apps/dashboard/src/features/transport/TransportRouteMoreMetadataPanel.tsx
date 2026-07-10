"use client";

import { useMemo, useState } from "react";

import TransportRouteMetadataEditModal from "./TransportRouteMetadataEditModal";
import {
    COMPACT_FIELD_GRID_2_CLASS,
    CompactField,
    TRANSPORT_DETAIL_CARD_CLASS,
} from "./TransportRouteDetailCards";
import {
    buildRouteMoreMetadataFields,
    type RouteMetadataField,
} from "./transportRouteMetadataFields";
import type { TransportRouteDetail } from "./types";

function MetadataFieldGrid({ fields }: { readonly fields: readonly RouteMetadataField[] }) {
    if (fields.length === 0) {
        return null;
    }

    return (
        <dl className={COMPACT_FIELD_GRID_2_CLASS}>
            {fields.map((field) => (
                <CompactField key={field.key} label={field.label} value={field.value} />
            ))}
        </dl>
    );
}

export type TransportRouteMoreMetadataPanelProps = {
    readonly route: TransportRouteDetail | null;
    readonly routeLoading: boolean;
    readonly defaultOpen?: boolean;
    readonly onSaved?: (updated: TransportRouteDetail) => void;
};

export default function TransportRouteMoreMetadataPanel({
    route,
    routeLoading,
    defaultOpen = false,
    onSaved,
}: TransportRouteMoreMetadataPanelProps) {
    const [open, setOpen] = useState(defaultOpen);
    const [editOpen, setEditOpen] = useState(false);

    const { commonFields, modeFields, modeLabel } = useMemo(() => {
        if (!route) {
            return {
                commonFields: [] as RouteMetadataField[],
                modeFields: [] as RouteMetadataField[],
                modeLabel: null as string | null,
            };
        }

        return buildRouteMoreMetadataFields(route);
    }, [route]);

    const visibleCount = commonFields.length + modeFields.length;
    const toggleLabel = routeLoading ? "…" : open ? "Hide" : `Show (${visibleCount})`;

    return (
        <section className={TRANSPORT_DETAIL_CARD_CLASS}>
            <div className="flex items-start justify-between gap-2">
                <button
                    type="button"
                    onClick={() => setOpen((current) => !current)}
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={open}
                    disabled={routeLoading}
                >
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                        More metadata
                    </h2>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                        Extra fields not shown in the route summary.
                    </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                    {route && !routeLoading ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                setEditOpen(true);
                            }}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Edit metadata
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => setOpen((current) => !current)}
                        disabled={routeLoading}
                        className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
                    >
                        {toggleLabel}
                    </button>
                </div>
            </div>

            <TransportRouteMetadataEditModal
                open={editOpen}
                route={route}
                onClose={() => setEditOpen(false)}
                onSaved={(updated) => {
                    onSaved?.(updated);
                }}
            />

            {open ? (
                <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                    {routeLoading ? (
                        <div className={COMPACT_FIELD_GRID_2_CLASS}>
                            {[0, 1, 2].map((index) => (
                                <div
                                    key={index}
                                    className="h-9 animate-pulse rounded bg-slate-100"
                                />
                            ))}
                        </div>
                    ) : route ? (
                        visibleCount > 0 ? (
                            <>
                                <MetadataFieldGrid fields={commonFields} />
                                {modeFields.length > 0 ? (
                                    <div
                                        className={
                                            commonFields.length > 0
                                                ? "border-t border-slate-100 pt-2"
                                                : ""
                                        }
                                    >
                                        {modeLabel ? (
                                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                {modeLabel}
                                            </p>
                                        ) : null}
                                        <MetadataFieldGrid fields={modeFields} />
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <p className="text-xs text-slate-500">
                                No additional metadata fields for this route.
                            </p>
                        )
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
