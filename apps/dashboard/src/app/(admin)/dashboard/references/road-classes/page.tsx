import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Road Classes"
            description="Reference data — Road Classes."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
