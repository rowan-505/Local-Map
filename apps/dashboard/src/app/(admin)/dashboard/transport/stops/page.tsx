import { Suspense } from "react";
import TransportStopsPage from "@/src/features/transport/TransportStopsPage";

export default function TransportStopsRoutePage() {
    return (
        <Suspense fallback={null}>
            <TransportStopsPage />
        </Suspense>
    );
}
