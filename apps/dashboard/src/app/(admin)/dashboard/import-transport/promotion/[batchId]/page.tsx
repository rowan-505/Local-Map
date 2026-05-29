import ImportTransportPromotionBatchPage from "@/src/features/import-transport/components/ImportTransportPromotionBatchPage";

type PageProps = {
    params: Promise<{ batchId: string }>;
};

export default async function ImportTransportPromotionBatchRoutePage({ params }: PageProps) {
    const { batchId } = await params;
    return <ImportTransportPromotionBatchPage batchId={batchId} />;
}
