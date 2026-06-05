"use client";

import { useCallback, useState } from "react";

import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import {
    isAbortError,
    postImportReviewPromotionBatchRoadDryRun,
    type ImportReviewRoadPromotionGatesResult,
} from "@/src/lib/api";
import {
    roadPromotionSafetyChecksPassed,
    ROAD_BULK_PROMOTION_ENV_VAR,
    ROAD_PROMOTION_BULK_THRESHOLD,
    ROAD_PROMOTION_ENV_VAR,
} from "@/src/features/import-review/promotion/roadPromotionGates";

type Props = {
    batchId: string;
    gates: ImportReviewRoadPromotionGatesResult;
    formatError: (err: unknown) => string;
    onDryRunUpdated?: () => void | Promise<void>;
};

function GateRow({
    label,
    satisfied,
    detail,
    helper,
}: {
    label: string;
    satisfied: boolean;
    detail: string;
    helper?: string;
}) {
    return (
        <li className="flex gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
            <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    satisfied
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-900"
                }`}
                aria-hidden
            >
                {satisfied ? "✓" : "!"}
            </span>
            <div className="min-w-0">
                <p className="font-medium text-gray-900">{label}</p>
                <p className={satisfied ? "text-gray-600" : "text-amber-900"}>{detail}</p>
                {helper ? <p className="mt-1 text-xs text-gray-500">{helper}</p> : null}
            </div>
        </li>
    );
}

export default function ImportReviewPromotionRoadSafetyChecklist({
    batchId,
    gates,
    formatError,
    onDryRunUpdated,
}: Props) {
    const [isRunningDryRun, setIsRunningDryRun] = useState(false);
    const [dryRunError, setDryRunError] = useState<string | null>(null);
    const [lastRun, setLastRun] = useState<{
        roadDryRun: "passed" | "failed";
        routingReadiness: "passed" | "failed";
    } | null>(null);

    const needsDryRun = gates.gates.some(
        (g) =>
            !g.satisfied &&
            (g.id === "road_dry_run_completed" ||
                g.id === "routing_readiness_validation_completed")
    );

    const handleRunDryRun = useCallback(async () => {
        setDryRunError(null);
        setIsRunningDryRun(true);
        try {
            const result = await postImportReviewPromotionBatchRoadDryRun(batchId, {
                revalidate: true,
            });
            setLastRun({
                roadDryRun: result.road_dry_run.status,
                routingReadiness: result.routing_readiness_validation.status,
            });
            await onDryRunUpdated?.();
        } catch (err) {
            if (!isAbortError(err)) {
                setDryRunError(formatError(err));
            }
        } finally {
            setIsRunningDryRun(false);
        }
    }, [batchId, formatError, onDryRunUpdated]);

    const allPassed =
        lastRun?.roadDryRun === "passed" && lastRun?.routingReadiness === "passed";
    const safetyChecksPassed = roadPromotionSafetyChecksPassed(gates);
    const awaitingEnvOnly = safetyChecksPassed && !gates.can_promote;

    return (
        <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/80 p-4">
            <div>
                <h3 className="text-sm font-semibold text-amber-950">Road promotion safety checklist</h3>
                <p className="mt-1 text-sm text-amber-900">
                    This batch has {gates.road_item_count.toLocaleString()} road publish item
                    {gates.road_item_count === 1 ? "" : "s"}. All checks must pass before live promotion to{" "}
                    <code className="rounded bg-amber-100 px-1">core.core_streets</code>.
                </p>
                <p className="mt-2 text-xs text-amber-900">
                    Run road dry-run once to execute promotion preflight and DB routing-readiness validation.
                    Valhalla graph rebuild is a separate post-promotion step.
                </p>
            </div>

            <ul className="space-y-2">
                {gates.gates.map((gate) => (
                    <GateRow
                        key={gate.id}
                        label={gate.label}
                        satisfied={gate.satisfied}
                        detail={gate.detail}
                        helper={gate.helper}
                    />
                ))}
            </ul>

            {needsDryRun ? (
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => void handleRunDryRun()}
                        disabled={isRunningDryRun}
                        className="rounded-md border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                    >
                        {isRunningDryRun ? "Running road dry-run…" : "Run road dry-run"}
                    </button>
                    {isRunningDryRun ? (
                        <ImportReviewInlineSpinner label="Running road dry-run and routing readiness…" />
                    ) : null}
                </div>
            ) : null}

            {awaitingEnvOnly ? (
                <ImportReviewStatusBanner
                    message={`Dry-run and routing readiness are complete. Set ${ROAD_PROMOTION_ENV_VAR}${gates.road_item_count > ROAD_PROMOTION_BULK_THRESHOLD ? ` and ${ROAD_BULK_PROMOTION_ENV_VAR}` : ""} in apps/api/.env, restart the API, then refresh this page.`}
                    tone="info"
                    compact
                />
            ) : null}

            {allPassed && gates.can_promote ? (
                <ImportReviewStatusBanner
                    message="Road promotion safety checks passed. You can promote when ready."
                    tone="success"
                    compact
                />
            ) : null}
            {lastRun &&
            (lastRun.roadDryRun === "failed" || lastRun.routingReadiness === "failed") ? (
                <ImportReviewStatusBanner
                    message="One or more checks failed. Review sample errors in the API response or fix candidates and re-run."
                    tone="error"
                    compact
                />
            ) : null}

            {dryRunError ? <ImportReviewStatusBanner message={dryRunError} tone="error" compact /> : null}

            {!gates.can_promote && gates.primary_blocker_message ? (
                <ImportReviewStatusBanner message={gates.primary_blocker_message} tone="warning" compact />
            ) : null}
        </section>
    );
}
