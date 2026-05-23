"use client";

import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { getCoreEntityConfig, type CoreEntityKey } from "@/src/lib/core-review/entityConfigs";

export type UseCoreReviewDrawerDetailOptions = {
    entityKey: CoreEntityKey;
    recordId: string | null;
    open: boolean;
    enabled?: boolean;
};

export function useCoreReviewDrawerDetail({
    entityKey,
    recordId,
    open,
    enabled = true,
}: UseCoreReviewDrawerDetailOptions) {
    const config = getCoreEntityConfig(entityKey);
    const [detail, setDetail] = useState<unknown | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    const reloadDetail = useCallback(async () => {
        if (!recordId) {
            return null;
        }
        setIsLoading(true);
        setError("");
        try {
            const data = await config.fetchDetail(recordId);
            setDetail(data);
            return data;
        } catch (err) {
            const message =
                err instanceof Error ? err.message : `Failed to load ${config.label.toLowerCase()}`;
            setError(message);
            setDetail(null);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [config, recordId]);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        if (!open || !recordId || !enabled) {
            setDetail(null);
            setError("");
            setIsLoading(false);
            return () => controller.abort();
        }

        setIsLoading(true);
        setError("");

        void config
            .fetchDetail(recordId)
            .then((data) => {
                if (active) {
                    setDetail(data);
                }
            })
            .catch((err) => {
                if (!active || isAbortError(err)) {
                    return;
                }
                setError(
                    err instanceof Error ? err.message : `Failed to load ${config.label.toLowerCase()}`,
                );
                setDetail(null);
            })
            .finally(() => {
                if (active && !controller.signal.aborted) {
                    setIsLoading(false);
                }
            });

        return () => {
            active = false;
            controller.abort();
        };
    }, [config, enabled, open, recordId]);

    return {
        detail,
        setDetail,
        isLoading,
        error,
        reloadDetail,
    };
}
