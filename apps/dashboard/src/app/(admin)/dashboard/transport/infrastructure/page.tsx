import { Suspense } from "react";
import TransportInfrastructureLinesPage from "@/src/features/transport/TransportInfrastructureLinesPage";

export default function TransportInfrastructureRoutePage() {
    return (
        <Suspense fallback={null}>
            <TransportInfrastructureLinesPage />
        </Suspense>
    );
}
