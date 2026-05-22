"use client";

import type { ReactNode } from "react";
import { Fragment } from "react";

import ReviewStatusBadge, {
    type ReviewStatusBadgeVariant,
} from "@/src/components/review/ReviewStatusBadge";

import type { CoreReviewStreetRow } from "../config/types";

function routingStatusLabel(status: string | null | undefined): string {
    const trimmed = status?.trim();
    return trimmed ? trimmed : "not_ready";
}

function routingStatusVariant(status: string): ReviewStatusBadgeVariant {
    switch (status) {
        case "synced":
        case "ready":
            return "ready";
        case "needs_rebuild":
            return "unverified";
        case "not_ready":
            return "not-implemented";
        default:
            return "neutral";
    }
}

export function StreetRoutingStatusBadge({ row }: { row: CoreReviewStreetRow }) {
    const label = routingStatusLabel(row.routingStatus);
    return <ReviewStatusBadge variant={routingStatusVariant(label)} label={label} />;
}

export function StreetAttributesCell({ row }: { row: CoreReviewStreetRow }) {
    const surface = row.surface?.trim();
    const parts: ReactNode[] = [];

    if (surface) {
        parts.push(
            <span key="surface" className="text-xs text-slate-700" title={surface}>
                {surface}
            </span>
        );
    }
    if (row.isOneway) {
        parts.push(<ReviewStatusBadge key="oneway" variant="neutral" label="oneway" />);
    }
    if (row.bridge) {
        parts.push(<ReviewStatusBadge key="bridge" variant="neutral" label="bridge" />);
    }
    if (row.tunnel) {
        parts.push(<ReviewStatusBadge key="tunnel" variant="neutral" label="tunnel" />);
    }

    if (parts.length === 0) {
        return <span className="text-slate-500">—</span>;
    }

    return (
        <div className="flex max-w-56 flex-wrap items-center gap-1">
            {parts.map((part, index) => (
                <Fragment key={index}>
                    {index > 0 ? <span className="text-slate-300">|</span> : null}
                    {part}
                </Fragment>
            ))}
        </div>
    );
}
