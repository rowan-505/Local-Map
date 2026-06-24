import TransportStopDetailPage from "@/src/features/transport/TransportStopDetailPage";

export default async function TransportStopDetailRoutePage({
    params,
}: {
    params: Promise<{ publicId: string }>;
}) {
    const { publicId } = await params;
    return <TransportStopDetailPage publicId={publicId} />;
}
