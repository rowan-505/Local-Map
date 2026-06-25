import ReportDetailPage from "@/src/features/report-management/ReportDetailPage";

export default async function ReportDetailRoutePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <ReportDetailPage id={id} />;
}
