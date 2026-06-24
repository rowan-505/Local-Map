import TransportInfrastructureLineDetailPage from "@/src/features/transport/TransportInfrastructureLineDetailPage";

export default async function TransportInfrastructureLineDetailRoutePage({
    params,
}: {
    params: Promise<{ publicId: string }>;
}) {
    const { publicId } = await params;
    return <TransportInfrastructureLineDetailPage publicId={publicId} />;
}
