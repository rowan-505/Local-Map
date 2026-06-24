"use client";

import TransportInfrastructureDetailContent from "./TransportInfrastructureDetailContent";

export default function TransportInfrastructureLineDetailPage({
    publicId,
}: {
    readonly publicId: string;
}) {
    return (
        <main className="p-6">
            <div className="mx-auto max-w-[1400px] space-y-4">
                <TransportInfrastructureDetailContent publicId={publicId} />
            </div>
        </main>
    );
}
