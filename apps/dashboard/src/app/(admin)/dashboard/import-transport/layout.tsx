import type { ReactNode } from "react";
import { Suspense } from "react";

import ImportTransportRouteAuthGate from "./_components/ImportTransportRouteAuthGate";
import ImportTransportSubNav from "./_components/ImportTransportSubNav";
import { ImportTransportBatchScopeProvider } from "@/src/features/import-transport/hooks/useImportTransportBatchContext";

export default function ImportTransportLayout({ children }: { children: ReactNode }) {
    return (
        <ImportTransportRouteAuthGate>
            <ImportTransportBatchScopeProvider>
                <Suspense fallback={null}>
                    <ImportTransportSubNav />
                </Suspense>
                {children}
            </ImportTransportBatchScopeProvider>
        </ImportTransportRouteAuthGate>
    );
}
