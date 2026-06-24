import { Suspense } from "react";
import TransportImportsPage from "@/src/features/transport/TransportImportsPage";

export default function TransportImportsRoutePage() {
    return (
        <Suspense fallback={null}>
            <TransportImportsPage />
        </Suspense>
    );
}
