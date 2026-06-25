import UserDetailPage from "@/src/features/user-management/UserDetailPage";

export default async function UserDetailRoutePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <UserDetailPage id={id} />;
}
