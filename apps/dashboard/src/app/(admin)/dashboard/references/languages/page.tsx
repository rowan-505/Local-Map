import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Languages"
            description="Reference data — Languages."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
