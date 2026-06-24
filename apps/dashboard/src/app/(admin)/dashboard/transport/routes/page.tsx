import { Suspense } from "react";

import TransportRoutesPage from "@/src/features/transport/TransportRoutesPage";

export default function TransportRoutesRoutePage() {
    return (
        <Suspense fallback={null}>
            <TransportRoutesPage />
        </Suspense>
    );
}
