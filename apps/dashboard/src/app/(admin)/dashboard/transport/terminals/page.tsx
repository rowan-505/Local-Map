import { Suspense } from "react";
import TransportTerminalsPage from "@/src/features/transport/TransportTerminalsPage";

export default function TransportTerminalsRoutePage() {
    return (
        <Suspense fallback={null}>
            <TransportTerminalsPage />
        </Suspense>
    );
}
