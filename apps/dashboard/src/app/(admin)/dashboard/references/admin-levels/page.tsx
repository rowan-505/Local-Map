import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Admin Levels"
            description="Reference data — Admin Levels."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
