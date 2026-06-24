"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import { getTransportTerminalDetail } from "./api";

const STOPS_WITH_TERMINAL = `${transportPath("stops")}?hasTerminal=true`;

/**
 * The standalone Terminal detail page was removed from navigation. Terminals are
 * linked 1:1 to a stop, so this resolves the terminal's linked stop and replaces
 * the URL with that stop's detail page. When the terminal has no linked stop (or
 * fails to load), it falls back to the stops list filtered to terminal-backed
 * stops.
 */
export default function TransportTerminalRedirect({
    publicId,
}: {
    readonly publicId: string;
}) {
    const router = useRouter();
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            try {
                const detail = await getTransportTerminalDetail(publicId, {
                    signal: controller.signal,
                });
                const linkedStopPublicId = detail.linked_stop?.public_id ?? null;
                router.replace(
                    linkedStopPublicId
                        ? transportPath(`stops/${linkedStopPublicId}`)
                        : STOPS_WITH_TERMINAL
                );
            } catch (err) {
                if (isAbortError(err)) return;
                // Unknown terminal / load failure: fall back to the stops list.
                setFailed(true);
                router.replace(STOPS_WITH_TERMINAL);
            }
        })();
        return () => controller.abort();
    }, [publicId, router]);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-xl rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
                {failed
                    ? "This terminal could not be found. Redirecting to stops…"
                    : "Terminals now live inside Stop detail. Redirecting to the linked stop…"}
            </div>
        </main>
    );
}
