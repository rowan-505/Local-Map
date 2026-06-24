import TransportTerminalDetailPage from "@/src/features/transport/TransportTerminalDetailPage";

export default async function TransportTerminalDetailRoutePage({
    params,
}: {
    params: Promise<{ publicId: string }>;
}) {
    const { publicId } = await params;
    return <TransportTerminalDetailPage publicId={publicId} />;
}
