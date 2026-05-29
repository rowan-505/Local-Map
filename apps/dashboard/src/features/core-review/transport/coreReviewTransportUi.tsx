"use client";

import type { ReactNode } from "react";

import { ConfidenceBadge } from "@/src/components/review/ReviewStatusBadge";

import CoreReviewVerificationStatusCell from "../components/CoreReviewVerificationStatusCell";
import type {
    CoreReviewBusRouteRow,
    CoreReviewBusRouteVariantRow,
    CoreReviewBusStopRow,
} from "../config/types";
import { dash, formatDate, yesNo } from "../utils/formatters";
import {
    formatTransportModeType,
    formatTransportVerificationStatus,
    transportLineageSummary,
    type CoreReviewTransportRouteStopRow,
} from "./coreReviewTransportShared";

export function TransportVerificationStatusCell({
    status,
    isVerifiedFallback,
}: {
    status?: string | null;
    isVerifiedFallback?: boolean | null;
}) {
    return (
        <CoreReviewVerificationStatusCell status={status} isVerifiedFallback={isVerifiedFallback} />
    );
}

export { formatTransportVerificationStatus };

export function JsonReadonlyBlock({ label, value }: { label: string; value: unknown }) {
    if (value == null) {
        return null;
    }
    return (
        <div className="sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                {JSON.stringify(value, null, 2)}
            </pre>
        </div>
    );
}

function detailField(label: string, value: ReactNode) {
    return { label, value };
}

export function busStopTransportDetailFields(row: CoreReviewBusStopRow & Record<string, unknown>) {
    const lineage = transportLineageSummary(row.sourceRefs, row.normalizedData);
    return [
        detailField("Public ID", row.publicId),
        detailField("Stop code", dash(row.stopCode)),
        detailField("Display name", dash(row.name)),
        detailField("Myanmar name", dash(row.nameMm ?? row.nameLocal)),
        detailField("English name", dash(row.nameEn ?? row.name)),
        detailField("Mode type", formatTransportModeType(row.modeType as string | null)),
        detailField("Admin area", dash(row.adminAreaName)),
        detailField("Verification", (
            <TransportVerificationStatusCell
                status={row.verificationStatus as string}
                isVerifiedFallback={row.isVerified}
            />
        )),
        detailField("Confidence", <ConfidenceBadge score={row.confidenceScore as number | null} />),
        detailField("Active", yesNo(row.isActive)),
        detailField("Created", formatDate(row.createdAt)),
        detailField("Updated", formatDate(row.updatedAt)),
        ...(lineage ? [detailField("Lineage", lineage)] : []),
    ];
}

export function busRouteTransportDetailFields(row: CoreReviewBusRouteRow & Record<string, unknown>) {
    const lineage = transportLineageSummary(row.sourceRefs, row.normalizedData);
    return [
        detailField("ID", row.id),
        detailField("Public ID", dash(row.publicId)),
        detailField("Route code", dash(row.routeCode)),
        detailField("Public name", dash(row.publicName)),
        detailField("Mode type", formatTransportModeType((row.modeType ?? row.routeType) as string | null)),
        detailField("Operator", dash(row.operatorName)),
        detailField("Operator ID", dash(row.operatorId)),
        detailField("Route status", formatTransportVerificationStatus((row.routeStatus ?? row.verificationStatus) as string)),
        detailField("Verification", (
            <TransportVerificationStatusCell
                status={row.verificationStatus as string}
                isVerifiedFallback={row.isVerified}
            />
        )),
        detailField("Confidence", <ConfidenceBadge score={row.confidenceScore as number | null} />),
        detailField("Active", yesNo(row.isActive)),
        detailField("Variant count", dash(row.variantCount)),
        detailField("Directionality", dash(row.directionality)),
        detailField("Created", formatDate(row.createdAt)),
        detailField("Updated", formatDate(row.updatedAt)),
        ...(lineage ? [detailField("Lineage", lineage)] : []),
    ];
}

export function busRouteVariantTransportDetailFields(
    row: CoreReviewBusRouteVariantRow & Record<string, unknown>,
) {
    const lineage = transportLineageSummary(row.sourceRefs, row.normalizedData);
    return [
        detailField("ID", row.id),
        detailField("Public ID", dash(row.publicId)),
        detailField("Route ID", row.routeId),
        detailField("Route code", dash(row.routeCode)),
        detailField("Route name", dash(row.routePublicName)),
        detailField("Variant code", dash(row.variantCode)),
        detailField("Direction", dash(row.directionName)),
        detailField("Origin", dash(row.originName)),
        detailField("Destination", dash(row.destinationName)),
        detailField("Distance (m)", dash(row.distanceM)),
        detailField("Verification", (
            <TransportVerificationStatusCell
                status={row.verificationStatus as string}
                isVerifiedFallback={row.isVerified}
            />
        )),
        detailField("Confidence", <ConfidenceBadge score={row.confidenceScore as number | null} />),
        detailField("Active", yesNo(row.isActive)),
        detailField("Created", formatDate(row.createdAt as string | null)),
        detailField("Updated", formatDate(row.updatedAt as string | null)),
        ...(lineage ? [detailField("Lineage", lineage)] : []),
    ];
}

export function RouteStopsDetailTable({ stops }: { stops: CoreReviewTransportRouteStopRow[] }) {
    if (!stops.length) {
        return (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                No route stops linked to this variant yet.
            </p>
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-700">
                    <tr>
                        <th className="px-3 py-2 font-medium">Seq</th>
                        <th className="px-3 py-2 font-medium">Stop ID</th>
                        <th className="px-3 py-2 font-medium">Distance (m)</th>
                        <th className="px-3 py-2 font-medium">Timing point</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {stops.map((stop) => (
                        <tr key={`${stop.stopId}-${stop.stopSequence}`}>
                            <td className="px-3 py-2">{stop.stopSequence ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-xs">{dash(stop.stopId)}</td>
                            <td className="px-3 py-2">{dash(stop.distanceFromStartM)}</td>
                            <td className="px-3 py-2">{yesNo(Boolean(stop.isTimingPoint))}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
