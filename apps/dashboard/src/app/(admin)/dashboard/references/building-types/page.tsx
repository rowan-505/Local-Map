import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Building Types"
            description="Reference data — Building Types."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
