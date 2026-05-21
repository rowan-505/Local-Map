import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Source Types"
            description="Reference data — Source Types."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
