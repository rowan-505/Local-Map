import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Place Classes"
            description="Reference data — Place Classes."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
